import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import cytoscape, { type Core } from "cytoscape";
import { expect, test, vi } from "vitest";
import { mergeGraph } from "@/lib/graph/graph-data";
import {
  exampleExploration,
  exampleGraphPositions,
} from "@/lib/mock-data/example-exploration";
import { KnowledgeGraph } from "./knowledge-graph";

test("keeps one Cytoscape instance, synchronizes updates, and destroys it on unmount", async () => {
  const createGraph = vi.mocked(cytoscape);
  createGraph.mockClear();
  const select = vi.fn();
  const latestSelect = vi.fn();
  const baseProps = {
    graph: exampleExploration,
    isExample: true,
    showLabels: true,
    layoutHints: exampleGraphPositions,
    onSelect: select,
  };
  const { rerender, unmount } = render(
    <StrictMode>
      <KnowledgeGraph {...baseProps} selectedId="machine-learning" />
    </StrictMode>,
  );

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Fit graph" })).toBeEnabled(),
  );
  const core: Core = createGraph.mock.results[0].value;
  expect(createGraph).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(core.nodes().length).toBe(7));
  expect(core.edges().length).toBe(6);
  const learning = core.$id("node:machine-learning");
  const neural = core.$id("node:neural-networks");
  const deep = core.$id("node:deep-learning");
  expect(learning.hasClass("is-selected")).toBe(true);
  expect(neural.hasClass("is-neighbor")).toBe(true);
  expect(deep.hasClass("is-dimmed")).toBe(true);
  expect(core.$id("edge:ml-nn").hasClass("is-connected")).toBe(true);
  expect(core.$id("edge:dl-nn").hasClass("is-dimmed")).toBe(true);
  const draggedPosition = { x: 54, y: 208 };
  learning.position(draggedPosition);
  act(() => {
    neural.emit("tap");
  });
  expect(select).toHaveBeenCalledExactlyOnceWith("neural-networks");

  const rewritten = vi.fn();
  core.on("data", rewritten);
  const updates = mergeGraph(exampleExploration, {
    nodes: [
      {
        id: "model",
        name: "Model",
        description: "A learned mapping.",
        category: "Method",
      },
    ],
    edges: [
      {
        id: "ml-model",
        source: "machine-learning",
        target: "model",
        label: "trains",
        kind: "connection",
      },
    ],
  });
  rerender(
    <StrictMode>
      <KnowledgeGraph
        {...baseProps}
        graph={{ ...exampleExploration, ...updates }}
        onSelect={latestSelect}
        selectedId="deep-learning"
        showLabels={false}
        expandedNodeIds={new Set(["machine-learning"])}
        loadingNodeIds={new Set(["deep-learning"])}
      />
    </StrictMode>,
  );

  expect(createGraph).toHaveBeenCalledTimes(1);
  expect(core.nodes().length).toBe(8);
  expect(core.edges().length).toBe(7);
  expect(core.$id("edge:ml-model").data("target")).toBe("node:model");
  expect(rewritten).not.toHaveBeenCalled();
  expect(learning.position()).toEqual(draggedPosition);
  expect(learning.hasClass("is-selected")).toBe(false);
  expect(learning.hasClass("is-expanded")).toBe(true);
  expect(learning.hasClass("is-dimmed")).toBe(true);
  expect(deep.hasClass("is-selected")).toBe(true);
  expect(deep.hasClass("is-loading")).toBe(true);
  expect(core.$id("edge:dl-nn").hasClass("is-connected")).toBe(true);
  expect(core.$id("edge:dl-nn").hasClass("show-label")).toBe(false);
  act(() => {
    deep.emit("tap");
  });
  expect(latestSelect).toHaveBeenCalledExactlyOnceWith("deep-learning");
  expect(select).toHaveBeenCalledTimes(1);

  unmount();
  expect(core.destroyed()).toBe(true);
});
