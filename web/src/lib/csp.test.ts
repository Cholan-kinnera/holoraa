import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, generateNonce } from "./csp";

function directive(policy: string, name: string): string[] {
  const found = policy.split("; ").find((d) => d.startsWith(`${name} `));
  if (found === undefined) {
    throw new Error(`policy has no ${name} directive`);
  }
  return found.split(" ").slice(1);
}

describe("generateNonce", () => {
  it("returns a base64 string of 16 random bytes", () => {
    const nonce = generateNonce();
    expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });

  it("returns a different value on each call", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(seen.size).toBe(50);
  });
});

describe("buildContentSecurityPolicy", () => {
  const nonce = "abc123==";

  it("allows scripts and styles only with the request nonce", () => {
    const policy = buildContentSecurityPolicy(nonce, { isDev: false });

    expect(directive(policy, "script-src")).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
    expect(directive(policy, "style-src")).toEqual(["'self'", `'nonce-${nonce}'`]);
  });

  it("never allows unsafe-inline, and allows unsafe-eval only in development", () => {
    const prod = buildContentSecurityPolicy(nonce, { isDev: false });
    const dev = buildContentSecurityPolicy(nonce, { isDev: true });

    expect(prod).not.toContain("unsafe-inline");
    expect(dev).not.toContain("unsafe-inline");
    expect(prod).not.toContain("unsafe-eval");
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });

  it("denies objects, framing and foreign base URIs and form targets", () => {
    const policy = buildContentSecurityPolicy(nonce, { isDev: false });

    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'self'"]);
    expect(directive(policy, "form-action")).toEqual(["'self'"]);
  });

  it("sets default-src to self, so anything unlisted is blocked", () => {
    const policy = buildContentSecurityPolicy(nonce, { isDev: false });
    expect(directive(policy, "default-src")).toEqual(["'self'"]);
  });

  it("does not include upgrade-insecure-requests, which breaks plain-HTTP loopback", () => {
    const policy = buildContentSecurityPolicy(nonce, { isDev: false });
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("uses the nonce it is given, not a fixed value", () => {
    const a = buildContentSecurityPolicy("first", { isDev: false });
    const b = buildContentSecurityPolicy("second", { isDev: false });
    expect(a).toContain("'nonce-first'");
    expect(b).not.toContain("'nonce-first'");
  });
});
