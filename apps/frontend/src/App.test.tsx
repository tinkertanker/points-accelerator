import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App", () => {
  it("shows the admin sign in prompt before bootstrap data loads", () => {
    render(<App />);

    expect(screen.getByText(/configure your class economy/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });
});

