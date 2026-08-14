export interface Config {
  textlogToken: string;
  textlogApiUrl: string;
  hnUrl: string;
  dbPath: string;
  pollIntervalMs: number;
  minPostIntervalMs: number;
  requestTimeoutMs: number;
  openRouterApiKey: string;
  openRouterModel: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const textlogToken = environment.TEXTLOG_TOKEN?.trim();
  if (!textlogToken) throw new Error("TEXTLOG_TOKEN is required");
  const openRouterApiKey = environment.OPENROUTER_API_KEY?.trim();
  if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required");

  return {
    textlogToken,
    textlogApiUrl:
      environment.TEXTLOG_API_URL?.trim() || "https://textlog.cc/api/v1",
    hnUrl: environment.HN_URL?.trim() || "https://news.ycombinator.com/",
    dbPath: environment.DB_PATH?.trim() || "./data/hn10.sqlite",
    pollIntervalMs: positiveInteger(environment.POLL_INTERVAL_MS, 60_000),
    minPostIntervalMs: positiveInteger(
      environment.MIN_POST_INTERVAL_MS,
      101_000,
    ),
    requestTimeoutMs: positiveInteger(environment.REQUEST_TIMEOUT_MS, 15_000),
    openRouterApiKey,
    openRouterModel:
      environment.OPENROUTER_MODEL?.trim() || "google/gemma-4-26b-a4b-it:free",
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${JSON.stringify(value)}`);
  }
  return parsed;
}
