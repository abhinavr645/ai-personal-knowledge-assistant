import type { Core } from "cytoscape";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  concept,
  hooksExpansion,
  javascript,
  reactExpansion,
  success,
} from "../fixtures/exploration";

async function graphViewport(page: Page) {
  const graph = page.getByRole("region", { name: "Knowledge graph" });
  const viewport = graph.getByTestId("graph-viewport");
  await expect(graph.getByRole("button", { name: "Fit graph" })).toBeEnabled();
  await expect(viewport.locator("canvas").first()).toBeVisible();
  await viewport.scrollIntoViewIfNeeded();
  return { graph, viewport };
}

// Cytoscape associates its core with the container. Read it to measure real canvas
// positions and validate the result of browser input without a production test API.
async function inspectGraph(viewport: Locator) {
  return viewport.evaluate((element) => {
    const core = (element as HTMLElement & { _cyreg?: { cy: Core } })._cyreg
      ?.cy;
    if (!core) throw new Error("Cytoscape is not mounted");
    const { x, y, width, height } = element.getBoundingClientRect();
    return {
      bounds: { x, y, width, height },
      zoom: core.zoom(),
      pan: core.pan(),
      nodes: Object.fromEntries(
        core.nodes().map((node) => [
          node.id(),
          {
            position: node.position(),
            rendered: node.renderedPosition(),
            selected: node.hasClass("is-selected"),
            neighbor: node.hasClass("is-neighbor"),
            dimmed: node.hasClass("is-dimmed"),
          },
        ]),
      ),
      edges: Object.fromEntries(
        core
          .edges()
          .map((edge) => [
            edge.id(),
            { highlighted: edge.hasClass("is-connected") },
          ]),
      ),
    };
  });
}

