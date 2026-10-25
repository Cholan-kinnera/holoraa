import createClient from "openapi-fetch";

import type { paths } from "./schema";

/**
 * Typed client for the Holoraa API, generated from contracts/openapi.yaml.
 *
 * The web app calls the API from the server only (in Server Components), so
 * the browser never needs CORS access and never sees the API address.
 */
export type ApiClient = ReturnType<typeof createClient<paths>>;

/**
 * Returns the API base URL from the server environment, or null when it is
 * not configured. Callers show that state explicitly instead of guessing.
 */
export function readApiBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const raw = env.HOLORAA_API_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function createApiClient(baseUrl: string): ApiClient {
  return createClient<paths>({ baseUrl });
}
