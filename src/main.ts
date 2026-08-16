import { Hn10Bot } from "./bot";
import { loadConfig } from "./config";
import { fetchHackerNews } from "./hn";
import {
  CURRENT_POST_FORMAT_VERSION,
  formatStoryPost,
  legacyFormatCouldBreakLinks,
} from "./format";
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
  const posts = store.getPostsNeedingFormatVersion(CURRENT_POST_FORMAT_VERSION);
  if (posts.length === 0) return;

  console.info(`checking ${posts.length} published posts for format backfill`);
  for (const [index, story] of posts.entries()) {
    if (shutdown.signal.aborted) return;
    if (story.postFormatVersion === 4) {
      try {
        const post = await textlog.getPost(story.textlogPostId!);
        if (/\n[\t ]+\[comments\]\(/.test(post.body)) {
          await sleep(config.backfillIntervalMs, shutdown.signal);
          if (shutdown.signal.aborted) return;
          await textlog.updatePost(story.textlogPostId!, formatStoryPost(story));
          console.info("empty summary whitespace repaired", { storyId: story.id });
        }
        store.markPostFormatVersion(story.id, CURRENT_POST_FORMAT_VERSION, Date.now());
      } catch (error) {
        console.error("empty summary backfill failed", { storyId: story.id, error });
      }
      if (index < posts.length - 1) {
        await sleep(config.backfillIntervalMs, shutdown.signal);
      }
      continue;
    }
    const needsPatch = story.postFormatVersion < 3 || legacyFormatCouldBreakLinks(story);
    if (!needsPatch) {
      store.markPostFormatVersion(story.id, CURRENT_POST_FORMAT_VERSION, Date.now());
      continue;
    }
    try {
      // Version 3 posts already had summaries. We cannot reconstruct their
      // exact text locally, so repair broken links without inventing a new one.
      const summary = story.postFormatVersion < 3
        ? await summarizer.summarize(story.url)
        : undefined;
      await textlog.updatePost(
        story.textlogPostId!,
        formatStoryPost(story, summary),
      );
      store.markPostFormatVersion(story.id, CURRENT_POST_FORMAT_VERSION, Date.now());
      console.info("post format backfilled", {
        storyId: story.id,
        version: CURRENT_POST_FORMAT_VERSION,
      });
    } catch (error) {
      console.error("post format backfill failed", { storyId: story.id, error });
    }
    if (index < posts.length - 1) {
      await sleep(config.backfillIntervalMs, shutdown.signal);
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
