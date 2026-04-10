import { describe, expect, it } from "vitest";

import { fromDateTimeLocalInputValue, toDateTimeLocalInputValue } from "./datetime-local";

describe("datetime-local helpers", () => {
  it("formats stored UTC timestamps for local datetime-local inputs", () => {
    expect(toDateTimeLocalInputValue("2026-04-11T12:34:00.000Z", -480)).toBe("2026-04-11T20:34");
  });

  it("converts local datetime-local input values back to UTC ISO strings", () => {
    expect(fromDateTimeLocalInputValue("2026-04-11T20:34", -480)).toBe("2026-04-11T12:34:00.000Z");
  });
});
