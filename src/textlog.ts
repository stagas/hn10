export interface TextlogClientOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface TextlogPostResult {
  id: string | null;
}

export class TextlogHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "TextlogHttpError";
  }
}

export class TextlogClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TextlogClientOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? "https://textlog.cc/api/v1").replace(
      /\/$/,
      "",
    );
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createPost(body: string): Promise<TextlogPostResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/posts`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const detail = await response.text();
      const suffix = detail ? `: ${detail.slice(0, 500)}` : "";
      throw new TextlogHttpError(
        `Textlog request failed with ${response.status} ${response.statusText}${suffix}`,
        response.status,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }

    const payload: unknown = await response.json();
    return { id: extractPostId(payload) };
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function extractPostId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const directId = record.id;
  if (typeof directId === "string" || typeof directId === "number") {
    return String(directId);
  }

  for (const wrapper of ["data", "post"] as const) {
    const wrapped = record[wrapper];
    if (wrapped && typeof wrapped === "object") {
      const wrappedId = (wrapped as Record<string, unknown>).id;
      if (typeof wrappedId === "string" || typeof wrappedId === "number") {
        return String(wrappedId);
      }
    }
  }

  return null;
}
