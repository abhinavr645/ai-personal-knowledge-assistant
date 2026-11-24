import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Core, EventObject } from "cytoscape";
import {
  presentGraph,
  syncGraphElements,
  type GraphPresentation,
} from "@/lib/graph/cytoscape-elements";
import {
  layoutGraph,
  placeAddedNodes,
  type GraphLayoutPositions,
} from "@/lib/graph/cytoscape-layout";
import { graphStyle } from "@/lib/graph/cytoscape-style";
import type { GraphData } from "@/types/exploration";

interface KnowledgeGraphOptions extends GraphPresentation {
  graph: GraphData;
  layoutHints?: GraphLayoutPositions;
  restoredPositions?: GraphLayoutPositions;
  resetRevision?: number;
  onSelect: (id: string) => void;
  onPositionsChange?: (
    revision: number,
    positions: GraphLayoutPositions,
  ) => void;
}

function compactColumns(width: number) {
  if (width < 440) return 2;
  if (width <= 560) return 3;
  return undefined;
}

export function useKnowledgeGraph({
  graph,
  layoutHints,
  restoredPositions,
  resetRevision = 0,
  onSelect,
  onPositionsChange,
  ...presentation
}: KnowledgeGraphOptions) {
  const host = useRef<HTMLDivElement>(null);
  const [core, setCore] = useState<Core | null>(null);
  const [failed, setFailed] = useState(false);
  const view = useRef({
    fitted: true,
    dragged: false,
    columns: compactColumns(0),
    resetRevision,
  });

  const selectNode = useEffectEvent((event: EventObject) => {
    const id: string = event.target.data("graphId");
    onSelect(id);
  });

  function fit(instance: Core) {
    view.current.fitted = true;
    if (instance.nodes().nonempty()) instance.fit(instance.elements(), 16);
  }

  function reportPositions(instance: Core) {
    if (!onPositionsChange || instance.nodes().empty()) return;
    const positions: Record<string, { x: number; y: number }> = {};
    instance.nodes().forEach((node) => {
      positions[node.data("graphId")] = { ...node.position() };
    });
    onPositionsChange(resetRevision, positions);
  }

  function reset(instance: Core, saved?: GraphLayoutPositions) {
    view.current.dragged = Boolean(saved);
    if (instance.nodes().nonempty()) {
      layoutGraph(instance, view.current.columns, layoutHints);
      if (saved) {
        instance
          .nodes()
          .positions((node) => saved[node.data("graphId")] ?? node.position());
      }
      reportPositions(instance);
    }
    fit(instance);
  }

  const resize = useEffectEvent((instance: Core) => {
    const width = host.current?.clientWidth;
    if (!width) return;
    const columns = compactColumns(width);
    const layoutChanged = columns !== view.current.columns;
    view.current.columns = columns;
    instance.resize();
    if (layoutChanged && instance.nodes().nonempty()) {
      if (view.current.fitted && !view.current.dragged)
        layoutGraph(instance, columns, layoutHints);
      presentGraph(instance, presentation, columns !== undefined);
    }
    if (view.current.fitted) fit(instance);
  });

  const syncViewport = useEffectEvent(
    (instance: Core, graph: GraphData, revision: number) => {
      const added = syncGraphElements(instance, graph);
      const resetRequested = view.current.resetRevision !== revision;
      view.current.resetRevision = revision;
      if (instance.nodes().empty()) return;
      if (resetRequested || instance.nodes().length === added.length) {
        reset(instance, restoredPositions);
      } else if (added.nonempty()) {
        view.current.fitted = false;
        placeAddedNodes(instance, added);
        reportPositions(instance);
      }
    },
  );

  const syncPresentation = useEffectEvent((instance: Core) => {
    presentGraph(instance, presentation, view.current.columns !== undefined);
  });
  const finishDrag = useEffectEvent((instance: Core) => {
    view.current.dragged = true;
    reportPositions(instance);
  });

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let cancelled = false;
    let instance: Core | undefined;

    void import("cytoscape")
      .then(({ default: createCytoscape }) => {
        if (cancelled) return;
        view.current.columns = compactColumns(container.clientWidth);
        instance = createCytoscape({
          container,
          elements: [],
          style: graphStyle(
            getComputedStyle(container).fontFamily || "sans-serif",
          ),
          layout: { name: "preset", fit: false },
          minZoom: 0.12,
          maxZoom: 3,
          boxSelectionEnabled: false,
          autounselectify: true,
        });
        setCore(instance);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    if (!core) return;
    syncViewport(core, graph, resetRevision);
  }, [core, graph, resetRevision]);

  const {
    rootNodeId,
    selectedId,
    expandedNodeIds,
    loadingNodeIds,
    showLabels,
  } = presentation;
  useEffect(() => {
    if (!core) return;
    syncPresentation(core);
  }, [
    core,
    graph,
    rootNodeId,
    selectedId,
    expandedNodeIds,
    loadingNodeIds,
    showLabels,
  ]);

  useEffect(() => {
    const container = host.current;
    if (!core || !container) return;
    const onTap = (event: EventObject) => selectNode(event);
    const onViewportGesture = () => {
      view.current.fitted = false;
    };
    const onDrag = () => finishDrag(core);
    core.on("tap", "node", onTap);
    core.on("dragpan scrollzoom pinchzoom", onViewportGesture);
    core.on("dragfree", "node", onDrag);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (!core.destroyed()) resize(core);
          });
    observer?.observe(container);

    return () => {
      observer?.disconnect();
      core.off("tap", "node", onTap);
      core.off("dragpan scrollzoom pinchzoom", onViewportGesture);
      core.off("dragfree", "node", onDrag);
    };
  }, [core]);

  return {
    host,
    ready: core !== null,
    failed,
    zoomBy(factor: number) {
      if (!core) return;
      view.current.fitted = false;
      core.zoom({
        level: core.zoom() * factor,
        renderedPosition: { x: core.width() / 2, y: core.height() / 2 },
      });
    },
    fitView() {
      if (core) fit(core);
    },
    resetView() {
      if (core) reset(core);
    },
  };
}
