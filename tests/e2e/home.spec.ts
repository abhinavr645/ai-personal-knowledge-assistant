import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("searches the dashboard and explores concepts", async ({ page }) => {
  const response = await page.goto("/");
  const graph = page.getByRole("region", { name: "Knowledge graph" });
  const details = page.getByRole("region", { name: "Concept details" });
  const search = page.getByRole("searchbox", { name: "Search for a topic" });

  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Knowledge Explorer" }),
  ).toBeVisible();
  await expect(graph.getByText("Example", { exact: true })).toBeVisible();

  await search.press("Enter");
  await expect(page.getByRole("search").getByRole("alert")).toContainText(
    "Enter a topic or question",
  );
  await search.fill("How does machine learning work?");
  const graphTop = (await graph.boundingBox())?.y;
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("button", { name: "Searching…" })).toBeDisabled();
  expect((await graph.boundingBox())?.y).toBe(graphTop);
  await expect(
    page.getByRole("heading", { name: "How machine learning works" }),
  ).toBeVisible();

  const neuralNetworks = graph.getByRole("button", { name: "Neural Networks" });
  await neuralNetworks.focus();
  await neuralNetworks.press("Enter");
  await expect(neuralNetworks).toHaveAttribute("aria-pressed", "true");
  await expect(
    details.getByRole("heading", { name: "Neural Networks" }),
  ).toBeVisible();
  await details.getByRole("button", { name: "Deep Learning" }).click();
  await expect(
    details.getByRole("heading", { name: "Deep Learning" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("supports mobile navigation, settings, and reset without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const menu = page.getByRole("dialog", { name: "Workspace menu" });
  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  const details = page.getByRole("region", { name: "Concept details" });

  await openNavigation.click();
  await menu.getByRole("button", { name: "Deep Learning" }).click();
  await expect(menu).toBeHidden();
  await expect(
    details.getByRole("heading", { name: "Deep Learning" }),
  ).toBeVisible();

  await openNavigation.click();
  await menu.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await expect(settings).toBeVisible();
  const labels = settings.getByRole("checkbox", {
    name: "Show relationship labels",
  });
  await labels.uncheck();
  await settings.getByRole("button", { name: "Close settings" }).click();

  await openNavigation.click();
  await menu.getByRole("button", { name: "New exploration" }).click();
  await expect(menu).toBeHidden();
  await expect(details.getByText("Select a concept")).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(page.getByRole("searchbox")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );

  await page.setViewportSize({ width: 320, height: 720 });
  const graphNodes = page
    .getByRole("region", { name: "Knowledge graph" })
    .getByRole("button");
  expect(
    await graphNodes.evaluateAll((nodes) =>
      nodes.every((node) => node.scrollWidth <= node.clientWidth),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
});
