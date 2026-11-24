import type { Core, NodeCollection, Position } from "cytoscape";
import { nodeElementId } from "./cytoscape-elements";

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
  const existing = core.nodes().difference(added).nodes();
  const occupied: Position[] = [];
  existing.forEach((node) => {
    occupied.push(node.position());
  });
  const unanchored = added.filter((node) => !node.data("expandedFrom")).nodes();
  if (unanchored.nonempty()) {
    const bounds = existing.boundingBox({ includeLabels: false });
    unanchored
      .layout({
        name: "grid",
        cols: 1,
        fit: false,
        boundingBox: {
          x1: bounds.x2 + 50,
          y1: bounds.y1,
          w: 145,
          h: unanchored.length * 74,
        },
      })
      .run();
    unanchored.forEach((node) => {
      occupied.push(node.position());
    });
  }

  core.batch(() => {
    added.difference(unanchored).forEach((node) => {
      const anchor = core
        .$id(nodeElementId(node.data("expandedFrom")))
        .position();
      for (let ring = 1; ; ring += 1) {
        const slots = ring * 8;
        for (let slot = 0; slot < slots; slot += 1) {
          const angle = (slot * 2 * Math.PI) / slots + Math.PI / 2;
          const position = {
            x: anchor.x + Math.cos(angle) * ring * 152,
            y: anchor.y + Math.sin(angle) * ring * 84,
          };
          if (
            occupied.some(
              (other) =>
                Math.abs(position.x - other.x) < 138 &&
                Math.abs(position.y - other.y) < 62,
            )
          )
            continue;
          node.position(position);
          occupied.push(position);
          return;
        }
      }
    });
  });
}
