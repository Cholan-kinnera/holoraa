import { describe, expect, it } from "vitest";

import { validateAvatarUrl, validateBio, validateCode, validateDisplayName, validateEmail, validateUsername } from "./validation";

describe("validateEmail", () => {
  it("accepts a plain address with surrounding spaces", () => {
    expect(validateEmail("  name@example.com ")).toBeNull();
  });

  it.each(["", "no-at-sign", "a@b", "two@@example.com", "spa ce@example.com"])("refuses %j", (value) => {
    expect(validateEmail(value)).not.toBeNull();
  });
});

describe("validateCode", () => {
  it("accepts exactly six digits", () => {
    expect(validateCode("012345")).toBeNull();
  });

  it.each(["12345", "1234567", "12a456", ""])("refuses %j", (value) => {
    expect(validateCode(value)).not.toBeNull();
  });
});

describe("validateUsername", () => {
  it("accepts the documented shape", () => {
    expect(validateUsername("ada_lovelace1")).toBeNull();
  });

  it.each(["ab", "1starts_with_digit", "has-dash", "x".repeat(33)])("refuses %j", (value) => {
    expect(validateUsername(value)).not.toBeNull();
  });
});

describe("validateDisplayName", () => {
  it("refuses empty names, long names, and control characters", () => {
    expect(validateDisplayName("   ")).not.toBeNull();
    expect(validateDisplayName("x".repeat(51))).not.toBeNull();
    expect(validateDisplayName("x".repeat(50))).toBeNull();
    expect(validateDisplayName("bad\u0007name")).not.toBeNull();
    expect(validateDisplayName("Ada")).toBeNull();
  });
});

describe("validateBio", () => {
  it("accepts an empty bio and refuses one over 160 characters", () => {
    expect(validateBio("")).toBeNull();
    expect(validateBio("x".repeat(160))).toBeNull();
    expect(validateBio("x".repeat(161))).not.toBeNull();
  });
});

describe("validateAvatarUrl", () => {
  it("allows empty and https links", () => {
    expect(validateAvatarUrl("")).toBeNull();
    expect(validateAvatarUrl("https://example.com/a.png")).toBeNull();
  });

  it.each(["http://example.com/a.png", "https://user:pw@example.com/", "javascript:alert(1)", "not a url"])(
    "refuses %j",
    (value) => {
      expect(validateAvatarUrl(value)).not.toBeNull();
    },
  );
});
