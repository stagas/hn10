import type { Browser } from 'puppeteer-core'
import puppeteer from 'puppeteer-core'
import { findChrome } from './chrome'

const MAX_SUMMARY_CHARACTERS = 280
const GOOGLEBOT_USER_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

export interface SummarizerOptions {
  apiKey: string
  model?: string
  fetchImpl?: typeof fetch
}

export function capTweetSummary(summary: string): string {
  const normalized = summary.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  if (/^summary (?:is )?not available\.?$/i.test(normalized)) return ''
  const characters = Array.from(normalized)

  if (characters.length <= MAX_SUMMARY_CHARACTERS) return normalized
  return `${characters.slice(0, MAX_SUMMARY_CHARACTERS - 1).join('').trimEnd()}…`
}

export class ArticleSummarizer {
  private readonly fetchImpl: typeof fetch
  private readonly model: string

  constructor(private readonly options: SummarizerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.model = options.model ?? 'google/gemma-4-26b-a4b-it:free'
  }

  async summarize(url: string): Promise<string> {
    const pageText = await this.fetchPageText(url)
    const response = await this.requestSummary(pageText)
    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    if (!response.ok) throw new Error(`OpenRouter request failed: ${response.status}`)

    const summary = body.choices?.[0]?.message?.content
    if (!summary) return ''
    return capTweetSummary(summary)
  }

  private async requestSummary(pageText: string): Promise<Response> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: [
                'Identify the main article in the supplied webpage text and write a tweet-sized summary of it.',
                'The complete response must be at most 150 characters, including spaces and punctuation.',
                'Use one concise, accurate sentence in plain English with a journalistic tone.',
                'Ignore navigation, menus, ads, cookie notices, footers, related links, repeated boilerplate, legal text, and disclaimers.',
                'Do not use Markdown, HTML, labels, introductions, or commentary; output only the summary.',
                'You may include a small number of relevant hashtags when they add useful context, but they count toward the 280-character limit.',
                'Do not invent information.',
                'If the article cannot be identified or accessed or does not contain a main article, output nothing.',
                'If you don\'t know the article or not have enough information, output nothing.',
                'If you are unable to access the content, output nothing.',
                'If you get a Forbidden Error, output nothing.',
                'Never answer with text like "Please provide the webpage text you would like me to summarize.". Just output nothing.',
              ].join(' '),
            },
            { role: 'user', content: pageText },
          ],
          reasoning: { max_tokens: 200 },
        }),
      })

      if (response.status !== 429 || attempt === 3) return response
      await delay(retryAfterMs(response.headers.get('retry-after')) ?? 12_000)
    }

    throw new Error('OpenRouter retry loop ended unexpectedly')
  }

  private async fetchPageText(url: string): Promise<string> {
    const browser = await puppeteer.launch({
      executablePath: await findChrome(),
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    })

    try {
      return await this.fetchPageTextWithBrowser(browser, url)
    }
    finally {
      await browser.close()
    }
  }

  private async fetchPageTextWithBrowser(browser: Browser, url: string): Promise<string> {
    const page = await browser.newPage()

    try {
      await page.setUserAgent(GOOGLEBOT_USER_AGENT)
      await page.setJavaScriptEnabled(false)
      await page.setRequestInterception(true)
      page.setDefaultNavigationTimeout(20_000)
      page.on('request', request => {
        if (['font', 'image', 'media', 'stylesheet'].includes(request.resourceType())) {
          request.abort().catch(console.error)
        }
        else {
          request.continue().catch(console.error)
        }
      })

      const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
      if (!response) throw new Error('Puppeteer navigation returned no response')
      return textFromHtml(await response.text())
    }
    catch (error) {
      console.error(`Chrome article fetch failed for ${url}; using direct fetch`, error)
      return this.fetchPageTextDirectly(url)
    }
    finally {
      await page.close().catch(console.error)
    }
  }

  private async fetchPageTextDirectly(url: string): Promise<string> {
    const response = await this.fetchImpl(url, {
      headers: { 'User-Agent': GOOGLEBOT_USER_AGENT },
    })
    if (!response.ok) throw new Error(`Failed to fetch article fallback: ${response.status}`)
    return textFromHtml(await response.text())
  }
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function textFromHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50_000)
}
