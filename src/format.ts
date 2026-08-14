import type { HnStory } from "./types";

const MAX_POST_CHARACTERS = 280;

export function formatStoryPost(story: HnStory, summary?: string): string {
  const title = escapeMarkdownText(story.title.replace(/\s+/g, " ").trim());
  const storyUrl = markdownUrlWithoutProtocol(story.url);
  const commentsUrl = markdownUrlWithoutProtocol(story.commentsUrl);

  const storyLink = `[${title}](${storyUrl})`;
  const footer = `[comments](${commentsUrl})`;
  const postWithoutSummary = `${storyLink}\n${footer}`;
  if (!summary) return truncateWithEllipsis(postWithoutSummary, MAX_POST_CHARACTERS);

  const summaryLimit =
    MAX_POST_CHARACTERS - characterCount(storyLink) - characterCount(footer) - 2;
  if (summaryLimit <= 0) {
    return truncateWithEllipsis(postWithoutSummary, MAX_POST_CHARACTERS);
  }

  return `${storyLink}\n${truncateWithEllipsis(summary, summaryLimit)}\n${footer}`;
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

function truncateWithEllipsis(value: string, limit: number): string {
  const characters = Array.from(value);
  if (characters.length <= limit) return value;
  if (limit === 1) return "…";
  return `${characters.slice(0, limit - 1).join("").trimEnd()}…`;
}
