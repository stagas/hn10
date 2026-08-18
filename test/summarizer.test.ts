import { describe, expect, test } from "bun:test";
import { ArticleSummarizer, capTweetSummary } from "../src/summarizer";

describe("tweet-sized summaries", () => {
  test("leaves summaries of at most 280 characters unchanged", () => {
    expect(capTweetSummary("A short summary.")).toBe("A short summary.");
    expect(Array.from(capTweetSummary("x".repeat(280)))).toHaveLength(280);
  });

  test("caps longer summaries at 280 characters with an ellipsis", () => {
    const summary = capTweetSummary("x".repeat(300));
    expect(Array.from(summary)).toHaveLength(280);
    expect(summary.endsWith("…")).toBe(true);
  });

  test("normalizes model formatting before measuring", () => {
    expect(capTweetSummary(" <b>Hello</b>   world ")).toBe("Hello world");
  });

  test("turns unavailable-summary responses into an empty string", () => {
    expect(capTweetSummary("Summary not available.")).toBe("");
    expect(capTweetSummary("Summary is not available")).toBe("");
  });
});

describe("OpenRouter model fallback", () => {
  test("tries paid Gemma after the free model is rate limited", async () => {
    const models: string[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      models.push(body.model);
      return models.length === 1
        ? new Response("rate limited", { status: 429 })
        : Response.json({ choices: [{ message: { content: "Summary" } }] });
    }) as typeof fetch;
    const summarizer = new ArticleSummarizer({ apiKey: "test", fetchImpl });

    const response = await Reflect.get(summarizer, "requestSummary").call(summarizer, "article");

    expect(response.ok).toBe(true);
    expect(models).toEqual([
      "google/gemma-4-26b-a4b-it:free",
      "google/gemma-4-26b-a4b-it",
    ]);
  });
});
