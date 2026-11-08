import { describe, expect, it } from "vitest";

import type { ApiClient } from "@/lib/api/client";

import {
  followUser,
  getPublicProfile,
  loadSession,
  MESSAGES,
  saveProfile,
  searchUsers,
  sendCode,
  signOut,
  unfollowUser,
  verifyCode,
} from "./flows";

interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

interface Reply {
  status: number;
  body?: unknown;
  setCookie?: string[];
}

/**
 * A fake of the generated client. It returns real Response objects, so the
 * flows read headers and status exactly as they do with openapi-fetch. Replies
 * are keyed by "METHOD /path". A key mapped to an Error is thrown, which models
 * a network failure.
 */
function fakeClient(replies: Record<string, Reply | Error>, calls: Recorded[] = []): ApiClient {
  const handle = async (
    method: string,
    path: string,
    init?: { headers?: Record<string, string>; body?: unknown; params?: { path?: Record<string, string> } },
  ) => {
    let resolvedPath = path;
    if (init?.params?.path) {
      for (const [k, v] of Object.entries(init.params.path)) {
        resolvedPath = resolvedPath.replace(`{${k}}`, v);
      }
    }
    calls.push({ method, path: resolvedPath, headers: init?.headers ?? {}, body: init?.body });
    const reply = replies[`${method} ${resolvedPath}`] ?? replies[`${method} ${path}`];
    if (reply === undefined) {
      throw new Error(`unexpected ${method} ${resolvedPath}`);
    }
    if (reply instanceof Error) {
      throw reply;
    }
    const headers = new Headers({ "content-type": "application/json" });
    for (const cookie of reply.setCookie ?? []) {
      headers.append("set-cookie", cookie);
    }
    const response = new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers,
    });
    const data = response.ok && reply.body !== undefined ? reply.body : undefined;
    return { data, response };
  };
  return {
    GET: (path: string, init?: object) => handle("GET", path, init),
    POST: (path: string, init?: object) => handle("POST", path, init),
    PATCH: (path: string, init?: object) => handle("PATCH", path, init),
    DELETE: (path: string, init?: object) => handle("DELETE", path, init),
  } as unknown as ApiClient;
}

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.com",
  username: "ada",
  displayName: "Ada",
  bio: null,
  avatarUrl: null,
  profileComplete: true,
};

describe("loadSession", () => {
  it("is signed out without a request when there is no cookie", async () => {
    const calls: Recorded[] = [];
    expect(await loadSession(fakeClient({}, calls), null)).toEqual({ state: "signed-out" });
    expect(calls).toHaveLength(0);
  });

  it("returns the user and CSRF token for a valid session", async () => {
    const client = fakeClient({ "GET /v1/auth/session": { status: 200, body: { user, csrfToken: "csrf-1" } } });
    expect(await loadSession(client, "holoraa_session=tok")).toEqual({
      state: "signed-in",
      user,
      csrfToken: "csrf-1",
    });
  });

  it("reports an expired session on 401", async () => {
    const client = fakeClient({ "GET /v1/auth/session": { status: 401, body: { title: "x" } } });
    expect(await loadSession(client, "holoraa_session=tok")).toEqual({ state: "expired" });
  });

  it("reports unavailable on a network failure", async () => {
    const client = fakeClient({ "GET /v1/auth/session": new Error("connect ECONNREFUSED") });
    expect(await loadSession(client, "holoraa_session=tok")).toEqual({ state: "unavailable" });
  });
});

describe("sendCode", () => {
  it("forwards the browser origin and returns the challenge", async () => {
    const calls: Recorded[] = [];
    const client = fakeClient({ "POST /v1/auth/otp": { status: 202, body: { challengeId: "c-1" } } }, calls);
    expect(await sendCode(client, "http://127.0.0.1:3000", "ada@example.com")).toEqual({
      ok: true,
      challengeId: "c-1",
    });
    expect(calls[0]?.headers.Origin).toBe("http://127.0.0.1:3000");
  });

  it("maps 429 to the rate-limit message and never shows raw text", async () => {
    const client = fakeClient({ "POST /v1/auth/otp": { status: 429, body: { detail: "internal: bucket 42" } } });
    expect(await sendCode(client, "http://127.0.0.1:3000", "ada@example.com")).toEqual({
      ok: false,
      message: MESSAGES.send[429],
    });
  });

  it("reports unavailable when the request throws", async () => {
    const client = fakeClient({ "POST /v1/auth/otp": new TypeError("fetch failed") });
    expect(await sendCode(client, "http://127.0.0.1:3000", "ada@example.com")).toEqual({
      ok: false,
      message: MESSAGES.unavailable,
    });
  });
});

