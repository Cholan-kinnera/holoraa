import type { ApiClient } from "./api/client";

/**
 * The state of one check, as the status page shows it.
 *
 * - "ok": the check succeeded.
 * - "unreachable": the API could not be contacted, or the database check failed.
 * - "unknown": the check was not run, because a prerequisite failed.
 * - "not-configured": HOLORAA_API_URL is missing or invalid.
 */
export type CheckState = "ok" | "unreachable" | "unknown" | "not-configured";

export interface StatusReport {
  api: { state: CheckState };
  database: { state: CheckState; detail?: string };
  checkedAt: string;
}

/**
 * Runs the two foundation checks through the generated client.
 *
 * Network failures and malformed responses are reported as "unreachable".
 * The status page never shows raw error text; only the fixed problem detail
 * that the API itself returns is passed through.
 */
export async function loadStatus(client: ApiClient | null, now: Date = new Date()): Promise<StatusReport> {
  const checkedAt = now.toISOString();

  if (client === null) {
    return {
      api: { state: "not-configured" },
      database: { state: "unknown" },
      checkedAt,
    };
  }

  const api = await checkApi(client);
  if (api !== "ok") {
    return { api: { state: api }, database: { state: "unknown" }, checkedAt };
  }

  return { api: { state: "ok" }, database: await checkDatabase(client), checkedAt };
}

async function checkApi(client: ApiClient): Promise<"ok" | "unreachable"> {
  try {
    const { data } = await client.GET("/v1/health");
    return data?.status === "ok" ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function checkDatabase(client: ApiClient): Promise<StatusReport["database"]> {
  try {
    const { data, error, response } = await client.GET("/v1/ready");
    if (response.status === 200 && data?.database === "ok") {
      return { state: "ok" };
    }
    if (response.status === 503) {
      return { state: "unreachable", detail: error?.detail };
    }
    return { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}
