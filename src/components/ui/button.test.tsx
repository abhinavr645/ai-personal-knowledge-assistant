import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Button } from "@/components/ui/button";

test("renders a disabled button with an accessible name", () => {
  render(<Button disabled>Continue</Button>);

  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
});
