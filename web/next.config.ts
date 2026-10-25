import type { NextConfig } from "next";

/**
 * Defensive headers for every page. A Content-Security-Policy is not set yet:
 * Next.js needs inline scripts, so a strict policy needs a nonce setup first
 * (see docs/security/THREAT_MODEL.md, M5 item). Setting a loose policy would
 * give false assurance.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
