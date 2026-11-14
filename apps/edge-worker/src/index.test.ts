import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import app from "./index.js";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("edge worker", () => {
  it("reports edge health before the VPS origin is configured", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValue(1_007);
    const response = await app.request("/health", undefined, {});

    expect(response.status).toBe(200);
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
    await expect(response.json()).resolves.toEqual({
      data: {
        service: "bunker-edge",
        status: "ok"
      },
      success: true
    });
    expect(console.log).toHaveBeenCalledWith({
      duration_ms: 7,
      event: "edge_request_completed",
      method: "GET",
      path: "/health",
      request_id: requestId,
      status: 200
    });
  });

  it("returns a controlled unavailable response before origin secrets exist", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValue(1_009);
    const response = await app.request("/api/games/preview", undefined, {});

    expect(response.status).toBe(503);
    const requestId = response.headers.get("x-request-id");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "BACKEND_NOT_CONFIGURED",
        message: "Сервер гри ще не підключено"
      },
      success: false
    });
    expect(console.error).toHaveBeenCalledWith({
      duration_ms: 9,
      event: "edge_request_completed",
      method: "GET",
      path: "/api/games/preview",
      request_id: requestId,
      status: 503
    });
  });

  it("proxies API path and query while replacing the origin token", async () => {
    const originResponse = new Response(
      JSON.stringify({ data: { status: "ok" }, success: true }),
      {
        headers: {
          "content-type": "application/json",
          "set-cookie":
            "__Host-bunker_session=test; Path=/; HttpOnly; Secure; SameSite=Lax"
        }
      }
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(originResponse);

    const response = await app.request(
      "https://bunker-edge.example/api/games/preview?players=7",
      {
        headers: {
          "x-request-id": "untrusted-client-value",
          "x-bunker-origin-token": "untrusted-client-value"
        }
      },
      {
        ORIGIN_HTTP_URL: "https://bunker-origin.example",
        ORIGIN_SERVICE_TOKEN: "trusted-worker-secret"
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe(
      "__Host-bunker_session=test; Path=/; HttpOnly; Secure; SameSite=Lax"
    );
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [target, init] = fetchSpy.mock.calls[0] ?? [];
    expect(target).toBeInstanceOf(URL);
    if (!(target instanceof URL)) {
      throw new Error("Expected the gateway target to be a URL");
    }
    expect(target.href).toBe(
      "https://bunker-origin.example/api/games/preview?players=7"
    );
    expect(new Headers(init?.headers).get("x-bunker-origin-token")).toBe(
      "trusted-worker-secret"
    );
    const requestId = response.headers.get("x-request-id");
    expect(requestId).not.toBe("untrusted-client-value");
    expect(new Headers(init?.headers).get("x-request-id")).toBe(requestId);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
      "trusted-worker-secret"
    );
  });

  it("does not proxy requests when the configured origin URL is invalid", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await app.request(
      "/api/games/preview",
      undefined,
      {
        ORIGIN_HTTP_URL: "not-a-url",
        ORIGIN_SERVICE_TOKEN: "trusted-worker-secret"
      }
    );

    expect(response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards a request body for mutating API methods", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    const response = await app.request(
      "https://bunker-edge.example/api/auth/telegram",
      {
        body: JSON.stringify({ initData: "signed-data" }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      },
      {
        ORIGIN_HTTP_URL: "https://bunker-origin.example",
        ORIGIN_SERVICE_TOKEN: "trusted-worker-secret"
      }
    );

    expect(response.status).toBe(204);

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(ReadableStream);
  });

  it("streams realtime events without buffering the origin body", async () => {
    const encoder = new TextEncoder();
    const originBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: ready\ndata: {"code":"K7M4Q2"}\n\n')
        );
        controller.enqueue(
          encoder.encode(
            'event: state_changed\ndata: {"revision":1}\n\n'
          )
        );
        controller.close();
      }
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(originBody, {
        headers: { "content-type": "text/event-stream" }
      })
    );

    const response = await app.request(
      "https://bunker-edge.example/api/realtime/K7M4Q2",
      undefined,
      {
        ORIGIN_HTTP_URL: "https://bunker-origin.example",
        ORIGIN_SERVICE_TOKEN: "trusted-worker-secret"
      }
    );
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error("Expected a proxied realtime stream");
    }

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const first = await reader.read();
    const second = await reader.read();
    const payload =
      new TextDecoder().decode(first.value) +
      new TextDecoder().decode(second.value);
    expect(payload).toContain("event: ready");
    expect(payload).toContain("event: state_changed");
  });
});
