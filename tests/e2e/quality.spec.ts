import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { javascript, reactExpansion, success } from "../fixtures/exploration";

const details = (page: Page) =>
  page.getByRole("region", { name: "Concept details" });
const graph = (page: Page) =>
  page.getByRole("region", { name: "Knowledge graph" });
const history = (page: Page) =>
  page.getByRole("list", { name: "Saved explorations" });
const saved = (page: Page) =>
  history(page).getByRole("button", { name: "JavaScript", exact: true });

async function searchJavaScript(page: Page) {
  const input = page.getByRole("searchbox");
  await input.fill("JavaScript");
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: "JavaScript overview" }),
  ).toBeVisible();
}

async function selectReact(page: Page) {
  await graph(page).getByText("Browse concepts").click();
  const react = graph(page).getByRole("button", { name: "React", exact: true });
  await react.press("Enter");
  await expect(
    details(page).getByRole("heading", { name: "React" }),
  ).toBeVisible();
}

test("validates security headers, keyboard navigation, axe, and layout at all supported widths", async ({
  page,
}) => {
  const origin = "http://localhost:3000";
  const outbound: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) outbound.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const longLabel = "A".repeat(120);
  await page.route("**/api/search", (route) =>
    route.fulfill({
      json: success(
        "JavaScript",
        "JavaScript overview",
        ["JavaScript", "React", longLabel],
        [["React", longLabel]],
      ),
    }),
  );
  const response = await page.goto("/");
  expect(response?.headers()).toMatchObject({
    "content-security-policy": expect.stringContaining(
      "frame-ancestors 'none'",
    ),
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  expect(response?.headers()["x-powered-by"]).toBeUndefined();
  await searchJavaScript(page);
  await selectReact(page);
  await expect(
    graph(page).getByRole("button", { name: "React" }),
  ).toBeFocused();
  const controls = graph(page).getByRole("group", {
    name: "Graph view controls",
  });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        controls.getByRole("button", { name: "Fit graph" }),
      ).toBeEnabled();
      const box = await controls.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  }
  await page.setViewportSize({ width: 320, height: 800 });
  const open = page.getByRole("button", { name: "Open navigation" });
  await open.press("Enter");
  const menu = page.getByRole("dialog", { name: "Workspace menu" });
  await expect(
    menu.getByRole("list", { name: "Saved explorations" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  expect(errors).toEqual([]);
  expect(outbound).toEqual([]);
});

test("refreshing and deleting during expansion preserve the last completed state without resurrecting deleted history", async ({
  page,
}) => {
  await page.route("**/api/search", (route) =>
    route.fulfill({ json: javascript }),
  );
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  let requests = 0;
  await page.route("**/api/related", async (route) => {
    await (++requests === 1 ? first.promise : second.promise);
    await route.fulfill({ json: reactExpansion }).catch(() => undefined);
  });
  try {
    await page.goto("/");
    await searchJavaScript(page);
    await selectReact(page);
    await details(page)
      .getByRole("button", { name: "Expand concept" })
      .press("Enter");
    await expect(
      details(page).getByRole("button", { name: "Expanding…" }),
    ).toBeFocused();
    await expect.poll(() => requests).toBe(1);
    await page.reload();
    first.resolve();
    await saved(page).click();
    await expect(
      details(page).getByRole("heading", { name: "React" }),
    ).toBeVisible();
    await expect(
      details(page).getByRole("button", { name: "Expand concept" }),
    ).toBeEnabled();
    await expect(graph(page).getByText("2 concepts")).toBeVisible();

    await details(page)
      .getByRole("button", { name: "Expand concept" })
      .press("Enter");
    await expect.poll(() => requests).toBe(2);
    await history(page)
      .getByRole("button", { name: "Actions for JavaScript" })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page
      .getByRole("dialog", { name: "Delete exploration?" })
      .getByRole("button", { name: "Delete exploration" })
      .click();
    second.resolve();
    await expect(page.getByText("No saved explorations yet.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("No saved explorations yet.")).toBeVisible();
  } finally {
    first.resolve();
    second.resolve();
  }
});

test("a stale tab cannot overwrite a saved expansion and can reopen the latest version", async ({
  page,
  context,
}) => {
  await page.route("**/api/search", (route) =>
    route.fulfill({ json: javascript }),
  );
  await page.route("**/api/related", (route) =>
    route.fulfill({ json: reactExpansion }),
  );
  await page.goto("/");
  await searchJavaScript(page);
  await expect(saved(page)).toBeVisible();
  const other = await context.newPage();
  try {
    await other.goto("/");
    await saved(other).click();
    await expect(graph(other).getByText("2 concepts")).toBeVisible();

    await selectReact(page);
    await details(page).getByRole("button", { name: "Expand concept" }).click();
    await expect(saved(page)).toHaveAccessibleDescription(/4 concepts/);
    await selectReact(other);
    await expect(other.getByText(/changed in another tab/)).toBeVisible();
    await expect(saved(other)).toHaveAccessibleDescription(/4 concepts/);
    await saved(other).click();
    await expect(graph(other).getByText("4 concepts")).toBeVisible();
    await expect(
      details(other).getByRole("button", { name: "Concept expanded." }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});
