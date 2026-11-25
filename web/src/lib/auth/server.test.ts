import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable headers for next/headers mock
let mockHeadersStore = new Headers();

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mockHeadersStore),
  cookies: vi.fn(async () => ({
    getAll: vi.fn(() => []),
  })),
}));

import { isValidOrigin, readOnlyContext, requestContext } from "./server";

describe("auth/server request contexts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeadersStore = new Headers();
    vi.stubEnv("HOLORAA_API_URL", "http://127.0.0.1:8080");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("isValidOrigin", () => {
    it("accepts valid http and https origins without paths or credentials", () => {
      expect(isValidOrigin("http://localhost:3000")).toBe(true);
      expect(isValidOrigin("http://127.0.0.1:8080")).toBe(true);
      expect(isValidOrigin("https://app.holoraa.com")).toBe(true);
      expect(isValidOrigin("https://sub.domain.example.org:8443")).toBe(true);
    });

    it("rejects non-http(s) protocols", () => {
      expect(isValidOrigin("javascript:alert(1)")).toBe(false);
      expect(isValidOrigin("data:text/html,<script>alert(1)</script>")).toBe(false);
      expect(isValidOrigin("ws://localhost:3000")).toBe(false);
      expect(isValidOrigin("wss://localhost:3000")).toBe(false);
      expect(isValidOrigin("file:///etc/passwd")).toBe(false);
      expect(isValidOrigin("ftp://example.com")).toBe(false);
    });

    it("rejects origins with paths, queries, hashes, or credentials", () => {
      expect(isValidOrigin("http://localhost:3000/app")).toBe(false);
      expect(isValidOrigin("https://app.holoraa.com/")).toBe(false);
      expect(isValidOrigin("https://app.holoraa.com?query=1")).toBe(false);
      expect(isValidOrigin("https://app.holoraa.com#section")).toBe(false);
      expect(isValidOrigin("http://user:pass@localhost:3000")).toBe(false);
    });

    it("rejects empty or malformed strings", () => {
      expect(isValidOrigin("")).toBe(false);
      expect(isValidOrigin("null")).toBe(false);
      expect(isValidOrigin("not-a-valid-url")).toBe(false);
      expect(isValidOrigin("://missing-scheme")).toBe(false);
    });
  });

  describe("readOnlyContext", () => {
    it("succeeds without any Origin header", async () => {
      const res = await readOnlyContext();
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.client).toBeDefined();
        // Read-only context must never expose an origin property
        expect(res).not.toHaveProperty("origin");
      }
    });

    it("fails closed when API configuration is unavailable", async () => {
      vi.stubEnv("HOLORAA_API_URL", "");
      delete process.env.HOLORAA_API_URL;
      const res = await readOnlyContext();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toBe("Sign-in is not configured on this server.");
      }
    });
  });

  describe("requestContext for mutations", () => {
    it("forwards a validated browser-supplied Origin", async () => {
      mockHeadersStore = new Headers({
        origin: "http://localhost:3000",
      });

      const res = await requestContext();
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.origin).toBe("http://localhost:3000");
        expect(res.client).toBeDefined();
      }
    });

    it("rejects when Origin header is completely missing", async () => {
      mockHeadersStore = new Headers({});

      const res = await requestContext();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toBe("Something went wrong. Try again.");
      }
    });

    it("rejects when Origin header is empty string", async () => {
      mockHeadersStore = new Headers({ origin: "" });

      const res = await requestContext();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toBe("Something went wrong. Try again.");
      }
    });

    it("rejects when Origin header is malformed", async () => {
      mockHeadersStore = new Headers({ origin: "javascript:alert(1)" });

      const res = await requestContext();
      expect(res.ok).toBe(false);
    });

    it("refuses to synthesize Origin from Host or X-Forwarded-Host when Origin is missing", async () => {
      mockHeadersStore = new Headers({
        host: "localhost:3000",
        "x-forwarded-host": "trusted.holoraa.com",
        "x-forwarded-proto": "https",
      });

      const res = await requestContext();
      // Must fail closed because Origin is absent; attacker cannot manufacture Origin via forwarded headers
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toBe("Something went wrong. Try again.");
      }
    });

    it("fails closed when API configuration is unavailable", async () => {
      vi.stubEnv("HOLORAA_API_URL", "");
      delete process.env.HOLORAA_API_URL;
      const res = await requestContext();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.message).toBe("Sign-in is not configured on this server.");
      }
    });
  });
});
