import { describe, expect, it } from "vitest";

import { validateMessageContent, validatePaginationLimit, validateUuid } from "./validation";

describe("validateUuid", () => {
  it("accepts a standard lowercase or uppercase UUID", () => {
    expect(validateUuid("123e4567-e89b-12d3-a456-426614174000")).toBeNull();
    expect(validateUuid("123E4567-E89B-12D3-A456-426614174000")).toBeNull();
    expect(validateUuid("  123e4567-e89b-12d3-a456-426614174000  ")).toBeNull();
  });

  it.each([
    "",
    "not-a-uuid",
    "123e4567-e89b-12d3-a456-42661417400",
    "123e4567-e89b-12d3-a456-4266141740000",
    "123e4567_e89b_12d3_a456_426614174000",
  ])("refuses %j", (value) => {
    expect(validateUuid(value, "conversationId")).toContain("conversationId");
  });
});

describe("validateMessageContent", () => {
  it("accepts valid content including whitespace and newlines", () => {
    expect(validateMessageContent("Hello world")).toBeNull();
    expect(validateMessageContent("Line 1\nLine 2\tTabbed")).toBeNull();
    expect(validateMessageContent("x".repeat(4000))).toBeNull();
  });

  it("refuses empty or whitespace-only messages", () => {
    expect(validateMessageContent("")).toBe("Message cannot be empty.");
    expect(validateMessageContent("   \n\t  ")).toBe("Message cannot be empty.");
  });

  it("refuses content exceeding 4,000 characters", () => {
    expect(validateMessageContent("x".repeat(4001))).toBe("Message must be 4,000 characters or fewer.");
  });

  it("refuses content containing null bytes or prohibited control characters", () => {
    expect(validateMessageContent("Hello\u0000World")).toBe("Message contains invalid control characters.");
    expect(validateMessageContent("Bad\u0007Bell")).toBe("Message contains invalid control characters.");
  });
});

describe("validatePaginationLimit", () => {
  it("accepts undefined or integer between 1 and 100", () => {
    expect(validatePaginationLimit(undefined)).toBeNull();
    expect(validatePaginationLimit(1)).toBeNull();
    expect(validatePaginationLimit(50)).toBeNull();
    expect(validatePaginationLimit(100)).toBeNull();
  });

  it.each([0, -1, 101, 1.5, NaN])("refuses %j", (limit) => {
    expect(validatePaginationLimit(limit)).toBe("Limit must be an integer between 1 and 100.");
  });
});
