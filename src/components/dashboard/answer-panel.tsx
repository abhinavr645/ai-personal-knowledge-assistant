import { BookOpen, Check, FileText, LoaderCircle } from "lucide-react";
import type { KnowledgeSource } from "@/lib/ai/evidence-schemas";
import type { DisplayKnowledge } from "@/lib/exploration/contracts";

export function SourceLinks({
  sources,
}: {
  sources: readonly KnowledgeSource[];
}) {
  if (sources.length === 0) return null;
  return (
    <ul
      className="mt-3 flex min-w-0 flex-wrap gap-2"
      aria-label="Source references"
    >
      {sources.map((source) => (
        <li key={source.id} className="min-w-0 max-w-full">
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:text-primary"
          >
            <FileText size={14} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 wrap-anywhere">{source.title}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function AnswerPanel({
  knowledge,
  searching,
  message,
  failed,
}: {
  knowledge: DisplayKnowledge | undefined;
  searching: boolean;
  message?: string;
  failed: boolean;
}) {
  const answer = knowledge?.explanation;
  return (
    <section
      aria-labelledby="answer-heading"
      aria-busy={searching}
      className="min-w-0 rounded-xl border border-border bg-card"
    >
      <div className="flex min-h-16 items-center justify-between gap-2 border-b border-border px-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
            <BookOpen size={17} aria-hidden="true" />
          </span>
          <h2
            id="answer-heading"
            className="text-base font-semibold tracking-tight"
          >
            Topic explanation
          </h2>
        </div>
      </div>
      {!answer ? (
        <p
          role={failed ? "alert" : "status"}
          className="flex min-h-19 items-center gap-2 px-4 py-4 text-sm text-muted-foreground sm:px-5"
        >
          {searching && (
            <LoaderCircle
              size={16}
              aria-hidden="true"
              className="motion-safe:animate-spin"
            />
          )}
          {searching
            ? "Retrieving sources and generating an explanation…"
            : (message ?? "Search for a topic to see an explanation here.")}
        </p>
      ) : (
        <div className="px-4 py-5 wrap-anywhere sm:px-5">
          <h3 className="text-2xl font-semibold tracking-tight">
            {answer.title}
          </h3>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-muted-foreground">
            {answer.summary.text}
          </p>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-muted-foreground">
            {answer.detail.text}
          </p>
          {knowledge.evidenceNote && (
            <p className="mt-3 text-sm text-muted-foreground">
              {knowledge.evidenceNote}
            </p>
          )}
          <div className="mt-6 space-y-5">
            {answer.sections.map((section, index) => (
              <section key={index}>
                <h4 className="text-base font-medium">{section.heading}</h4>
                <p className="mt-1.5 max-w-prose text-base leading-relaxed text-muted-foreground">
                  {section.text}
                </p>
              </section>
            ))}
          </div>
          <section className="mt-6 rounded-lg border border-primary/15 bg-primary/5 p-4">
            <h4 className="text-sm font-semibold">Key takeaways</h4>
            <ul className="mt-2 space-y-2">
              {answer.takeaways.map((takeaway, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"
                >
                  <Check
                    size={15}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-primary"
                  />
                  {takeaway.text}
                </li>
              ))}
            </ul>
          </section>
          <section className="mt-6 border-t border-border pt-5">
            <h4 className="text-sm font-semibold">Sources</h4>
            <SourceLinks sources={knowledge.sources} />
          </section>
        </div>
      )}
    </section>
  );
}
