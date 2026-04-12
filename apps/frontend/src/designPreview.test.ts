import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getDesignPreviewAccessLevel,
  getDesignPreviewSession,
  setDesignPreviewAccessLevel,
} from "./designPreview";

describe("design preview access", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, document.title, "/");
    vi.restoreAllMocks();
  });

  it("defaults to admin preview access", () => {
    expect(getDesignPreviewAccessLevel()).toBe("admin");
    expect(getDesignPreviewSession().user?.dashboardAccessLevel).toBe("admin");
  });

  it("persists the chosen preview access level", () => {
    setDesignPreviewAccessLevel("mentor");

    expect(window.localStorage.getItem("points-accelerator:design-preview-access")).toBe("mentor");
    expect(getDesignPreviewAccessLevel()).toBe("mentor");
    expect(getDesignPreviewSession().user?.canManageSettings).toBe(false);
    expect(getDesignPreviewSession().user?.canManageShop).toBe(true);
  });

  it("lets the query string override the stored preview access", () => {
    window.localStorage.setItem("points-accelerator:design-preview-access", "admin");
    window.history.replaceState({}, document.title, "/?previewAs=viewer");

    expect(getDesignPreviewAccessLevel()).toBe("viewer");
    expect(getDesignPreviewSession().user?.dashboardAccessLevel).toBe("viewer");
    expect(getDesignPreviewSession().user?.canManageAssignments).toBe(false);
  });
});
