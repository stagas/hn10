import * as cheerio from "cheerio";
import type { HnStory } from "./types";

const HN_ORIGIN = "https://news.ycombinator.com";

export interface HackerNewsOptions {
  url?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function parseHackerNews(html: string, limit = 10): HnStory[] {
  const $ = cheerio.load(html);
  const stories: HnStory[] = [];

  $("tr.athing").each((index, element) => {
    if (stories.length >= limit) return false;

    const row = $(element);
    const id = row.attr("id")?.trim();
    const titleLink = row.find(".titleline > a").first();
    const title = titleLink.text().trim();
    const href = titleLink.attr("href")?.trim();

    if (!id || !title || !href) return;

    const rankText = row.find(".rank").first().text();
    const parsedRank = Number.parseInt(rankText, 10);
    const rank = Number.isFinite(parsedRank) ? parsedRank : index + 1;

    stories.push({
      id,
      rank,
      title,
      url: resolveStoryUrl(href),
      commentsUrl: `${HN_ORIGIN}/item?id=${encodeURIComponent(id)}`,
    });
  });

  if (stories.length < limit) {
    throw new Error(
      `Hacker News returned only ${stories.length} parseable stories; expected ${limit}`,
    );
  }

  return stories;
}

export async function fetchHackerNews(
  options: HackerNewsOptions = {},
): Promise<HnStory[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.url ?? `${HN_ORIGIN}/`;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const response = await fetchImpl(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "hn10/1.0 (Hacker News top-ten notifier)",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(
      `Hacker News request failed with ${response.status} ${response.statusText}`,
    );
  }

  return parseHackerNews(await response.text());
}

function resolveStoryUrl(href: string): string {
  const url = new URL(href, `${HN_ORIGIN}/`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported Hacker News story URL protocol: ${url.protocol}`);
  }
  return url.href;
}
