export interface HnStory {
  id: string;
  rank: number;
  title: string;
  url: string;
  commentsUrl: string;
}

export type StoryStatus =
  | "baseline"
  | "pending"
  | "publishing"
  | "published"
  | "uncertain";

export interface StoredStory extends HnStory {
  firstSeenAt: number;
  lastSeenAt: number;
  status: StoryStatus;
  attemptCount: number;
  nextAttemptAt: number;
  postedAt: number | null;
  textlogPostId: string | null;
  lastError: string | null;
}
