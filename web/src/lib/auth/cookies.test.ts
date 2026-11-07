import { describe, expect, it } from "vitest";

import { parseSetCookie, sessionCookieHeader } from "./cookies";

describe("parseSetCookie", () => {
  it("keeps the API's attributes for the development cookie", () => {
    const cookie = parseSetCookie(
      "holoraa_session=abc_DEF-123; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600",
    );
    expect(cookie).toEqual({
      name: "holoraa_session",
      value: "abc_DEF-123",
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 1209600,
    });
  });

  it("keeps Secure and the __Host- name for production", () => {
    const cookie = parseSetCookie("__Host-holoraa_session=tok; Path=/; HttpOnly; Secure; SameSite=Lax");
    expect(cookie?.name).toBe("__Host-holoraa_session");
    expect(cookie?.secure).toBe(true);
  });

  it("returns a zero Max-Age for a cleared cookie", () => {
    expect(parseSetCookie("holoraa_session=; Path=/; Max-Age=0")?.maxAge).toBe(0);
  });

  it("ignores a Domain attribute, so the cookie stays host-only", () => {
    const cookie = parseSetCookie("holoraa_session=tok; Domain=example.com; Path=/");
    expect(cookie).not.toHaveProperty("domain");
  });

  it("refuses any cookie that is not a session cookie", () => {
    expect(parseSetCookie("tracking=1; Path=/")).toBeNull();
    expect(parseSetCookie("holoraa_session_extra=1")).toBeNull();
  });

  it("refuses a malformed pair", () => {
    expect(parseSetCookie("holoraa_session")).toBeNull();
    expect(parseSetCookie("=value")).toBeNull();
  });

  it("falls back to safe defaults for unknown SameSite and Max-Age values", () => {
    const cookie = parseSetCookie("holoraa_session=tok; SameSite=Sideways; Max-Age=soon");
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie).not.toHaveProperty("maxAge");
  });
});

describe("sessionCookieHeader", () => {
  it("sends only session cookies", () => {
    expect(
      sessionCookieHeader([
        { name: "theme", value: "dark" },
        { name: "holoraa_session", value: "tok" },
      ]),
    ).toBe("holoraa_session=tok");
  });

  it("returns null when there is no session cookie", () => {
    expect(sessionCookieHeader([{ name: "theme", value: "dark" }])).toBeNull();
    expect(sessionCookieHeader([])).toBeNull();
  });
});
