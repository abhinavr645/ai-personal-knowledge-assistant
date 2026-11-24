import { BrainCircuit, Layers, Network, Orbit } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Exploration, GraphEdge, GraphNode } from "@/types/exploration";

const positions: Partial<Record<string, { x: number; y: number }>> = {
  "artificial-intelligence": { x: 49, y: 15 },
  "machine-learning": { x: 49, y: 49 },
  "neural-networks": { x: 17, y: 38 },
  "deep-learning": { x: 17, y: 76 },
  "supervised-learning": { x: 82, y: 22 },
  "unsupervised-learning": { x: 82, y: 51 },
  "reinforcement-learning": { x: 82, y: 80 },
};

const categories = {
  Field: {
    icon: Orbit,
    color: "text-primary",
    tile: "bg-primary/13",
    legend: "Field",
  },
  Method: {
    icon: BrainCircuit,
    color: "text-violet-300",
    tile: "bg-violet-400/12",
    legend: "Method",
  },
  "Learning approach": {
    icon: Layers,
    color: "text-sky-300",
    tile: "bg-sky-400/12",
    legend: "Learning approach",
  },
} satisfies Record<
  GraphNode["category"],
  { icon: typeof Orbit; color: string; tile: string; legend: string }
>;

function positionedEdge(edge: GraphEdge) {
  const source = positions[edge.source];
  const target = positions[edge.target];
  return source && target
    ? { ...edge, sourcePosition: source, targetPosition: target }
    : null;
}

export function KnowledgeGraphPreview({
  graph,
  selectedId,
  showLabels,
  isExample,
  onSelect,
}: {
  graph: Pick<Exploration, "nodes" | "edges" | "rootNodeId">;
  selectedId: string | null;
  showLabels: boolean;
  isExample: boolean;
  onSelect: (id: string) => void;
}) {
  const edges = graph.edges.map(positionedEdge).filter((edge) => edge !== null);
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const activeEdge =
    edges.find(
      ({ source, target }) => selectedId === source || selectedId === target,
    ) ?? edges[0];

  return (
    <section
      aria-labelledby="graph-heading"
      className="graph-panel min-w-0 overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex min-h-16 items-center justify-between gap-2 border-b border-border px-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Network size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2
              id="graph-heading"
              className="text-base leading-tight font-semibold tracking-tight"
            >
              Knowledge graph
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {graph.nodes.length} concepts <span aria-hidden="true">·</span>{" "}
              {edges.length} relationships
            </p>
          </div>
        </div>
        {isExample && (
          <span className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
            Example
          </span>
        )}
      </div>

      <div className="graph-canvas relative">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {edges.map(
            ({ id, kind, source, target, sourcePosition, targetPosition }) => (
              <line
                key={id}
                x1={sourcePosition.x}
                x2={targetPosition.x}
                y1={sourcePosition.y}
                y2={targetPosition.y}
                vectorEffect="non-scaling-stroke"
                className="graph-line"
                data-kind={kind}
                data-highlighted={
                  selectedId === source || selectedId === target
                }
              />
            ),
          )}
        </svg>
        {showLabels &&
          edges.map(({ id, label, sourcePosition, targetPosition }) => (
            <span
              key={id}
              aria-hidden="true"
              className="graph-edge-label pointer-events-none absolute -translate-1/2 rounded bg-background/90 px-1.5 py-0.5 text-xs text-muted-foreground"
              style={{
                left: `${(sourcePosition.x + targetPosition.x) / 2}%`,
                top: `${(sourcePosition.y + targetPosition.y) / 2}%`,
              }}
            >
              {label}
            </span>
          ))}
        {graph.nodes.map((node) => {
          const position = positions[node.id];
          if (!position) return null;
          const category = categories[node.category];
          const Icon = category.icon;
          return (
            <button
              key={node.id}
              type="button"
              aria-pressed={selectedId === node.id}
              onClick={() => onSelect(node.id)}
              data-root={graph.rootNodeId === node.id}
              data-category={node.category}
              className="graph-node absolute -translate-1/2 rounded-lg border leading-tight font-medium transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
            >
              <span
                className={cn(
                  "graph-node-icon grid size-7 shrink-0 place-items-center rounded-md",
                  category.color,
                  category.tile,
                )}
              >
                <Icon size={15} aria-hidden="true" />
              </span>
              <span className="min-w-0 wrap-anywhere">{node.name}</span>
            </button>
          );
        })}
        <ul aria-label="Graph relationships" className="sr-only">
          {edges.map(({ id, label, source, target }) => (
            <li key={id}>
              {names.get(source)} {label} {names.get(target)}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-3.5 py-3 sm:px-5">
        {Object.values(categories).map(({ legend, color }) => (
          <span
            key={legend}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className={cn("size-1.5 rounded-full bg-current", color)}
            />
            {legend}
          </span>
        ))}
        {showLabels && activeEdge && (
          <p
            aria-hidden="true"
            className="graph-edge-summary basis-full text-xs text-muted-foreground"
          >
            {names.get(activeEdge.source)} {activeEdge.label}{" "}
            {names.get(activeEdge.target)}
          </p>
        )}
      </div>
    </section>
  );
}
