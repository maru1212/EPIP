import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "@/app/page";

describe("HomePage (smoke test)", () => {
  it("renders the platform heading", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: /ethiopian property intelligence platform/i,
      })
    ).toBeInTheDocument();
  });
});
