import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "./api/client";
import { loadStatus } from "./status";

/**
 * Builds an ApiClient whose GET responses are supplied per path.
 *
 * This stands in for the HTTP layer only. The real API is exercised by the
 * end-to-end check in docs/engineering/LOCAL_SETUP.md, against a real database.
 * The cast goes through unknown because the stub implements just the GET method.
 */
function stubClient(handlers: Record<string, () => Promise<unknown>>): ApiClient {
  return {
    GET: (path: string) => {
      const handler = handlers[path];
      if (handler === undefined) {
        throw new Error(`unexpected request to ${path}`);
      }
      return handler();
    },
  } as unknown as ApiClient;
}

function response(status: number): Response {
  return new Response(null, { status });
}

const NOW = new Date("2026-10-25T10:00:00.000Z");

describe("loadStatus", () => {
  it("reports not-configured when no client is available", async () => {
    const report = await loadStatus(null, NOW);

    expect(report.api.state).toBe("not-configured");
    expect(report.database.state).toBe("unknown");
    expect(report.checkedAt).toBe("2026-10-25T10:00:00.000Z");
  });

  it("reports both checks ok when the API and database answer", async () => {
    const client = stubClient({
      "/v1/health": async () => ({ data: { status: "ok" }, response: response(200) }),
      "/v1/ready": async () => ({ data: { status: "ready", database: "ok" }, response: response(200) }),
    });

    const report = await loadStatus(client, NOW);

    expect(report.api.state).toBe("ok");
    expect(report.database.state).toBe("ok");
  });

  it("reports the database unreachable and passes through the server's fixed detail", async () => {
    const client = stubClient({
      "/v1/health": async () => ({ data: { status: "ok" }, response: response(200) }),
      "/v1/ready": async () => ({
        error: { type: "about:blank", title: "Service Unavailable", status: 503, detail: "The database is not reachable." },
        response: response(503),
      }),
    });

    const report = await loadStatus(client, NOW);

    expect(report.api.state).toBe("ok");
    expect(report.database).toEqual({ state: "unreachable", detail: "The database is not reachable." });
  });

  it("does not call readiness when liveness throws, and reports the database as unknown", async () => {
    const ready = vi.fn(async () => ({ data: { status: "ready", database: "ok" }, response: response(200) }));
    const client = stubClient({
      "/v1/health": async () => {
        throw new TypeError("fetch failed");
      },
      "/v1/ready": ready,
    });

    const report = await loadStatus(client, NOW);

    expect(report.api.state).toBe("unreachable");
    expect(report.database.state).toBe("unknown");
    expect(ready).not.toHaveBeenCalled();
  });

  it("treats a liveness response without the expected body as unreachable", async () => {
    const client = stubClient({
      "/v1/health": async () => ({ data: { status: "degraded" }, response: response(200) }),
      "/v1/ready": async () => ({ data: { status: "ready", database: "ok" }, response: response(200) }),
    });

    const report = await loadStatus(client, NOW);

    expect(report.api.state).toBe("unreachable");
    expect(report.database.state).toBe("unknown");
  });

  it("treats a liveness error status as unreachable", async () => {
    const client = stubClient({
      "/v1/health": async () => ({ error: { status: 500 }, response: response(500) }),
    });

    const report = await loadStatus(client, NOW);

    expect(report.api.state).toBe("unreachable");
  });

  it("reports the database unknown when the readiness request throws", async () => {
    const client = stubClient({
      "/v1/health": async () => ({ data: { status: "ok" }, response: response(200) }),
      "/v1/ready": async () => {
        throw new TypeError("fetch failed");
      },
    });

    const report = await loadStatus(client, NOW);

    expect(report.api.state).toBe("ok");
    expect(report.database.state).toBe("unknown");
  });

  it("reports the database unknown for an unexpected readiness status", async () => {
    const client = stubClient({
      "/v1/health": async () => ({ data: { status: "ok" }, response: response(200) }),
      "/v1/ready": async () => ({ response: response(404) }),
    });

    const report = await loadStatus(client, NOW);

    expect(report.database.state).toBe("unknown");
  });
});
