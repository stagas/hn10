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

  test("updates an existing post using PATCH", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl = (async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const client = new TextlogClient({
      token: "token",
      baseUrl: "https://textlog.test/api/v1",
      fetchImpl,
    });

    await client.updatePost("post/42", "updated body");

    expect(requestUrl).toBe("https://textlog.test/api/v1/posts/post%2F42");
    expect(requestInit?.method).toBe("PATCH");
    expect(requestInit?.body).toBe(JSON.stringify({ body: "updated body" }));
  });

  test("reads an existing post body for targeted migrations", async () => {
    const requests: Request[] = [];
    const client = new TextlogClient({
      token: "secret",
      fetchImpl: (async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ data: { body: "post body" } });
      }) as typeof fetch,
    });

    expect(await client.getPost("post/42")).toEqual({ body: "post body" });
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toEndWith("/posts/post%2F42");
  });
});
