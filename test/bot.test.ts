import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hn10Bot } from "../src/bot";
import { StoryStore } from "../src/store";
import type { HnStory } from "../src/types";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Hn10Bot", () => {
  test("cold starts silently, then publishes each new top-ten entrant once", async () => {
    const store = new StoryStore(temporaryDatabase());
    let currentStories = makeStories(1, 10);
    let now = 1_000;
    const posts: string[] = [];
    const bot = new Hn10Bot({
      store,
      fetchStories: async () => currentStories,
      publish: async (body) => {
        posts.push(body);
        return { id: "post-1" };
      },
      now: () => now,
      minPostIntervalMs: 1,
    });

    expect(await bot.runOnce()).toEqual({ kind: "baselined", count: 10 });
    expect(posts).toHaveLength(0);
    expect(store.countStories()).toBe(10);

    currentStories = makeStories(2, 11);
    now += 10;
    expect(await bot.runOnce()).toMatchObject({
      kind: "published",
      discovered: 1,
      storyId: "11",
    });
    expect(posts).toEqual([
      "[Story 11](example.com/11) [(comments)](news.ycombinator.com/item?id=11) #hn #hn10",
    ]);
    expect(store.getStory("11")?.status).toBe("published");

    now += 10;
    expect(await bot.runOnce()).toEqual({ kind: "idle", discovered: 0 });
    expect(posts).toHaveLength(1);
    store.close();
  });

  test("persists published IDs across a restart", async () => {
    const databasePath = temporaryDatabase();
    let currentStories = makeStories(1, 10);
    let now = 1_000;
    let postCount = 0;
    let store = new StoryStore(databasePath);
    let bot = makeBot();

    await bot.runOnce();
    currentStories = makeStories(2, 11);
    now += 10;
    await bot.runOnce();
    expect(postCount).toBe(1);
    store.close();

    store = new StoryStore(databasePath);
    bot = makeBot();
    now += 10;
    expect(await bot.runOnce()).toEqual({ kind: "idle", discovered: 0 });
    expect(postCount).toBe(1);
    store.close();

    function makeBot(): Hn10Bot {
      return new Hn10Bot({
        store,
        fetchStories: async () => currentStories,
        publish: async () => {
          postCount += 1;
          return { id: String(postCount) };
        },
        now: () => now,
        minPostIntervalMs: 1,
      });
    }
  });

  test("does not retry a request interrupted in its ambiguous in-flight state", () => {
    const databasePath = temporaryDatabase();
    let store = new StoryStore(databasePath);
    store.baselineIfNeeded(makeStories(1, 10), 1_000);
    store.observe(makeStories(2, 11), 2_000);

    expect(store.claimNext(2_000)?.id).toBe("11");
    expect(store.getStory("11")?.status).toBe("publishing");
    store.close();

    store = new StoryStore(databasePath);
    expect(store.getStory("11")?.status).toBe("uncertain");
    expect(store.claimNext(3_000)).toBeNull();
    store.close();
  });

  test("marks transport failures uncertain instead of risking a duplicate", async () => {
    const store = new StoryStore(temporaryDatabase());
    let currentStories = makeStories(1, 10);
    let now = 1_000;
    const bot = new Hn10Bot({
      store,
      fetchStories: async () => currentStories,
      publish: async () => {
        throw new TypeError("connection reset");
      },
      now: () => now,
      minPostIntervalMs: 1,
    });

    await bot.runOnce();
    currentStories = makeStories(2, 11);
    now += 10;
    expect(await bot.runOnce()).toMatchObject({
      kind: "uncertain",
      storyId: "11",
    });
    expect(store.getStory("11")?.status).toBe("uncertain");
    store.close();
  });
});

function makeStories(firstId: number, lastId: number): HnStory[] {
  return Array.from({ length: lastId - firstId + 1 }, (_, index) => {
    const id = String(firstId + index);
    return {
      id,
      rank: index + 1,
      title: `Story ${id}`,
      url: `https://example.com/${id}`,
      commentsUrl: `https://news.ycombinator.com/item?id=${id}`,
    };
  });
}

function temporaryDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "hn10-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "hn10.sqlite");
}
