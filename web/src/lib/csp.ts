/**
 * Content Security Policy for the status page.
 *
 * The policy is nonce-based, as recommended by the Next.js guide bundled with
 * the installed version (node_modules/next/dist/docs/01-app/02-guides/
 * content-security-policy.md). A fresh nonce is generated per request, and
 * pages that use it must render dynamically (the status page does).
 *
 * Deliberate choices:
 * - No 'unsafe-inline' and no 'unsafe-eval' in production. 'unsafe-eval' is
 *   added only in development, because React uses eval to rebuild server
 *   stacks there. This is the only exception, and it is never shipped.
 * - No upgrade-insecure-requests. The development server runs plain HTTP on
 *   loopback, and that directive would make the browser request HTTPS and fail.
 *   HTTPS enforcement belongs to the TLS terminator (with HSTS).
 */

/** Generates an unpredictable nonce, base64 encoded, for one request. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

export interface PolicyOptions {
  isDev: boolean;
}

/** Builds the policy header value for one request. */
export function buildContentSecurityPolicy(nonce: string, { isDev }: PolicyOptions): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (isDev) {
    scriptSrc.push("'unsafe-eval'");
  }

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", `'nonce-${nonce}'`]],
    ["img-src", ["'self'", "data:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}
