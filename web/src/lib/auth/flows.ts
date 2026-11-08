import type { ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

import { parseSetCookie, type AppliedCookie } from "./cookies";

/**
 * Sign-in, session, and profile operations against the API. Each function takes
 * the client, so tests can supply a fake. Every failure becomes a fixed message.
 * Raw API text and network errors are never shown to the user.
 */

export type User = components["schemas"]["User"];

export type SessionState =
  | { state: "signed-in"; user: User; csrfToken: string }
  | { state: "signed-out" }
  | { state: "expired" }
  | { state: "unavailable" };

export interface ProfileValues {
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
}

export type FlowFailure = { ok: false; message: string; expired?: boolean };
export type FlowResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | FlowFailure;

const UNAVAILABLE = "Holoraa cannot be reached right now. Try again shortly.";
const REFUSED = "This request was refused. Reload the page and try again.";
const GENERIC = "Something went wrong. Try again.";

export const MESSAGES = {
  unavailable: UNAVAILABLE,
  send: {
    400: "Enter a valid email address.",
    403: REFUSED,
    429: "Too many codes requested. Wait a few minutes and try again.",
    503: "The code could not be sent, so nothing was recorded. Try again shortly.",
  },
  verify: {
    400: "Enter the six-digit code from the email.",
    401: "That code is invalid or has expired. Request a new one.",
    403: REFUSED,
    429: "Too many wrong attempts from this connection. Wait a few minutes.",
  },
  profile: {
    400: "Check the fields and try again.",
    403: REFUSED,
    409: "That username is already taken.",
    expired: "Your session has ended. Sign in again to save your profile.",
  },
  generic: GENERIC,
} as const;

type StatusMessages = Readonly<Record<number, string>>;

function messageFor(status: number, table: StatusMessages): string {
  return table[status] ?? GENERIC;
}

/** Runs one API call. A thrown error (network failure, bad response) becomes the unavailable message. */
async function attempt<T extends object>(run: () => Promise<FlowResult<T>>): Promise<FlowResult<T>> {
  try {
    return await run();
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }
}

function requestHeaders(origin: string, cookieHeader: string | null, csrfToken?: string): Record<string, string> {
  const headers: Record<string, string> = { Origin: origin };
  if (cookieHeader !== null) {
    headers.cookie = cookieHeader;
  }
  if (csrfToken !== undefined) {
    headers["X-CSRF-Token"] = csrfToken;
  }
  return headers;
}

function setCookiesOf(response: Response): AppliedCookie[] {
  const cookies: AppliedCookie[] = [];
  for (const header of response.headers.getSetCookie()) {
    const parsed = parseSetCookie(header);
    if (parsed !== null) {
      cookies.push(parsed);
    }
  }
  return cookies;
}

/** Reads the current session. A missing cookie is "signed-out" without a request. */
export async function loadSession(client: ApiClient, cookieHeader: string | null): Promise<SessionState> {
  if (cookieHeader === null) {
    return { state: "signed-out" };
  }
  try {
    const { data, response } = await client.GET("/v1/auth/session", {
      headers: { cookie: cookieHeader },
    });
    if (response.status === 200 && data) {
      return { state: "signed-in", user: data.user, csrfToken: data.csrfToken };
    }
    if (response.status === 401) {
      return { state: "expired" };
    }
    return { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

export async function sendCode(
  client: ApiClient,
  origin: string,
  email: string,
): Promise<FlowResult<{ challengeId: string }>> {
  return attempt(async (): Promise<FlowResult<{ challengeId: string }>> => {
    const { data, response } = await client.POST("/v1/auth/otp", {
      headers: requestHeaders(origin, null),
      body: { email },
    });
    if (response.status === 202 && data) {
      return { ok: true, challengeId: data.challengeId };
    }
    return { ok: false, message: messageFor(response.status, MESSAGES.send) };
  });
}

export async function verifyCode(
  client: ApiClient,
  input: { origin: string; cookieHeader: string | null; challengeId: string; code: string },
): Promise<FlowResult<{ user: User; cookies: AppliedCookie[] }>> {
  return attempt(async (): Promise<FlowResult<{ user: User; cookies: AppliedCookie[] }>> => {
    const { data, response } = await client.POST("/v1/auth/otp/verify", {
      headers: requestHeaders(input.origin, input.cookieHeader),
      body: { challengeId: input.challengeId, code: input.code },
    });
    if (response.status === 200 && data) {
      return { ok: true, user: data.user, cookies: setCookiesOf(response) };
    }
    return { ok: false, message: messageFor(response.status, MESSAGES.verify) };
  });
}

/** Revokes the session. With no session there is nothing to revoke, so the call succeeds. */
export async function signOut(
  client: ApiClient,
  input: { origin: string; cookieHeader: string | null },
): Promise<FlowResult<{ cookies: AppliedCookie[] }>> {
  return attempt(async (): Promise<FlowResult<{ cookies: AppliedCookie[] }>> => {
    const session = await loadSession(client, input.cookieHeader);
    if (session.state !== "signed-in") {
      return { ok: true, cookies: [] };
    }
    const { response } = await client.POST("/v1/auth/logout", {
      headers: requestHeaders(input.origin, input.cookieHeader, session.csrfToken),
    });
    if (response.status === 204) {
      return { ok: true, cookies: setCookiesOf(response) };
    }
    return { ok: false, message: messageFor(response.status, MESSAGES.profile) };
  });
}

export async function saveProfile(
  client: ApiClient,
  input: { origin: string; cookieHeader: string | null; values: ProfileValues },
): Promise<FlowResult<{ user: User }>> {
  return attempt(async (): Promise<FlowResult<{ user: User }>> => {
    const session = await loadSession(client, input.cookieHeader);
    if (session.state !== "signed-in") {
      return { ok: false, message: MESSAGES.profile.expired, expired: true };
    }
    const { data, response } = await client.PATCH("/v1/me", {
      headers: requestHeaders(input.origin, input.cookieHeader, session.csrfToken),
      body: input.values,
    });
    if (response.status === 200 && data) {
      return { ok: true, user: data.user };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.profile.expired, expired: true };
    }
    return { ok: false, message: messageFor(response.status, MESSAGES.profile) };
  });
}

export type UserSummary = components["schemas"]["UserSummary"];
export type PublicProfile = components["schemas"]["PublicProfile"];

export async function searchUsers(
  client: ApiClient,
  input: { cookieHeader: string | null; query: string; limit?: number },
): Promise<FlowResult<{ users: UserSummary[] }>> {
  const trimmed = input.query.trim();
  if (!trimmed) {
    return { ok: true, users: [] };
  }
  return attempt(async (): Promise<FlowResult<{ users: UserSummary[] }>> => {
    const { data, response } = await client.GET("/v1/users", {
      headers: input.cookieHeader ? { cookie: input.cookieHeader } : {},
      params: {
        query: {
          q: trimmed,
          limit: input.limit ?? 10,
        },
      },
    });
    if (response.status === 200 && data) {
      return { ok: true, users: data.users };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.profile.expired, expired: true };
    }
    if (response.status === 429) {
      return { ok: false, message: "Too many search requests. Wait a minute and try again." };
    }
    return { ok: false, message: GENERIC };
  });
}

export async function getPublicProfile(
  client: ApiClient,
  input: { cookieHeader: string | null; username: string },
): Promise<FlowResult<{ profile: PublicProfile }>> {
  const trimmed = input.username.trim();
  if (!trimmed) {
    return { ok: false, message: "No profile has this username." };
  }
  return attempt(async (): Promise<FlowResult<{ profile: PublicProfile }>> => {
    const { data, response } = await client.GET("/v1/users/{username}", {
      headers: input.cookieHeader ? { cookie: input.cookieHeader } : {},
      params: {
        path: { username: trimmed },
      },
    });
    if (response.status === 200 && data) {
      return { ok: true, profile: data };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.profile.expired, expired: true };
    }
    if (response.status === 404) {
      return { ok: false, message: "No profile has this username." };
    }
    return { ok: false, message: GENERIC };
  });
}

export async function followUser(
  client: ApiClient,
  input: { origin: string; cookieHeader: string | null; username: string },
): Promise<FlowResult> {
  const trimmed = input.username.trim();
  return attempt(async (): Promise<FlowResult> => {
    const session = await loadSession(client, input.cookieHeader);
    if (session.state !== "signed-in") {
      return { ok: false, message: MESSAGES.profile.expired, expired: true };
    }
    const { response } = await client.POST("/v1/users/{username}/follow", {
      headers: requestHeaders(input.origin, input.cookieHeader, session.csrfToken),
      params: { path: { username: trimmed } },
    });
    if (response.status === 204) {
      return { ok: true };
    }
    if (response.status === 400) {
      return { ok: false, message: "You cannot follow yourself." };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.profile.expired, expired: true };
    }
    if (response.status === 403) {
      return { ok: false, message: REFUSED };
    }
    if (response.status === 404) {
      return { ok: false, message: "No profile has this username." };
    }
    if (response.status === 429) {
      return { ok: false, message: "Too many follow requests. Wait a minute and try again." };
    }
    return { ok: false, message: GENERIC };
  });
}

export async function unfollowUser(
  client: ApiClient,
  input: { origin: string; cookieHeader: string | null; username: string },
): Promise<FlowResult> {
  const trimmed = input.username.trim();
  return attempt(async (): Promise<FlowResult> => {
    const session = await loadSession(client, input.cookieHeader);
    if (session.state !== "signed-in") {
      return { ok: false, message: MESSAGES.profile.expired, expired: true };
    }
    const { response } = await client.DELETE("/v1/users/{username}/follow", {
      headers: requestHeaders(input.origin, input.cookieHeader, session.csrfToken),
      params: { path: { username: trimmed } },
    });
    if (response.status === 204) {
      return { ok: true };
    }
    if (response.status === 401) {
      return { ok: false, message: MESSAGES.profile.expired, expired: true };
    }
    if (response.status === 403) {
      return { ok: false, message: REFUSED };
    }
    if (response.status === 404) {
      return { ok: false, message: "No profile has this username." };
    }
    if (response.status === 429) {
      return { ok: false, message: "Too many follow requests. Wait a minute and try again." };
    }
    return { ok: false, message: GENERIC };
  });
}
