import { describe, expect, test } from "bun:test";
import { capTweetSummary } from "../src/summarizer";

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