describe("verifyCode", () => {
  it("returns the parsed session cookie from the API", async () => {
    const client = fakeClient({
      "POST /v1/auth/otp/verify": {
        status: 200,
        body: { user },
        setCookie: ["holoraa_session=new; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600"],
      },
    });
    const result = await verifyCode(client, {
      origin: "http://127.0.0.1:3000",
      cookieHeader: null,
      challengeId: "c-1",
      code: "123456",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cookies).toHaveLength(1);
      expect(result.cookies[0]?.value).toBe("new");
    }
  });

  it("gives the same generic message for every 401", async () => {
    const client = fakeClient({ "POST /v1/auth/otp/verify": { status: 401, body: { title: "invalid" } } });
    expect(
      await verifyCode(client, { origin: "http://127.0.0.1:3000", cookieHeader: null, challengeId: "c", code: "000000" }),
    ).toEqual({ ok: false, message: MESSAGES.verify[401] });
  });

  it("forwards an existing session so the API can rotate it", async () => {
    const calls: Recorded[] = [];
    const client = fakeClient({ "POST /v1/auth/otp/verify": { status: 401 } }, calls);
    await verifyCode(client, {
      origin: "http://127.0.0.1:3000",
      cookieHeader: "holoraa_session=old",
      challengeId: "c",
      code: "000000",
    });
    expect(calls[0]?.headers.cookie).toBe("holoraa_session=old");
  });
});

describe("signOut", () => {
  it("sends the CSRF token from the session and returns the clearing cookie", async () => {
    const calls: Recorded[] = [];
    const client = fakeClient(
      {
        "GET /v1/auth/session": { status: 200, body: { user, csrfToken: "csrf-9" } },
        "POST /v1/auth/logout": { status: 204, setCookie: ["holoraa_session=; Path=/; Max-Age=0"] },
      },
      calls,
    );
    const result = await signOut(client, { origin: "http://127.0.0.1:3000", cookieHeader: "holoraa_session=tok" });
    expect(result.ok).toBe(true);
    const logout = calls.find((call) => call.path === "/v1/auth/logout");
    expect(logout?.headers["X-CSRF-Token"]).toBe("csrf-9");
    if (result.ok) {
      expect(result.cookies[0]?.maxAge).toBe(0);
    }
  });

  it("succeeds without a request when there is no session", async () => {
    const calls: Recorded[] = [];
    expect(await signOut(fakeClient({}, calls), { origin: "http://127.0.0.1:3000", cookieHeader: null })).toEqual({
      ok: true,
      cookies: [],
    });
    expect(calls).toHaveLength(0);
  });
});

describe("saveProfile", () => {
  const values = { username: "ada", displayName: "Ada", bio: null, avatarUrl: null };

  it("sends the CSRF token and the origin, then returns the saved user", async () => {
    const calls: Recorded[] = [];
    const client = fakeClient(
      {
        "GET /v1/auth/session": { status: 200, body: { user, csrfToken: "csrf-2" } },
        "PATCH /v1/me": { status: 200, body: { user } },
      },
      calls,
    );
    const result = await saveProfile(client, { origin: "http://127.0.0.1:3000", cookieHeader: "holoraa_session=t", values });
    expect(result.ok).toBe(true);
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.headers["X-CSRF-Token"]).toBe("csrf-2");
    expect(patch?.headers.Origin).toBe("http://127.0.0.1:3000");
    expect(patch?.body).toEqual(values);
  });

  it("reports the expired session when there is no valid session", async () => {
    const client = fakeClient({ "GET /v1/auth/session": { status: 401 } });
    expect(
      await saveProfile(client, { origin: "http://127.0.0.1:3000", cookieHeader: "holoraa_session=t", values }),
    ).toEqual({ ok: false, message: MESSAGES.profile.expired, expired: true });
  });

  it("maps 409 to the taken-username message", async () => {
    const client = fakeClient({
      "GET /v1/auth/session": { status: 200, body: { user, csrfToken: "c" } },
      "PATCH /v1/me": { status: 409, body: { title: "taken" } },
    });
    expect(
      await saveProfile(client, { origin: "http://127.0.0.1:3000", cookieHeader: "holoraa_session=t", values }),
    ).toEqual({ ok: false, message: MESSAGES.profile[409] });
  });
});

