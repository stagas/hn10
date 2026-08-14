import { formatStoryPost } from "./format";
import { TextlogHttpError, type TextlogPostResult } from "./textlog";
import type { StoryStore } from "./store";
import type { HnStory } from "./types";

export interface BotDependencies {
  store: StoryStore;
  fetchStories: () => Promise<HnStory[]>;
  publish: (body: string) => Promise<TextlogPostResult>;
  now?: () => number;
  minPostIntervalMs?: number;
}

export type CycleResult =
  | { kind: "baselined"; count: number }
  | { kind: "idle"; discovered: number }
  | { kind: "cooldown"; discovered: number }
  | { kind: "published"; discovered: number; storyId: string }
  | { kind: "retry_scheduled"; discovered: number; storyId: string; error: string }
  | { kind: "uncertain"; discovered: number; storyId: string; error: string };

export class Hn10Bot {
  private readonly now: () => number;
  private readonly minPostIntervalMs: number;

  constructor(private readonly dependencies: BotDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.minPostIntervalMs = dependencies.minPostIntervalMs ?? 101_000;
  }

  async runOnce(): Promise<CycleResult> {
    const stories = await this.dependencies.fetchStories();
    const now = this.now();

    if (this.dependencies.store.baselineIfNeeded(stories, now)) {
      return { kind: "baselined", count: stories.length };
    }

    const discovered = this.dependencies.store.observe(stories, now);
    const lastPublishedAt = this.dependencies.store.getLastPublishedAt();
    if (
      lastPublishedAt !== null &&
      now - lastPublishedAt < this.minPostIntervalMs
    ) {
      return { kind: "cooldown", discovered };
    }

    const story = this.dependencies.store.claimNext(now);
    if (!story) return { kind: "idle", discovered };

    try {
      const result = await this.dependencies.publish(formatStoryPost(story));
      this.dependencies.store.markPublished(story.id, this.now(), result.id);
      return { kind: "published", discovered, storyId: story.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof TextlogHttpError) {
        const retryDelay =
          error.retryAfterMs ?? exponentialBackoffMs(story.attemptCount);
        this.dependencies.store.markRetry(story.id, message, this.now() + retryDelay);
        return {
          kind: "retry_scheduled",
          discovered,
          storyId: story.id,
          error: message,
        };
      }

      // A transport failure is ambiguous: Textlog could have accepted the post
      // before the connection disappeared. Retrying could create a duplicate.
      this.dependencies.store.markUncertain(story.id, message);
      return { kind: "uncertain", discovered, storyId: story.id, error: message };
    }
  }
}

function exponentialBackoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempt - 1, 7));
}
