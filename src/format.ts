import type { HnStory } from "./types";

const MAX_POST_CHARACTERS = 280;
export const CURRENT_POST_FORMAT_VERSION = 4;

export function legacyFormatCouldBreakLinks(story: HnStory): boolean {
  const title = escapeMarkdownText(story.title.replace(/\s+/g, " ").trim());
  const storyUrl = markdownUrlWithoutProtocol(story.url);
  const commentsUrl = markdownUrlWithoutProtocol(story.commentsUrl);
  return characterCount(
    `[${title}](${storyUrl})\n[comments](${commentsUrl})`,
  ) > MAX_POST_CHARACTERS;
}

export function formatStoryPost(story: HnStory, summary?: string): string {
  const title = story.title.replace(/\s+/g, " ").trim();
  const storyUrl = markdownUrlWithoutProtocol(story.url);
  const commentsUrl = markdownUrlWithoutProtocol(story.commentsUrl);

  const fullFooter = `[comments](${commentsUrl})`;
  const minimumStoryLinkLength = characterCount(`[…](${storyUrl})`);
  const footer = minimumStoryLinkLength + 1 + characterCount(fullFooter) <= MAX_POST_CHARACTERS
    ? fullFooter
    : "";
  const storyLimit = MAX_POST_CHARACTERS - (footer ? characterCount(footer) + 1 : 0);
  const storyLink = fitStoryLink(title, storyUrl, storyLimit);
  const postWithoutSummary = `${storyLink}\n${footer}`;
  if (!summary) return footer ? postWithoutSummary : storyLink;

  const summaryLimit =
    MAX_POST_CHARACTERS - characterCount(storyLink) - characterCount(footer) - (footer ? 2 : 1);
  if (summaryLimit <= 0) {
    return footer ? postWithoutSummary : storyLink;
  }

  const fittedSummary = fitSummary(summary, summaryLimit);
  if (!fittedSummary) return footer ? postWithoutSummary : storyLink;
  return footer
    ? `${storyLink}\n${fittedSummary} ${footer}`
    : `${storyLink}\n${fittedSummary}`;
}

export function markdownUrlWithoutProtocol(value: string): string {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/^\/\//, "")
    .replace(/[()\s]/g, (character) =>
      `%${character.codePointAt(0)?.toString(16).toUpperCase()}`,
    );
}

function escapeMarkdownText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1");
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function fitStoryLink(title: string, url: string, limit: number): string {
  const linkOverhead = characterCount(`[](${url})`);
  if (linkOverhead >= limit) {
    return truncateWithEllipsis(escapeMarkdownText(title), limit);
  }

  const textLimit = limit - linkOverhead;
  const fullTitle = escapeMarkdownText(title);
  if (characterCount(fullTitle) <= textLimit) return `[${fullTitle}](${url})`;

  const characters = Array.from(title);
  let fitted = "…";
  for (let length = 1; length <= characters.length; length += 1) {
    const candidate = `${escapeMarkdownText(characters.slice(0, length).join(""))}…`;
    if (characterCount(candidate) > textLimit) break;
    fitted = candidate;
  }
  return `[${fitted}](${url})`;
}

function truncateWithEllipsis(value: string, limit: number): string {
  const characters = Array.from(value);
  if (characters.length <= limit) return value;
  if (limit === 1) return "…";
  return `${characters.slice(0, limit - 1).join("").trimEnd()}…`;
}

function fitSummary(summary: string, limit: number): string {
  if (characterCount(summary) <= limit) return summary;

  const withoutHashtags = summary
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateWithEllipsis(withoutHashtags, limit);
}