describe("searchUsers", () => {
  it("returns empty without request on blank query", async () => {
    const calls: Recorded[] = [];
    const client = fakeClient({}, calls);
    const res = await searchUsers(client, { cookieHeader: "holoraa_session=t", query: "   " });
    expect(res).toEqual({ ok: true, users: [] });
    expect(calls).toHaveLength(0);
  });

  it("returns users on 200", async () => {
    const users = [
      { id: "1", username: "bob", displayName: "Bob", bio: null, avatarUrl: null, isFollowing: false },
    ];
    const client = fakeClient({
      "GET /v1/users": { status: 200, body: { users } },
    });
    const res = await searchUsers(client, { cookieHeader: "holoraa_session=t", query: "bob" });
    expect(res).toEqual({ ok: true, users });
  });

  it("handles 429 rate limit error", async () => {
    const client = fakeClient({
      "GET /v1/users": { status: 429 },
    });
    const res = await searchUsers(client, { cookieHeader: "holoraa_session=t", query: "bob" });
    expect(res).toEqual({ ok: false, message: "Too many search requests. Wait a minute and try again." });
  });
});

describe("getPublicProfile", () => {
  it("returns profile on 200", async () => {
    const profile = { id: "1", username: "bob", displayName: "Bob", bio: null, avatarUrl: null };
    const client = fakeClient({
      "GET /v1/users/bob": { status: 200, body: profile },
    });
    const res = await getPublicProfile(client, { cookieHeader: "holoraa_session=t", username: "bob" });
    expect(res).toEqual({ ok: true, profile });
  });

  it("handles 404 not found", async () => {
    const client = fakeClient({
      "GET /v1/users/ghost": { status: 404 },
    });
    const res = await getPublicProfile(client, { cookieHeader: "holoraa_session=t", username: "ghost" });
    expect(res).toEqual({ ok: false, message: "No profile has this username." });
  });
});

describe("followUser and unfollowUser", () => {
  it("follow returns ok on 204", async () => {
    const client = fakeClient({
      "GET /v1/auth/session": { status: 200, body: { user, csrfToken: "c" } },
      "POST /v1/users/bob/follow": { status: 204 },
    });
    const res = await followUser(client, { origin: "http://127.0.0.1:3000", cookieHeader: "holoraa_session=t", username: "bob" });
    expect(res).toEqual({ ok: true });
  });

  it("follow maps 400 self-follow to friendly error", async () => {
    const client = fakeClient({
      "GET /v1/auth/session": { status: 200, body: { user, csrfToken: "c" } },
      "POST /v1/users/ada/follow": { status: 400 },
    });
    const res = await followUser(client, { origin: "http://127.0.0.1:3000", cookieHeader: "holoraa_session=t", username: "ada" });
    expect(res).toEqual({ ok: false, message: "You cannot follow yourself." });
  });

  it("unfollow returns ok on 204", async () => {
    const client = fakeClient({
      "GET /v1/auth/session": { status: 200, body: { user, csrfToken: "c" } },
      "DELETE /v1/users/bob/follow": { status: 204 },
    });
    const res = await unfollowUser(client, { origin: "http://127.0.0.1:3000", cookieHeader: "holoraa_session=t", username: "bob" });
    expect(res).toEqual({ ok: true });
  });
});
