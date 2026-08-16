import { describe, expect, test } from "bun:test";
import {
  formatStoryPost,
  legacyFormatCouldBreakLinks,
  markdownUrlWithoutProtocol,
} from "../src/format";
import { parseHackerNews } from "../src/hn";

describe("Hacker News parsing", () => {
  test("returns only the first ten stories and resolves HN links", () => {
    const html = makeFrontPage(12, {
      1: { title: "Ask HN: What now?", href: "item?id=1001" },
    });

    const stories = parseHackerNews(html);

    expect(stories).toHaveLength(10);
    expect(stories[0]).toEqual({
      id: "1001",
      rank: 1,
      title: "Ask HN: What now?",
      url: "https://news.ycombinator.com/item?id=1001",
      commentsUrl: "https://news.ycombinator.com/item?id=1001",
    });
    expect(stories[9]?.id).toBe("1010");
  });

  test("rejects an incomplete parse instead of taking a bad baseline", () => {
    expect(() => parseHackerNews(makeFrontPage(9))).toThrow(
      "only 9 parseable stories",
    );
  });
});

describe("Textlog post formatting", () => {
  test("builds protocol-free Markdown links", () => {
    const post = formatStoryPost({
      id: "42",
      rank: 1,
      title: "A [small] \\ test",
      url: "https://example.com/a_(b)",
      commentsUrl: "http://news.ycombinator.com/item?id=42",
    });

    expect(post).toBe(
      "[A \\[small\\] \\\\ test](example.com/a_%28b%29)\n[comments](news.ycombinator.com/item?id=42)",
    );
  });

  test("also strips protocol-relative prefixes", () => {
    expect(markdownUrlWithoutProtocol("//example.com/a b")).toBe(
      "example.com/a%20b",
    );
  });

  test("places comments on the same line after the summary", () => {
    const post = formatStoryPost({
      id: "42",
      rank: 1,
      title: "Story",
      url: "https://example.com/story",
      commentsUrl: "https://news.ycombinator.com/item?id=42",
    }, "A compact summary.");

    expect(post).toBe(
      "[Story](example.com/story)\nA compact summary. [comments](news.ycombinator.com/item?id=42)",
    );
  });

  test("caps the complete post at 280 characters by shortening the summary", () => {
    const post = formatStoryPost({
      id: "42",
      rank: 1,
      title: "Story",
      url: "https://example.com/story",
      commentsUrl: "https://news.ycombinator.com/item?id=42",
    }, "x".repeat(280));

    expect(Array.from(post)).toHaveLength(280);
    expect(post.startsWith("[Story](example.com/story)")).toBe(true);
    expect(post.split("\n")[1]?.includes("… [comments]")).toBe(true);
    expect(post.endsWith("[comments](news.ycombinator.com/item?id=42)")).toBe(true);
  });

  test("removes summary hashtags instead of truncating them", () => {
    const post = formatStoryPost({
      id: "42",
      rank: 1,
      title: "Story",
      url: "https://example.com/story",
      commentsUrl: "https://news.ycombinator.com/item?id=42",
    }, `${"x".repeat(200)} #averylonghashtag`);

    expect(Array.from(post).length).toBeLessThanOrEqual(280);
    expect(post).not.toContain("#averylonghashtag");
    expect(post).not.toMatch(/#[\p{L}\p{N}_]*…/u);
  });

  test("shortens a long title without breaking either link", () => {
    const post = formatStoryPost({
      id: "42",
      rank: 1,
      title: "A [long] title ".repeat(30),
      url: "https://example.com/story",
      commentsUrl: "https://news.ycombinator.com/item?id=42",
    });

    expect(Array.from(post)).toHaveLength(280);
    expect(post.split("\n")[0]?.startsWith("[A \\[long\\] title ")).toBe(true);
    expect(post.split("\n")[0]?.endsWith("…](example.com/story)")).toBe(true);
    expect(post.endsWith("[comments](news.ycombinator.com/item?id=42)")).toBe(true);
  });

  test("omits a comments link that cannot fit intact", () => {
    const post = formatStoryPost({
      id: "42",
      rank: 1,
      title: "Story",
      url: "https://example.com/story",
      commentsUrl: `https://news.ycombinator.com/${"x".repeat(280)}`,
    });

    expect(post).toBe("[Story](example.com/story)");
    expect(post).not.toContain("comments");
  });

  test("detects only stories whose legacy formatting could break a link", () => {
    const story = {
      id: "42",
      rank: 1,
      title: "Story",
      url: "https://example.com/story",
      commentsUrl: "https://news.ycombinator.com/item?id=42",
    };

    expect(legacyFormatCouldBreakLinks(story)).toBe(false);
    expect(legacyFormatCouldBreakLinks({
      ...story,
      title: "A very long title ".repeat(20),
    })).toBe(true);
  });
});

function makeFrontPage(
  count: number,
  overrides: Record<number, { title: string; href: string }> = {},
): string {
  const rows = Array.from({ length: count }, (_, index) => {
    const rank = index + 1;
    const id = 1000 + rank;
    const override = overrides[rank];
    const title = override?.title ?? `Story ${rank}`;
    const href = override?.href ?? `https://example.com/${id}`;
    return `
      <tr class="athing" id="${id}">
        <td><span class="rank">${rank}.</span></td>
        <td class="title"><span class="titleline"><a href="${href}">${title}</a></span></td>
      </tr>
      <tr><td class="subtext"><a href="item?id=${id}">comments</a></td></tr>
    `;
  });
  return `<html><body><table>${rows.join("")}</table></body></html>`;
}
