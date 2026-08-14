import { describe, expect, test } from "bun:test";
import { TextlogClient, TextlogHttpError } from "../src/textlog";

describe("TextlogClient", () => {
  test("posts the documented JSON body with bearer authentication", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl = (async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({ data: { id: 123 } }, { status: 201 });
    }) as typeof fetch;
    const client = new TextlogClient({
      token: "secret-token",
      baseUrl: "https://textlog.test/api/v1/",
      fetchImpl,
    });

    const result = await client.createPost("hello");

    expect(requestUrl).toBe("https://textlog.test/api/v1/posts");
    expect(requestInit?.method).toBe("POST");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer secret-token",
    );
    expect(requestInit?.body).toBe(JSON.stringify({ body: "hello" }));
    expect(result.id).toBe("123");
  });

  test("surfaces an HTTP failure and Retry-After delay", async () => {
    const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{"error":{"code":"limited"}}', {
        status: 429,
        headers: { "retry-after": "12" },
      })) as unknown as typeof fetch;
    const client = new TextlogClient({ token: "token", fetchImpl });

    try {
      await client.createPost("hello");
      throw new Error("Expected createPost to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TextlogHttpError);
      expect((error as TextlogHttpError).status).toBe(429);
      expect((error as TextlogHttpError).retryAfterMs).toBe(12_000);
    }
  });
});
