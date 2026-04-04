import { describe, expect, it } from "vitest";

import { resolveApiUrl } from "./api";

describe("resolveApiUrl", () => {
  it("keeps a relative /api base from being prefixed twice", () => {
    expect(resolveApiUrl("/api", "/api/auth/login")).toBe("/api/auth/login");
  });

  it("joins a host base with api routes", () => {
    expect(resolveApiUrl("http://localhost:3001", "/api/auth/login")).toBe("http://localhost:3001/api/auth/login");
  });

  it("handles an absolute base that already ends in /api", () => {
    expect(resolveApiUrl("https://economyrice.tk.sg/api/", "/api/bootstrap")).toBe(
      "https://economyrice.tk.sg/api/bootstrap",
    );
  });
});
