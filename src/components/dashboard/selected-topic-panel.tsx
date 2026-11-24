import { Focus, Network, Orbit } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GraphNode } from "@/types/exploration";
import { EmptyState } from "./empty-state";

export function SelectedTopicPanel({
  node,
  related,
  onSelect,
  onExplore,
}: {
  node: GraphNode | undefined;
  related: GraphNode[];
  onSelect: (id: string) => void;
  onExplore: (node: GraphNode) => void;
}) {
  return (
    <section
      aria-labelledby="details-heading"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex min-h-16 items-center gap-2.5 border-b border-border px-4 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
          <Focus size={18} aria-hidden="true" />
        </span>
        <h2
          id="details-heading"
          className="text-base font-semibold tracking-tight"
        >
          Concept details
        </h2>
      </div>
      <p role="status" className="sr-only">
        {node ? `Selected concept: ${node.name}` : ""}
      </p>
      {!node ? (
        <div className="grid min-h-50 flex-1 place-items-center px-5 py-7">
          <EmptyState
            icon={Orbit}
            title="Select a concept"
            description="Choose a node in the graph to see what it means and how it connects."
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col px-4 py-5 sm:px-5">
          <div>
            <span className="inline-block rounded-md border border-primary/20 bg-primary/9 px-2 py-0.5 text-xs font-medium text-primary">
              {node.category}
            </span>
            <h3 className="mt-3 text-xl leading-tight font-semibold tracking-tight">
              {node.name}
            </h3>
            <p className="mt-2.5 text-base leading-relaxed text-muted-foreground">
              {node.description}
            </p>
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <h4 className="text-sm font-medium">Related concepts</h4>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {related.map((concept) => (
                <li key={concept.id}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg px-2.5 text-xs whitespace-normal text-muted-foreground"
                    onClick={() => onSelect(concept.id)}
                  >
                    {concept.name}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-auto pt-5">
            <Button
              type="button"
              variant="secondary"
              className="h-10 w-full gap-2 text-primary hover:text-primary"
              onClick={() => onExplore(node)}
            >
              <Network aria-hidden="true" /> Explore topic
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
