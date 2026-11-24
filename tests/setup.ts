import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import type cytoscapeFactory from "cytoscape";
import type { CytoscapeOptions } from "cytoscape";
import { afterEach, vi } from "vitest";

vi.mock("cytoscape", async (importOriginal) => {
  const { default: cytoscape } = await importOriginal<{
    default: typeof cytoscapeFactory;
  }>();
  return {
    default: vi.fn((options: CytoscapeOptions) =>
      cytoscape({
        ...options,
        container: undefined,
        headless: true,
        styleEnabled: true,
      }),
    ),
  };
});

afterEach(cleanup);
