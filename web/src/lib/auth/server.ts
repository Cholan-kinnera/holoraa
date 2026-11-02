import { cache } from "react";
import { cookies, headers } from "next/headers";

import { createApiClient, readApiBaseUrl, type ApiClient } from "@/lib/api/client";

import { isSessionCookieName, sessionCookieHeader, type AppliedCookie } from "./cookies";
import { loadSession, MESSAGES, type SessionState } from "./flows";

/**
 * Server-only helpers for pages and actions. They read the request, call the API
 * from the server, and write cookies. Nothing here runs in the browser.
 */

export type RequestContext = { ok: true; client: ApiClient; origin: string } | { ok: false; message: string };

/** The API client and the browser's origin for one request. The origin is forwarded so the API's Origin check still applies. */
export async function requestContext(): Promise<RequestContext> {
  const baseUrl = readApiBaseUrl();
  if (baseUrl === null) {
    return { ok: false, message: "Sign-in is not configured on this server." };
  }
  const origin = (await headers()).get("origin");
  if (origin === null || origin === "") {
    return { ok: false, message: MESSAGES.generic };
  }
  return { ok: true, client: createApiClient(baseUrl), origin };
}

/** The session cookie header the browser sent with this request, or null. */
export async function currentCookieHeader(): Promise<string | null> {
  return sessionCookieHeader((await cookies()).getAll());
}

/**
 * The session for this request. Cached per request, so the layout and the page
 * share one API call.
 */
export const getSession = cache(async (): Promise<SessionState> => {
  const baseUrl = readApiBaseUrl();
  if (baseUrl === null) {
    return { state: "unavailable" };
  }
  return loadSession(createApiClient(baseUrl), await currentCookieHeader());
});

/** Expires every session cookie the browser sent. Used when sign-out cannot be confirmed by the API. */
export async function clearSessionCookies(): Promise<void> {
  const cleared: AppliedCookie[] = (await cookies())
    .getAll()
    .filter((cookie) => isSessionCookieName(cookie.name))
    .map((cookie) => ({
      name: cookie.name,
      value: "",
      httpOnly: true,
      secure: cookie.name.startsWith("__Host-"),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    }));
  await applyCookies(cleared);
}

/** Copies API cookies to the browser. Only callable from a Server Action or Route Handler. */
export async function applyCookies(cookiesToApply: ReadonlyArray<AppliedCookie>): Promise<void> {
  const store = await cookies();
  for (const cookie of cookiesToApply) {
    store.set({
      name: cookie.name,
      value: cookie.value,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      path: cookie.path,
      maxAge: cookie.maxAge,
      expires: cookie.expires,
    });
  }
}
