import { describe, expect, it } from "vitest";

import {
  MAX_LUCKY_DRAW_DURATION_MS,
  MIN_LUCKY_DRAW_DURATION_MS,
  parseDuration,
} from "../src/utils/duration.js";

describe("parseDuration", () => {
  it("accepts the short and long forms of every unit", () => {
    const cases: Array<[string, number]> = [
      ["30s", 30_000],
      ["30 s", 30_000],
      ["30sec", 30_000],
      ["30 seconds", 30_000],
      ["5m", 5 * 60_000],
      ["5 m", 5 * 60_000],
      ["5min", 5 * 60_000],
      ["5 mins", 5 * 60_000],
      ["1minute", 60_000],
      ["1 minute", 60_000],
      ["2 minutes", 2 * 60_000],
      ["1h", 3_600_000],
      ["1 h", 3_600_000],
      ["1hr", 3_600_000],
      ["2 hours", 2 * 3_600_000],
      ["2HOUR", 2 * 3_600_000],
      ["1d", 86_400_000],
      ["1 day", 86_400_000],
      ["2 days", 2 * 86_400_000],
    ];
    for (const [input, expected] of cases) {
      expect(parseDuration(input)).toBe(expected);
    }
  });

  it("trims whitespace and is case-insensitive", () => {
    expect(parseDuration("  10M  ")).toBe(10 * 60_000);
  });

  it("accepts decimal values", () => {
    expect(parseDuration("1.5h")).toBe(Math.round(1.5 * 3_600_000));
  });

  it("rejects unparseable input", () => {
    for (const bad of ["", "foo", "10", "abc5m", "5 fortnights", "h", "0m", "-1m"]) {
      expect(() => parseDuration(bad)).toThrow();
    }
  });

  it("rejects unknown units", () => {
    expect(() => parseDuration("5 weeks")).toThrow(/unknown time unit/i);
  });

  it("enforces the lower bound (10 seconds)", () => {
    expect(parseDuration("10s")).toBe(MIN_LUCKY_DRAW_DURATION_MS);
    expect(() => parseDuration("9s")).toThrow(/at least 10 seconds/);
  });

  it("enforces the upper bound (7 days)", () => {
    expect(parseDuration("7 days")).toBe(MAX_LUCKY_DRAW_DURATION_MS);
    expect(() => parseDuration("8 days")).toThrow(/at most 7 days/);
  });
});
