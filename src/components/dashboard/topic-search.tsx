import { useId, type Ref } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exampleEntries } from "@/lib/mock-data/example-exploration";
import { cn } from "@/lib/utils";

export function TopicSearch({
  query,
  pendingQuery,
  inputError,
  inputRef,
  onChange,
  onSearch,
}: {
  query: string;
  pendingQuery: string | null;
  inputError: string;
  inputRef: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
}) {
  const inputId = useId();
  const errorId = useId();
  const searching = pendingQuery !== null;
  const sameSearch = pendingQuery === query.trim();
  const invalid = Boolean(inputError);

  return (
    <section
      aria-labelledby="explorer-title"
      className="pt-8 pb-7 sm:pt-10 sm:pb-8"
    >
      <h1
        id="explorer-title"
        className="text-[2rem] leading-tight font-semibold tracking-[-.045em] sm:text-[2.625rem]"
      >
        Knowledge Explorer
      </h1>
      <p className="mt-2.5 text-base leading-relaxed text-muted-foreground">
        Start with a question and follow how ideas connect.
      </p>
      <form
        role="search"
        aria-label="Topic search"
        className="mt-5 max-w-186"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(query);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Search for a topic
        </label>
        <div
          className={cn(
            "flex min-h-14 items-center gap-2 rounded-xl border border-input bg-card py-1.5 pr-1.5 pl-3 transition-colors focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-primary/20 sm:gap-3 sm:pl-4",
            invalid && "border-destructive",
          )}
        >
          <Search
            size={19}
            aria-hidden="true"
            className="shrink-0 text-muted-foreground"
          />
          <input
            id={inputId}
            ref={inputRef}
            value={query}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            aria-required="true"
            type="search"
            placeholder="How does machine learning work?"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
          />
          <Button
            type="submit"
            disabled={sameSearch}
            className="h-10 w-23 rounded-lg px-2 font-semibold sm:w-28"
          >
            {sameSearch ? (
              <LoaderCircle
                aria-hidden="true"
                className="hidden motion-safe:animate-spin sm:block"
              />
            ) : (
              <Search aria-hidden="true" className="hidden sm:block" />
            )}
            {sameSearch ? "Searching…" : "Search"}
          </Button>
        </div>
        <p role="status" className="sr-only">
          {searching
            ? "Searching for evidence and generating an explanation."
            : ""}
        </p>
        <div
          className="mt-3 flex min-h-7 flex-wrap items-center gap-2"
          aria-label="Example searches"
        >
          {invalid ? (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {inputError}
            </p>
          ) : (
            <>
              <span className="mr-0.5 text-xs text-muted-foreground">Try</span>
              {exampleEntries.map((entry) => (
                <Button
                  key={entry.nodeId}
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={pendingQuery === entry.query}
                  onClick={() => onSearch(entry.query)}
                  className="h-7 rounded-lg px-2.5 text-xs font-normal text-muted-foreground"
                >
                  {entry.name}
                </Button>
              ))}
            </>
          )}
        </div>
      </form>
    </section>
  );
}
