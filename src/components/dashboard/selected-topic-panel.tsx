import { Focus, LoaderCircle, Network, Orbit } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Expansion } from "@/hooks/use-exploration";
import type { KnowledgeSource } from "@/lib/ai/evidence-schemas";
import type { GraphNode } from "@/types/exploration";
import { SourceLinks } from "./answer-panel";
import { EmptyState } from "./empty-state";

export function SelectedTopicPanel({
  node,
  related,
  onSelect,
  expansion,
  sources,
  canExpand,
  graphFull,
  onExpand,
}: {
  node: GraphNode | undefined;
  related: GraphNode[];
  onSelect: (id: string) => void;
  expansion: Expansion | undefined;
  sources: ReadonlyMap<string, KnowledgeSource>;
  canExpand: boolean;
  graphFull: boolean;
  onExpand: (node: GraphNode) => void;
}) {
  const knowledge =
    expansion && "knowledge" in expansion ? expansion.knowledge : undefined;
  const references =
    knowledge?.sources ??
    [...new Set(node?.sourceIds)].flatMap((id) => {
      const source = sources.get(id);
      return source ? [source] : [];
    });
  const loading = expansion?.status === "loading";
  const complete =
    expansion?.status === "expanded" || expansion?.status === "empty";
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
        <div className="flex flex-1 flex-col px-4 py-5 wrap-anywhere sm:px-5">
          <div>
            <span className="inline-block rounded-md border border-primary/20 bg-primary/9 px-2 py-0.5 text-xs font-medium text-primary">
              {node.category}
            </span>
            <h3 className="mt-3 text-xl leading-tight font-semibold tracking-tight">
              {node.name}
            </h3>
            <p className="mt-2.5 text-base leading-relaxed text-muted-foreground">
              {knowledge?.explanation.summary.text ?? node.description}
            </p>
            {knowledge && (
              <>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {knowledge.explanation.detail.text}
                </p>
                {knowledge.evidenceNote && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {knowledge.evidenceNote}
                  </p>
                )}
              </>
            )}
            <SourceLinks sources={references} />
          </div>
          {related.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <h4 className="text-sm font-medium">Related concepts</h4>
              <ul className="mt-2.5 flex flex-wrap gap-2">
                {related.map((concept) => (
                  <li key={concept.id}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto min-h-8 max-w-full rounded-lg px-2.5 py-1.5 text-xs wrap-anywhere whitespace-normal text-muted-foreground"
                      onClick={() => onSelect(concept.id)}
                    >
                      {concept.name}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {canExpand && (
            <div className="mt-auto pt-5" aria-busy={loading}>
              {expansion && "message" in expansion && (
                <p
                  role={expansion.status === "failed" ? "alert" : "status"}
                  className="mb-2 text-sm text-muted-foreground"
                >
                  {expansion.message}
                </p>
              )}
              {expansion?.status === "expanded" && (
                <p role="status" className="mb-2 text-sm text-muted-foreground">
                  Concept expanded.
                </p>
              )}
              {graphFull && !complete && !loading && (
                <p role="status" className="mb-2 text-sm text-muted-foreground">
                  This exploration reached its concept limit.
                </p>
              )}
              {!complete && !graphFull && (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 w-full gap-2 text-primary hover:text-primary"
                  disabled={loading}
                  onClick={() => onExpand(node)}
                >
                  {loading ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="motion-safe:animate-spin"
                    />
                  ) : (
                    <Network aria-hidden="true" />
                  )}
                  {loading
                    ? "Expanding…"
                    : expansion?.status === "failed"
                      ? "Retry expansion"
                      : "Expand concept"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
