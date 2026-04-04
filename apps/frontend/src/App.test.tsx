import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const fetchMock = vi.fn<typeof fetch>();

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("shows the Discord sign-in prompt when there is no active session", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText(/group rewards, transfers, shop pricing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with discord/i })).toBeInTheDocument();
  });
});
