"use client";

import { useId, useMemo } from "react";
import { Maximize, Minus, Network, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKnowledgeGraph } from "@/hooks/use-knowledge-graph";
import type { GraphLayoutPositions } from "@/lib/graph/cytoscape-layout";
import { categoryColors } from "@/lib/graph/cytoscape-style";
import { mergeGraph } from "@/lib/graph/graph-data";
import type { GraphData, TopicGraph } from "@/types/exploration";

const emptyGraph: GraphData = { nodes: [], edges: [] };

interface KnowledgeGraphProps {
  graph: TopicGraph;
  selectedId: string | null;
  showLabels: boolean;
  isExample: boolean;
  onSelect: (id: string) => void;
  layoutHints?: GraphLayoutPositions;
  restoredPositions?: GraphLayoutPositions;
  onPositionsChange?: (
    revision: number,
    positions: GraphLayoutPositions,
  ) => void;
  resetRevision?: number;
  expandedNodeIds?: ReadonlySet<string>;
  loadingNodeIds?: ReadonlySet<string>;
  emptyMessage?: string;
}

export function KnowledgeGraph({
  graph: { nodes, edges, rootNodeId },
  selectedId,
  showLabels,
  isExample,
  onSelect,
  layoutHints,
  restoredPositions,
  onPositionsChange,
  resetRevision,
  expandedNodeIds,
  loadingNodeIds,
  emptyMessage,
}: KnowledgeGraphProps) {
  const headingId = useId();
  const graph = useMemo(
    () => mergeGraph(emptyGraph, { nodes, edges }),
    [nodes, edges],
  );
  const { host, ready, failed, zoomBy, fitView, resetView } = useKnowledgeGraph(
    {
      graph,
      rootNodeId,
      selectedId,
      showLabels,
      onSelect,
      layoutHints,
      restoredPositions,
      onPositionsChange,
      resetRevision,
      expandedNodeIds,
      loadingNodeIds,
    },
  );

  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const activeEdge =
    graph.edges.find(
      ({ source, target }) => selectedId === source || selectedId === target,
    ) ?? graph.edges[0];

  return (
    <section
      aria-labelledby={headingId}
      className="graph-panel min-w-0 overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex min-h-16 items-center justify-between gap-2 border-b border-border px-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Network size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2
              id={headingId}
              className="text-base leading-tight font-semibold tracking-tight"
            >
              Knowledge graph
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              <span>{graph.nodes.length} concepts</span>{" "}
              <span aria-hidden="true">·</span>{" "}
              <span>{graph.edges.length} relationships</span>
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
        <div
          ref={host}
          data-testid="graph-viewport"
          aria-hidden="true"
          className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        />
        {(!ready || graph.nodes.length === 0) && (
          <p
            role="status"
            className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center text-sm text-muted-foreground"
          >
            {failed
              ? "The graph could not load. Browse concepts below."
              : ready
                ? emptyMessage
                : "Loading graph…"}
          </p>
        )}
      </div>

      <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-3.5 py-2 sm:px-5">
        <div
          className="flex flex-wrap gap-x-3 gap-y-1.5"
          aria-label="Concept categories"
        >
          {Object.entries(categoryColors).map(([category, color]) => (
            <span
              key={category}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              {category}
            </span>
          ))}
        </div>
        <div
          role="group"
          aria-label="Graph view controls"
          className="flex gap-1"
        >
          {[
            { label: "Zoom out", icon: Minus, action: () => zoomBy(1 / 1.25) },
            { label: "Zoom in", icon: Plus, action: () => zoomBy(1.25) },
            { label: "Fit graph", icon: Maximize, action: fitView },
            { label: "Reset graph view", icon: RotateCcw, action: resetView },
          ].map(({ label, icon: Icon, action }) => (
            <Button
              key={label}
              type="button"
              variant="ghost"
              size="icon"
              className="size-9"
              disabled={!ready}
              aria-label={label}
              title={label}
              onClick={action}
            >
              <Icon aria-hidden="true" />
            </Button>
          ))}
        </div>
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

      <details className="border-t border-border px-3.5 py-2 text-sm sm:px-5">
        <summary className="w-fit cursor-pointer rounded-sm py-1 text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          Browse concepts
        </summary>
        <ul aria-label="Graph concepts" className="flex flex-wrap gap-2 py-2">
          {graph.nodes.map((node) => (
            <li key={node.id} className="min-w-0 max-w-full">
              <Button
                type="button"
                variant="outline"
                aria-label={node.name}
                className="h-auto min-h-9 max-w-full py-1.5 wrap-anywhere whitespace-normal aria-pressed:border-primary/50 aria-pressed:text-primary"
                aria-pressed={selectedId === node.id}
                aria-busy={loadingNodeIds?.has(node.id) || undefined}
                onClick={() => onSelect(node.id)}
              >
                {node.name}
                {loadingNodeIds?.has(node.id) && (
                  <span
                    aria-hidden="true"
                    className="text-xs text-muted-foreground"
                  >
                    Loading…
                  </span>
                )}
              </Button>
            </li>
          ))}
        </ul>
      </details>
      <ul aria-label="Graph relationships" className="sr-only">
        {graph.edges.map(({ id, label, source, target }) => (
          <li key={id}>
            {names.get(source)} {label} {names.get(target)}
          </li>
        ))}
      </ul>
    </section>
  );
}
