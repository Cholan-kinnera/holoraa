import { describe, expect, it } from "vitest";

import { readApiBaseUrl } from "./client";

describe("readApiBaseUrl", () => {
  it("returns null when HOLORAA_API_URL is missing or blank", () => {
    expect(readApiBaseUrl({})).toBeNull();
    expect(readApiBaseUrl({ HOLORAA_API_URL: "" })).toBeNull();
    expect(readApiBaseUrl({ HOLORAA_API_URL: "   " })).toBeNull();
  });

  it("returns null for a value that is not a URL", () => {
    expect(readApiBaseUrl({ HOLORAA_API_URL: "not a url" })).toBeNull();
  });

  it("returns null for a URL scheme other than http or https", () => {
    expect(readApiBaseUrl({ HOLORAA_API_URL: "ftp://127.0.0.1:8080" })).toBeNull();
    expect(readApiBaseUrl({ HOLORAA_API_URL: "javascript:alert(1)" })).toBeNull();
  });

  it("keeps only the origin, so a path or query cannot change the request base", () => {
    expect(readApiBaseUrl({ HOLORAA_API_URL: "http://127.0.0.1:8080/some/path?x=1" })).toBe("http://127.0.0.1:8080");
  });

  it("trims whitespace and accepts https", () => {
    expect(readApiBaseUrl({ HOLORAA_API_URL: "  https://api.example.test  " })).toBe("https://api.example.test");
  });
});
