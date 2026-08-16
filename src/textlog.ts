export interface TextlogClientOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface TextlogPostResult {
  id: string | null;
}

export interface TextlogPost {
  body: string;
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
    const response = await this.request(`${this.baseUrl}/posts`, "POST", body);
    const payload: unknown = await response.json();
    return { id: extractPostId(payload) };
  }

  async updatePost(id: string, body: string): Promise<void> {
    await this.request(
      `${this.baseUrl}/posts/${encodeURIComponent(id)}`,
      "PATCH",
      body,
    );
  }

  async getPost(id: string): Promise<TextlogPost> {
    const response = await this.request(
      `${this.baseUrl}/posts/${encodeURIComponent(id)}`,
      "GET",
    );
    const payload: unknown = await response.json();
    const body = extractPostBody(payload);
    if (body === null) throw new Error("Textlog response did not contain a post body");
    return { body };
  }

  private async request(
    url: string,
    method: "GET" | "POST" | "PATCH",
    body?: string,
  ): Promise<Response> {
    const request: RequestInit = {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (body !== undefined) request.body = JSON.stringify({ body });
    const response = await this.fetchImpl(url, request);

    if (!response.ok) {
      const detail = await response.text();
      const suffix = detail ? `: ${detail.slice(0, 500)}` : "";
      throw new TextlogHttpError(
        `Textlog request failed with ${response.status} ${response.statusText}${suffix}`,
        response.status,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }

    return response;
  }
}

function extractPostBody(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.body === "string") return record.body;
  for (const wrapper of ["data", "post"] as const) {
    const wrapped = record[wrapper];
    if (wrapped && typeof wrapped === "object") {
      const body = (wrapped as Record<string, unknown>).body;
      if (typeof body === "string") return body;
    }
  }
  return null;
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