test("preserves recursive graph expansion through refresh and supports reopening, expanding, renaming, and deleting", async ({
  page,
}) => {
  const issues: string[] = [];
  const expanded: string[] = [];
  let searches = 0;
  const useStateExpansion = {
    ...success(
      "JavaScript",
      "useState details",
      ["Functional updates"],
      [["useState", "Functional updates"]],
    ),
    conceptId: concept("useState").id,
  };
  page.on("pageerror", (error) => issues.push(error.message));
  page.on("console", (message) => {
    if (
      ["warning", "error"].includes(message.type()) &&
      !message
        .text()
        .includes("https://nextjs.org/docs/messages/cache-bypass-in-dev")
    )
      issues.push(message.text());
  });
  await page.route("**/api/search", async (route) => {
    searches += 1;
    expect(route.request().postDataJSON()).toEqual({ query: "JavaScript" });
    await route.fulfill({ json: javascript });
  });
  await page.route("**/api/related", async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.topic).toBe("JavaScript");
    expanded.push(payload.concept.name);
    if (payload.concept.name === "Hooks") {
      expect(payload.existingConceptIds).toContain(concept("React").id);
      expect(payload.neighbors).toContainEqual({
        id: concept("Components").id,
        name: "Components",
      });
    }
    if (payload.concept.name === "useState") {
      expect(payload.existingConceptIds).toContain(concept("React").id);
      expect(payload.neighbors).toContainEqual({
        id: concept("Hooks").id,
        name: "Hooks",
      });
    }
    const replies = {
      React: reactExpansion,
      Hooks: hooksExpansion,
      useState: useStateExpansion,
    };
    await route.fulfill({
      json: replies[payload.concept.name as keyof typeof replies],
    });
  });
  await page.goto("/");
  await expect(page.getByText("Example", { exact: true })).toBeVisible();
  const search = page.getByRole("searchbox");
  await search.fill("JavaScript");
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { name: "JavaScript overview" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Topic explanation" })
      .getByRole("link", { name: "Reference documentation" }),
  ).toBeVisible();
  const { graph, viewport } = await graphViewport(page);
  const details = page.getByRole("region", { name: "Concept details" });

  const reactId = `node:${concept("React").id}`;
  const hooksId = `node:${concept("Hooks").id}`;
  const initial = await inspectGraph(viewport);
  expect(Object.keys(initial.nodes)).toHaveLength(2);
  await viewport.click({ position: initial.nodes[reactId].rendered });
  await expect(details.getByRole("heading", { name: "React" })).toBeVisible();
  const { x, y } = initial.bounds;
  const { x: nodeX, y: nodeY } = initial.nodes[reactId].rendered;
  await page.mouse.move(x + nodeX, y + nodeY);
  await page.mouse.down();
  await page.mouse.move(x + nodeX - 24, y + nodeY + 20, { steps: 6 });
  await page.mouse.up();
  await graph.getByRole("button", { name: "Zoom out" }).click();
  const before = await inspectGraph(viewport);
  expect(before.nodes[reactId].position).not.toEqual(
    initial.nodes[reactId].position,
  );

  await details.getByRole("button", { name: "Expand concept" }).click();
  await expect(graph.getByText("4 concepts")).toBeVisible();
  await expect
    .poll(async () => Object.keys((await inspectGraph(viewport)).nodes).length)
    .toBe(4);
  const after = await inspectGraph(viewport);
  expect(after.pan).toEqual(before.pan);
  expect(after.zoom).toBe(before.zoom);
  expect(after.nodes[reactId].position).toEqual(before.nodes[reactId].position);
  expect(
    Math.hypot(
      after.nodes[hooksId].position.x - after.nodes[reactId].position.x,
      after.nodes[hooksId].position.y - after.nodes[reactId].position.y,
    ),
  ).toBeLessThan(240);

  await graph.getByText("Browse concepts").click();
  await graph.getByRole("button", { name: "Hooks" }).click();
  await expect(details.getByRole("heading", { name: "Hooks" })).toBeVisible();
  await details.getByRole("button", { name: "Expand concept" }).click();
  await expect(graph.getByRole("button", { name: "useState" })).toBeVisible();
  await expect(graph.getByText("5 concepts")).toBeVisible();
  await expect(graph.getByText("4 relationships")).toBeVisible();
  await expect
    .poll(async () => Object.keys((await inspectGraph(viewport)).nodes).length)
    .toBe(5);
  const final = await inspectGraph(viewport);
  expect(Object.keys(final.nodes)).toEqual(
    expect.arrayContaining(Object.keys(after.nodes)),
  );
  expect(Object.keys(final.edges)).toEqual(
    expect.arrayContaining(Object.keys(after.edges)),
  );
  expect(Object.keys(final.edges)).toEqual(
    expect.arrayContaining(Object.keys(initial.edges)),
  );
  expect(final.nodes[reactId].position).toEqual(before.nodes[reactId].position);
  expect(expanded).toEqual(["React", "Hooks"]);

  const history = page.getByRole("list", { name: "Saved explorations" });
  const saved = history.getByRole("button", {
    name: "JavaScript",
    exact: true,
  });
  await expect(saved).toHaveAttribute("aria-current", "true");
  await expect(saved).toHaveAccessibleDescription(/5 concepts/);
  await page.reload();
  await expect(saved).toBeVisible();
  await expect(saved).not.toHaveAttribute("aria-current", "true");
  await saved.click();
  const answer = page.getByRole("region", { name: "Topic explanation" });
  await expect(
    answer.getByRole("heading", { name: "JavaScript overview" }),
  ).toBeVisible();
  await expect(
    answer.getByRole("link", { name: "Reference documentation" }),
  ).toHaveAttribute("href", javascript.knowledge.sources[0].url);
  await expect(details.getByRole("heading", { name: "Hooks" })).toBeVisible();
  await expect(details.getByText("Details about Hooks details.")).toBeVisible();
  await expect(details.getByText("Concept expanded.")).toBeVisible();
  await expect(
    details.getByRole("link", { name: "Reference documentation" }),
  ).toBeVisible();
  await expect(graph.getByText("5 concepts")).toBeVisible();
  await expect(graph.getByText("4 relationships")).toBeVisible();
  await expect
    .poll(async () => {
      const restored = await inspectGraph(viewport);
      return restored.nodes[reactId]?.position;
    })
    .toEqual(before.nodes[reactId].position);
  await expect
    .poll(async () => Object.keys((await inspectGraph(viewport)).edges))
    .toEqual(Object.keys(final.edges));
  expect(searches).toBe(1);
  expect(expanded).toEqual(["React", "Hooks"]);

  await graph.getByText("Browse concepts").click();
  await graph.getByRole("button", { name: "useState" }).click();
  await details.getByRole("button", { name: "Expand concept" }).click();
  await expect(
    graph.getByRole("button", { name: "Functional updates" }),
  ).toBeVisible();
  await expect(saved).toHaveAccessibleDescription(/6 concepts/);
  await history.getByRole("button", { name: "Actions for JavaScript" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename exploration" });
  await rename
    .getByRole("textbox", { name: "Exploration title" })
    .fill("JavaScript study guide");
  await rename.getByRole("button", { name: "Save title" }).click();
  const renamed = history.getByRole("button", {
    name: "JavaScript study guide",
    exact: true,
  });
  await expect(renamed).toBeVisible();
  await page.reload();
  await expect(renamed).toBeVisible();
  await expect(renamed).toHaveAccessibleDescription(/6 concepts/);
  await history
    .getByRole("button", { name: "Actions for JavaScript study guide" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const deletion = page.getByRole("dialog", { name: "Delete exploration?" });
  await expect(deletion).toContainText("JavaScript study guide");
  await deletion.getByRole("button", { name: "Delete exploration" }).click();
  await expect(page.getByText("No saved explorations yet.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("No saved explorations yet.")).toBeVisible();
  expect(expanded).toEqual(["React", "Hooks", "useState"]);
  expect(searches).toBe(1);
  expect(issues).toEqual([]);
});

test("selects, drags, pans, zooms, fits and resets the real canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const browserIssues: string[] = [];
  page.on("pageerror", (error) => browserIssues.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      browserIssues.push(message.text());
  });
  await page.goto("/");
  const { graph, viewport } = await graphViewport(page);
  const initial = await inspectGraph(viewport);
  expect(Object.keys(initial.nodes)).toHaveLength(7);
  expect(Object.keys(initial.edges)).toHaveLength(6);
  const neural = "node:neural-networks";

  await viewport.click({ position: initial.nodes[neural].rendered });
  await expect(
    page
      .getByRole("region", { name: "Concept details" })
      .getByRole("heading", { name: "Neural Networks" }),
  ).toBeVisible();
  const selected = await inspectGraph(viewport);
  expect(selected.nodes[neural].selected).toBe(true);
  expect(selected.nodes["node:machine-learning"].neighbor).toBe(true);
  expect(selected.nodes["node:supervised-learning"].dimmed).toBe(true);
  expect(selected.edges["edge:ml-nn"].highlighted).toBe(true);
  expect(selected.nodes[neural].position).toEqual(
    initial.nodes[neural].position,
  );

  const { x, y } = selected.bounds;
  const position = selected.nodes[neural].rendered;
  await page.mouse.move(x + position.x, y + position.y);
  await page.mouse.down();
  await page.mouse.move(x + position.x + 42, y + position.y + 28, { steps: 8 });
  await page.mouse.up();
  const dragged = await inspectGraph(viewport);
  expect(dragged.nodes[neural].position).not.toEqual(
    initial.nodes[neural].position,
  );

  await page.mouse.move(x + 6, y + 8);
  await page.mouse.down();
  await page.mouse.move(x + 49, y + 30, { steps: 8 });
  await page.mouse.up();
  const panned = await inspectGraph(viewport);
  expect(panned.pan).not.toEqual(dragged.pan);
  expect(panned.nodes[neural].position).toEqual(dragged.nodes[neural].position);

  await page.mouse.move(
    panned.bounds.x + panned.bounds.width / 2,
    panned.bounds.y + panned.bounds.height / 2,
  );
  await page.mouse.wheel(0, -160);
  await expect
    .poll(async () => (await inspectGraph(viewport)).zoom)
    .toBeGreaterThan(panned.zoom);
  const wheelZoom = (await inspectGraph(viewport)).zoom;
  await graph.getByRole("button", { name: "Zoom out" }).click();
  expect((await inspectGraph(viewport)).zoom).toBeLessThan(wheelZoom);
  await graph.getByRole("button", { name: "Fit graph" }).click();
  const fitted = await inspectGraph(viewport);
  expect(fitted.nodes[neural].position).toEqual(dragged.nodes[neural].position);
  expect(fitted.pan).not.toEqual(panned.pan);
  await graph.getByRole("button", { name: "Reset graph view" }).click();
  const reset = await inspectGraph(viewport);
  expect(reset.nodes[neural].position).toEqual(initial.nodes[neural].position);
  expect(reset.zoom).toBeCloseTo(initial.zoom);
  expect(reset.nodes[neural].selected).toBe(true);
  expect(browserIssues).toEqual([]);
});

test.describe("touch graph at 320px", () => {
  test.use({
    viewport: { width: 320, height: 760 },
    hasTouch: true,
    isMobile: true,
  });

  test("taps real nodes, pans by touch and restores the fitted graph", async ({
    page,
  }) => {
    await page.goto("/");
    const { graph, viewport } = await graphViewport(page);
    const initial = await inspectGraph(viewport);
    const node = initial.nodes["node:unsupervised-learning"].rendered;
    expect(node.x).toBeGreaterThan(0);
    expect(node.x).toBeLessThan(initial.bounds.width);
    expect(node.y).toBeGreaterThan(0);
    expect(node.y).toBeLessThan(initial.bounds.height);
    await page.touchscreen.tap(
      initial.bounds.x + node.x,
      initial.bounds.y + node.y,
    );
    await expect(
      page
        .getByRole("region", { name: "Concept details" })
        .getByRole("heading", { name: "Unsupervised Learning" }),
    ).toBeVisible();
    expect(
      (await inspectGraph(viewport)).nodes["node:unsupervised-learning"]
        .selected,
    ).toBe(true);

    const beforePan = await inspectGraph(viewport);
    const x = Math.round(beforePan.bounds.x + 6);
    const y = Math.round(beforePan.bounds.y + 8);
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 5; step += 1) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + step * 9, y: y + step * 4 }],
      });
    }
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const panned = await inspectGraph(viewport);
    expect(panned.pan).not.toEqual(beforePan.pan);

    await graph.getByRole("button", { name: "Zoom in" }).tap();
    const zoomed = await inspectGraph(viewport);
    expect(zoomed.zoom).toBeGreaterThan(initial.zoom);
    await graph.getByRole("button", { name: "Fit graph" }).tap();
    const fitted = await inspectGraph(viewport);
    expect(fitted.zoom).toBeLessThan(zoomed.zoom);
    expect(fitted.pan).not.toEqual(panned.pan);
    for (const { rendered } of Object.values(fitted.nodes)) {
      expect(rendered.x).toBeGreaterThan(0);
      expect(rendered.x).toBeLessThan(fitted.bounds.width);
      expect(rendered.y).toBeGreaterThan(0);
      expect(rendered.y).toBeLessThan(fitted.bounds.height);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
  });
});
