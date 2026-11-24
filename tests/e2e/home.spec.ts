import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { javascript, reactExpansion, success } from "../fixtures/exploration";

test("handles search and expansion failures, then recovers on retry", async ({
  page,
}) => {
  const issues: string[] = [];
  page.on("pageerror", (error) => issues.push(error.message));
  page.on("console", (message) => {
    // Chromium reports HTTP error responses as console errors.
    if (
      message.type() === "error" &&
      !/^Failed to load resource:/.test(message.text())
    )
      issues.push(message.text());
  });
  const failure = {
    status: 502,
    json: {
      error: { code: "retrieval_failed", message: "Evidence was unavailable." },
    },
  };
  let searches = 0;
  let expansions = 0;
  await page.route("**/api/search", (route) =>
    route.fulfill(++searches === 1 ? failure : { json: javascript }),
  );
  await page.route("**/api/related", (route) =>
    route.fulfill(++expansions === 1 ? failure : { json: reactExpansion }),
  );
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const graph = page.getByRole("region", { name: "Knowledge graph" });
  const answer = page.getByRole("region", { name: "Topic explanation" });
  const details = page.getByRole("region", { name: "Concept details" });
  const search = page.getByRole("searchbox");

  await search.press("Enter");
  await expect(page.getByRole("search").getByRole("alert")).toContainText(
    "Enter a topic or question",
  );
  await search.fill("JavaScript");
  await search.press("Enter");
  await expect(answer.getByRole("alert")).toContainText(
    "Could not retrieve evidence",
  );
  await search.press("Enter");
  await expect(
    answer.getByRole("heading", { name: "JavaScript overview" }),
  ).toBeVisible();

  await graph.getByText("Browse concepts").click();
  await graph.getByRole("button", { name: "React", exact: true }).click();
  await details.getByRole("button", { name: "Expand concept" }).click();
  await expect(details.getByRole("alert")).toContainText(
    "Could not retrieve evidence",
  );
  await expect(graph.getByText("2 concepts")).toBeVisible();
  await details.getByRole("button", { name: "Retry expansion" }).click();
  await expect(graph.getByRole("button", { name: "Hooks" })).toBeVisible();
  await expect(details.getByText("Concept expanded.")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(issues).toEqual([]);
});

test("supports mobile search, expansion, navigation, and reset without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/search", async (route) => {
    const { query } = route.request().postDataJSON() as { query: string };
    await route.fulfill({
      json: success(query, "Deep Learning", ["Deep Learning"], []),
    });
  });
  await page.route("**/api/related", (route) => {
    const { concept, topic } = route.request().postDataJSON();
    const longName = "A".repeat(120);
    return route.fulfill({
      json: {
        ...success(
          topic,
          "Deep Learning concepts",
          [longName],
          [["Deep Learning", longName]],
        ),
        conceptId: concept.id,
      },
    });
  });
  await page.goto("/");
  const menu = page.getByRole("dialog", { name: "Workspace menu" });
  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  const details = page.getByRole("region", { name: "Concept details" });
  const graph = page.getByRole("region", { name: "Knowledge graph" });

  await openNavigation.click();
  await menu.getByRole("button", { name: "Deep Learning" }).click();
  await expect(menu).toBeHidden();
  await expect(
    details.getByRole("heading", { name: "Deep Learning" }),
  ).toBeVisible();
  await details.getByRole("button", { name: "Expand concept" }).click();
  await expect(graph.getByText("2 concepts")).toBeVisible();
  await graph.getByText("Browse concepts").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.getByRole("button", { name: "Fit graph" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );

  await openNavigation.click();
  await menu.getByRole("button", { name: "Settings" }).press("Enter");
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await expect(settings).toBeVisible();
  await settings
    .getByRole("checkbox", { name: "Show relationship labels" })
    .uncheck();
  await settings.getByRole("button", { name: "Close settings" }).click();

  await openNavigation.click();
  await menu.getByRole("button", { name: "New exploration" }).click();
  await expect(menu).toBeHidden();
  await expect(details.getByText("Select a concept")).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(page.getByRole("searchbox")).toBeFocused();
});
