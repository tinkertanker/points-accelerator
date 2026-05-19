import { describe, expect, it } from "vitest";

import { fromDateTimeLocalInputValue, toDateTimeLocalInputValue } from "./datetime-local";

describe("datetime-local helpers", () => {
  it("formats stored UTC timestamps for local datetime-local inputs", () => {
    expect(toDateTimeLocalInputValue("2026-04-11T12:34:00.000Z", -480)).toBe("2026-04-11T20:34");
  });

  it("converts local datetime-local input values back to UTC ISO strings", () => {
    expect(fromDateTimeLocalInputValue("2026-04-11T20:34", -480)).toBe("2026-04-11T12:34:00.000Z");
  });

  it("rejects invalid calendar and time fields", () => {
    expect(fromDateTimeLocalInputValue("2026-02-31T10:00", 0)).toBeNull();
    expect(fromDateTimeLocalInputValue("2026-13-01T00:00", 0)).toBeNull();
    expect(fromDateTimeLocalInputValue("2026-01-01T24:00", 0)).toBeNull();
    expect(fromDateTimeLocalInputValue("2026-01-01T23:60", 0)).toBeNull();
  });
});
