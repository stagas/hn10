import { Hn10Bot } from "./bot";
import { loadConfig } from "./config";
import { fetchHackerNews } from "./hn";
import { formatStoryPost } from "./format";
import { StoryStore } from "./store";
import { TextlogClient } from "./textlog";
import { ArticleSummarizer } from "./summarizer";

const config = loadConfig();
const store = new StoryStore(config.dbPath);
const textlog = new TextlogClient({
  token: config.textlogToken,
  baseUrl: config.textlogApiUrl,
  timeoutMs: config.requestTimeoutMs,
});
const summarizer = new ArticleSummarizer({
  apiKey: config.openRouterApiKey,
  model: config.openRouterModel,
});
const bot = new Hn10Bot({
  store,
  fetchStories: () =>
    fetchHackerNews({
      url: config.hnUrl,
      timeoutMs: config.requestTimeoutMs,
    }),
  publish: (body) => textlog.createPost(body),
  summarize: (story) => summarizer.summarize(story.url),
  minPostIntervalMs: config.minPostIntervalMs,
});

const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => shutdown.abort());
}

console.info("hn10 started", {
  pollIntervalMs: config.pollIntervalMs,
  minPostIntervalMs: config.minPostIntervalMs,
  dbPath: config.dbPath,
});

await backfillPublishedSummaries();

try {
  while (!shutdown.signal.aborted) {
    try {
      const result = await bot.runOnce();
      console.info("hn10 cycle", result);
    } catch (error) {
      console.error("hn10 cycle failed", error);
    }
    await sleep(config.pollIntervalMs, shutdown.signal);
  }
} finally {
  store.close();
  console.info("hn10 stopped");
}

async function backfillPublishedSummaries(): Promise<void> {
  const posts = store.getPostsNeedingSummary();
  if (posts.length === 0) return;

  console.info(`backfilling summaries for ${posts.length} published posts`);
  for (const story of posts) {
    if (shutdown.signal.aborted) return;
    try {
      const summary = await summarizer.summarize(story.url);
      await textlog.updatePost(
        story.textlogPostId!,
        formatStoryPost(story, summary),
      );
      store.markSummaryAdded(story.id, Date.now());
      console.info("summary backfilled", { storyId: story.id });
    } catch (error) {
      console.error("summary backfill failed", { storyId: story.id, error });
    }
  }
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });

    function done(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
