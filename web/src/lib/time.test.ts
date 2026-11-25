import { describe, expect, it } from "vitest";

import {
  formatClockTime,
  formatDayLabel,
  formatFullTimestamp,
  formatRelativeTime,
  isSameLocalDay,
} from "./time";

// Wed 25 Nov 2026, 15:00 local time. Local constructors keep day boundaries
// independent of the machine's time zone.
const now = new Date(2026, 10, 25, 15, 0, 0);
const at = (...args: [number, number, number, number?, number?, number?]) =>
  new Date(args[0], args[1], args[2], args[3] ?? 0, args[4] ?? 0, args[5] ?? 0).toISOString();
const rel = (iso: string | null | undefined, ref = now) => formatRelativeTime(iso, ref, "en-GB");

describe("formatRelativeTime", () => {
  it("shows 'now' under a minute and for future timestamps (clock skew)", () => {
    expect(rel(at(2026, 10, 25, 14, 59, 30))).toBe("now");
    expect(rel(at(2026, 10, 25, 15, 5))).toBe("now");
  });

  it("shows minutes within the last hour", () => {
    expect(rel(at(2026, 10, 25, 14, 55))).toBe("5m");
    expect(rel(at(2026, 10, 25, 14, 1))).toBe("59m");
  });

  it("shows the clock time earlier today", () => {
    expect(rel(at(2026, 10, 25, 9, 5))).toBe("09:05");
  });

  it("shows 'Yesterday' across midnight even when under an hour ago", () => {
    const justAfterMidnight = new Date(2026, 10, 25, 0, 30);
    expect(rel(at(2026, 10, 24, 23, 50), justAfterMidnight)).toBe("Yesterday");
    expect(rel(at(2026, 10, 24, 8, 0))).toBe("Yesterday");
  });

  it("shows the weekday within the last week", () => {
    expect(rel(at(2026, 10, 23, 12, 0))).toBe("Mon");
  });

  it("shows day and month for older dates this year", () => {
    expect(rel(at(2026, 10, 18, 12, 0))).toBe("18 Nov");
  });

  it("shows the full date for earlier years", () => {
    expect(rel(at(2025, 2, 12, 12, 0))).toBe("12/03/2025");
  });

  it("returns an empty string for missing or invalid input", () => {
    expect(rel(null)).toBe("");
    expect(rel(undefined)).toBe("");
    expect(rel("not-a-date")).toBe("");
  });
});

describe("formatFullTimestamp", () => {
  it("formats a full date and time, and is empty for invalid input", () => {
    expect(formatFullTimestamp(at(2026, 10, 25, 9, 5), "en-GB")).toMatch(/25 Nov 2026.*09:05/);
    expect(formatFullTimestamp("nope")).toBe("");
  });
});

describe("formatDayLabel", () => {
  const day = (iso: string | null | undefined) => formatDayLabel(iso, now, "en-GB");

  it("names today, yesterday and the last week", () => {
    expect(day(at(2026, 10, 25, 0, 1))).toBe("Today");
    expect(day(at(2026, 10, 26, 9))).toBe("Today"); // clock skew
    expect(day(at(2026, 10, 24, 23, 59))).toBe("Yesterday");
    expect(day(at(2026, 10, 20, 12))).toBe("Friday");
  });

  it("uses the date for older days, with the year only when it differs", () => {
    expect(day(at(2026, 10, 18, 12))).toBe("18 November");
    expect(day(at(2025, 2, 12, 12))).toBe("12 March 2025");
  });

  it("returns an empty string for missing or invalid input", () => {
    expect(day(undefined)).toBe("");
    expect(day("not a date")).toBe("");
  });
});

describe("formatClockTime and isSameLocalDay", () => {
  it("formats the local clock time", () => {
    expect(formatClockTime(at(2026, 10, 25, 9, 5), "en-GB")).toBe("09:05");
    expect(formatClockTime("bad", "en-GB")).toBe("");
  });

  it("compares local calendar days", () => {
    expect(isSameLocalDay(at(2026, 10, 25, 0, 1), at(2026, 10, 25, 23, 59))).toBe(true);
    expect(isSameLocalDay(at(2026, 10, 24, 23, 59), at(2026, 10, 25, 0, 1))).toBe(false);
    expect(isSameLocalDay("bad", at(2026, 10, 25))).toBe(false);
  });
});
