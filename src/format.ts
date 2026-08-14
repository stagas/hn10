import type { HnStory } from "./types";

export function formatStoryPost(story: HnStory, summary?: string): string {
  const title = escapeMarkdownText(story.title.replace(/\s+/g, " ").trim());
  const storyUrl = markdownUrlWithoutProtocol(story.url);
  const commentsUrl = markdownUrlWithoutProtocol(story.commentsUrl);

  const link = `[${title}](${storyUrl}) [(comments)](${commentsUrl}) #hn #hn10`;
  return summary ? `${summary}\n\n${link}` : link;
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
