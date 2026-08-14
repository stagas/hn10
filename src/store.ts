import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { HnStory, StoredStory, StoryStatus } from "./types";

interface StoryRow {
  id: string;
  rank: number;
  title: string;
  url: string;
  comments_url: string;
  first_seen_at: number;
  last_seen_at: number;
  status: StoryStatus;
  attempt_count: number;
  next_attempt_at: number;
  posted_at: number | null;
  textlog_post_id: string | null;
  last_error: string | null;
  summary_added_at: number | null;
}

export class StoryStore {
  private readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA synchronous = FULL;");
    this.db.run("PRAGMA busy_timeout = 5000;");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY,
        rank INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        comments_url TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('baseline', 'pending', 'publishing', 'published', 'uncertain')
        ),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        posted_at INTEGER,
        textlog_post_id TEXT,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS stories_publish_queue
        ON stories(status, next_attempt_at, first_seen_at);
    `);
    this.addColumnIfMissing("summary_added_at", "INTEGER");

    // A process may have stopped after Textlog accepted a post but before the
    // acknowledgement was saved. Never retry that ambiguous request.
    this.db
      .query(`
        UPDATE stories
        SET status = 'uncertain',
            last_error = 'Interrupted during Textlog request; not retried to prevent a duplicate'
        WHERE status = 'publishing'
      `)
      .run();
  }

  baselineIfNeeded(stories: HnStory[], observedAt: number): boolean {
    if (this.isInitialized()) return false;

    this.db.run("BEGIN IMMEDIATE;");
    try {
      if (this.isInitialized()) {
        this.db.run("COMMIT;");
        return false;
      }

      for (const story of stories) {
        this.insertStory(story, "baseline", observedAt);
      }
      this.db
        .query("INSERT INTO metadata (key, value) VALUES ('initialized_at', $value)")
        .run({ value: String(observedAt) });
      this.db.run("COMMIT;");
      return true;
    } catch (error) {
      this.db.run("ROLLBACK;");
      throw error;
    }
  }

  observe(stories: HnStory[], observedAt: number): number {
    let discovered = 0;
    this.db.run("BEGIN IMMEDIATE;");
    try {
      for (const story of stories) {
        const result = this.insertStory(story, "pending", observedAt);
        discovered += result.changes;
        this.db
          .query(`
            UPDATE stories
            SET rank = $rank,
                title = $title,
                url = $url,
                comments_url = $commentsUrl,
                last_seen_at = $lastSeenAt
            WHERE id = $id
          `)
          .run({
            id: story.id,
            rank: story.rank,
            title: story.title,
            url: story.url,
            commentsUrl: story.commentsUrl,
            lastSeenAt: observedAt,
          });
      }
      this.db.run("COMMIT;");
      return discovered;
    } catch (error) {
      this.db.run("ROLLBACK;");
      throw error;
    }
  }

  claimNext(now: number): StoredStory | null {
    this.db.run("BEGIN IMMEDIATE;");
    try {
      const row = this.db
        .query<StoryRow, { now: number }>(`
          SELECT * FROM stories
          WHERE status = 'pending' AND next_attempt_at <= $now
          ORDER BY first_seen_at ASC, rowid ASC
          LIMIT 1
        `)
        .get({ now });

      if (!row) {
        this.db.run("COMMIT;");
        return null;
      }

      this.db
        .query(`
          UPDATE stories
          SET status = 'publishing', attempt_count = attempt_count + 1, last_error = NULL
          WHERE id = $id AND status = 'pending'
        `)
        .run({ id: row.id });
      this.db.run("COMMIT;");

      return { ...mapStory(row), status: "publishing", attemptCount: row.attempt_count + 1 };
    } catch (error) {
      this.db.run("ROLLBACK;");
      throw error;
    }
  }

  markPublished(
    id: string,
    postedAt: number,
    textlogPostId: string | null,
    summaryAdded = false,
  ): void {
    this.db
      .query(`
        UPDATE stories
        SET status = 'published',
            posted_at = $postedAt,
            textlog_post_id = $textlogPostId,
            summary_added_at = $summaryAddedAt,
            last_error = NULL
        WHERE id = $id AND status = 'publishing'
      `)
      .run({
        id,
        postedAt,
        textlogPostId,
        summaryAddedAt: summaryAdded ? postedAt : null,
      });
    this.setMetadata("last_published_at", String(postedAt));
  }

  markRetry(id: string, error: string, nextAttemptAt: number): void {
    this.db
      .query(`
        UPDATE stories
        SET status = 'pending', last_error = $error, next_attempt_at = $nextAttemptAt
        WHERE id = $id AND status = 'publishing'
      `)
      .run({ id, error, nextAttemptAt });
  }

  markUncertain(id: string, error: string): void {
    this.db
      .query(`
        UPDATE stories
        SET status = 'uncertain', last_error = $error
        WHERE id = $id AND status = 'publishing'
      `)
      .run({ id, error });
  }

  getLastPublishedAt(): number | null {
    const value = this.getMetadata("last_published_at");
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  getStory(id: string): StoredStory | null {
    const row = this.db
      .query<StoryRow, { id: string }>("SELECT * FROM stories WHERE id = $id")
      .get({ id });
    return row ? mapStory(row) : null;
  }

  countStories(): number {
    const row = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM stories")
      .get();
    return row?.count ?? 0;
  }

  getPostsNeedingSummary(): StoredStory[] {
    return this.db
      .query<StoryRow, []>(`
        SELECT * FROM stories
        WHERE status = 'published'
          AND textlog_post_id IS NOT NULL
          AND summary_added_at IS NULL
        ORDER BY posted_at ASC, rowid ASC
      `)
      .all()
      .map(mapStory);
  }

  markSummaryAdded(id: string, addedAt: number): void {
    this.db
      .query(`
        UPDATE stories
        SET summary_added_at = $addedAt, last_error = NULL
        WHERE id = $id AND status = 'published'
      `)
      .run({ id, addedAt });
  }

  close(): void {
    this.db.close(true);
  }

  private isInitialized(): boolean {
    return this.getMetadata("initialized_at") !== null;
  }

  private addColumnIfMissing(name: string, declaration: string): void {
    const columns = this.db.query<{ name: string }, []>("PRAGMA table_info(stories)").all();
    if (!columns.some((column) => column.name === name)) {
      this.db.run(`ALTER TABLE stories ADD COLUMN ${name} ${declaration}`);
    }
  }

  private getMetadata(key: string): string | null {
    const row = this.db
      .query<{ value: string }, { key: string }>(
        "SELECT value FROM metadata WHERE key = $key",
      )
      .get({ key });
    return row?.value ?? null;
  }

  private setMetadata(key: string, value: string): void {
    this.db
      .query(`
        INSERT INTO metadata (key, value) VALUES ($key, $value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run({ key, value });
  }

  private insertStory(
    story: HnStory,
    status: "baseline" | "pending",
    observedAt: number,
  ): { changes: number } {
    return this.db
      .query(`
        INSERT OR IGNORE INTO stories (
          id, rank, title, url, comments_url, first_seen_at, last_seen_at, status
        ) VALUES (
          $id, $rank, $title, $url, $commentsUrl, $observedAt, $observedAt, $status
        )
      `)
      .run({
        id: story.id,
        rank: story.rank,
        title: story.title,
        url: story.url,
        commentsUrl: story.commentsUrl,
        observedAt,
        status,
      });
  }
}

function mapStory(row: StoryRow): StoredStory {
  return {
    id: row.id,
    rank: row.rank,
    title: row.title,
    url: row.url,
    commentsUrl: row.comments_url,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    postedAt: row.posted_at,
    textlogPostId: row.textlog_post_id,
    lastError: row.last_error,
    summaryAddedAt: row.summary_added_at,
  };
}
