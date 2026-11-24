import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { DashboardShell } from "./dashboard-shell";

function setup() {
  const user = userEvent.setup();
  render(<DashboardShell />);

  return {
    user,
    search: screen.getByRole("searchbox", { name: "Search for a topic" }),
    graph: within(screen.getByRole("region", { name: "Knowledge graph" })),
    details: within(screen.getByRole("region", { name: "Concept details" })),
  };
}

test("renders the workspace, graph preview, and empty details", () => {
  const { graph, details } = setup();

  expect(
    screen.getByRole("heading", { name: "Knowledge Explorer" }),
  ).toBeVisible();
  expect(graph.getAllByRole("button")).toHaveLength(7);
  expect(
    graph.getByText("Deep Learning builds on Neural Networks"),
  ).toBeInTheDocument();
  expect(details.getByText("Select a concept")).toBeVisible();
});

test("validates a whitespace-only search and clears the error when typing", async () => {
  const { user, search } = setup();

  await user.type(search, "   {Enter}");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter a topic or question",
  );
  expect(search).toHaveAttribute("aria-invalid", "true");
  expect(search).toHaveFocus();

  await user.type(search, "Learning");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(search).not.toHaveAttribute("aria-invalid");
});

test("loads a sample answer and updates details from graph and related concept buttons", async () => {
  const { user, search, graph, details } = setup();
  const query = "How does machine learning work?";

  await user.type(search, ` ${query} {Enter}`);
  expect(search).toHaveValue(query);
  expect(screen.getByRole("button", { name: "Searching…" })).toBeDisabled();
  expect(
    await screen.findByRole("heading", { name: "How machine learning works" }),
  ).toBeVisible();
  expect(
    screen.getByText("References below are placeholders for this example."),
  ).toBeVisible();
  expect(
    details.getByRole("heading", { name: "Machine Learning" }),
  ).toBeVisible();

  await user.click(graph.getByRole("button", { name: "Neural Networks" }));
  expect(
    graph.getByRole("button", { name: "Neural Networks", pressed: true }),
  ).toBeVisible();
  expect(
    details.getByRole("heading", { name: "Neural Networks" }),
  ).toBeVisible();

  await user.click(details.getByRole("button", { name: "Deep Learning" }));
  expect(details.getByRole("heading", { name: "Deep Learning" })).toBeVisible();

  await user.click(details.getByRole("button", { name: "Explore topic" }));
  expect(search).toHaveValue("Deep Learning");
});

test("reopens a mock recent entry and resets the exploration", async () => {
  const { user, search, graph, details } = setup();
  const navigation = within(
    screen.getByRole("navigation", { name: "Workspace navigation" }),
  );

  await user.click(navigation.getByRole("button", { name: "Deep Learning" }));
  expect(
    navigation.getByRole("button", { name: "Deep Learning", current: true }),
  ).toBeVisible();
  expect(details.getByRole("heading", { name: "Deep Learning" })).toBeVisible();

  await user.click(navigation.getByRole("button", { name: "New exploration" }));
  expect(search).toHaveValue("");
  expect(search).toHaveFocus();
  expect(details.getByText("Select a concept")).toBeVisible();
  expect(
    graph.queryByRole("button", { pressed: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "How machine learning works" }),
  ).not.toBeInTheDocument();
});
