import type { Core, NodeCollection, Position } from "cytoscape";

export type GraphLayoutPositions = Readonly<Partial<Record<string, Position>>>;

export function layoutGraph(
  core: Core,
  columns: number | undefined,
  hints?: GraphLayoutPositions,
) {
  const nodes = core.nodes();
  if (columns === undefined && hints) {
    const positions: Record<string, Position> = {};
    nodes.forEach((node) => {
      const id: string = node.data("graphId");
      if (!Object.hasOwn(hints, id)) return;
      const position = hints[id];
      if (position) positions[node.id()] = position;
    });
    if (Object.keys(positions).length === nodes.length) {
      core.layout({ name: "preset", positions, fit: false }).run();
      return;
    }
  }

  const cols = columns ?? Math.ceil(Math.sqrt(nodes.length));
  core
    .layout({
      name: "grid",
      cols,
      fit: false,
      boundingBox: {
        x1: 0,
        y1: 0,
        w: cols * 145,
        h: Math.ceil(nodes.length / cols) * 74,
      },
    })
    .run();
}

export function placeAddedNodes(core: Core, added: NodeCollection) {
  const bounds = core
    .nodes()
    .difference(added)
    .boundingBox({ includeLabels: false });
  added
    .layout({
      name: "grid",
      cols: 1,
      fit: false,
      boundingBox: {
        x1: bounds.x2 + 50,
        y1: bounds.y1,
        w: 145,
        h: added.length * 74,
      },
    })
    .run();
}
