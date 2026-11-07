/**
 * Session cookie handling. The API sets the session cookie; the web app only
 * copies it to the browser. Only the session cookie names are accepted, and the
 * attributes come from the API's Set-Cookie header.
 *
 * The API's cookie name is "__Host-holoraa_session" in production and
 * "holoraa_session" in local development (HOLORAA_COOKIE_SECURE=false).
 */

export const SESSION_COOKIE_NAMES = ["__Host-holoraa_session", "holoraa_session"] as const;

export interface AppliedCookie {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  maxAge?: number;
  expires?: Date;
}

export function isSessionCookieName(name: string): boolean {
  return (SESSION_COOKIE_NAMES as readonly string[]).includes(name);
}

/**
 * Parses one Set-Cookie header. Returns null for anything that is not a session
 * cookie. The Domain attribute is ignored on purpose, so the cookie stays
 * host-only.
 */
export function parseSetCookie(header: string): AppliedCookie | null {
  const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
  const eq = pair.indexOf("=");
  if (eq < 1) {
    return null;
  }
  const name = pair.slice(0, eq);
  if (!isSessionCookieName(name)) {
    return null;
  }

  const cookie: AppliedCookie = {
    name,
    value: pair.slice(eq + 1),
    httpOnly: false,
    secure: false,
    sameSite: "lax",
    path: "/",
  };

  for (const attribute of attributes) {
    const separator = attribute.indexOf("=");
    const key = (separator < 0 ? attribute : attribute.slice(0, separator)).toLowerCase();
    const value = separator < 0 ? "" : attribute.slice(separator + 1);
    switch (key) {
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "secure":
        cookie.secure = true;
        break;
      case "path":
        cookie.path = value || "/";
        break;
      case "samesite": {
        const sameSite = value.toLowerCase();
        if (sameSite === "lax" || sameSite === "strict" || sameSite === "none") {
          cookie.sameSite = sameSite;
        }
        break;
      }
      case "max-age": {
        const seconds = Number(value);
        if (Number.isInteger(seconds)) {
          cookie.maxAge = seconds;
        }
        break;
      }
      case "expires": {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
          cookie.expires = date;
        }
        break;
      }
      default:
        break;
    }
  }

  return cookie;
}

/** Builds the Cookie request header from the browser's session cookies, or null if there are none. */
export function sessionCookieHeader(cookies: ReadonlyArray<{ name: string; value: string }>): string | null {
  const pairs = cookies.filter((cookie) => isSessionCookieName(cookie.name)).map((cookie) => `${cookie.name}=${cookie.value}`);
  return pairs.length > 0 ? pairs.join("; ") : null;
}
