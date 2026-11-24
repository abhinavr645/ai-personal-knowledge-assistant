import { useId, useRef, useState, type RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { History, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  historyTitleSchema,
  maxHistoryTitleLength,
  type HistorySummary,
} from "@/lib/exploration/history-snapshot";
import { cn } from "@/lib/utils";

export interface HistoryAction {
  kind: "rename" | "delete";
  entry: HistorySummary;
}

export interface SidebarHistory {
  loaded: boolean;
  entries: HistorySummary[];
  skipped: number;
  error?: string;
  activeId?: string;
  onOpen: (id: string) => void;
  onAction: (action: HistoryAction) => void;
}

const formatUpdatedAt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const itemStyles =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";

export function ExplorationHistory({
  loaded,
  entries,
  skipped,
  error,
  activeId,
  onOpen,
  onAction,
}: SidebarHistory) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="mt-6 min-w-0">
      <div className="flex items-center gap-2 px-3 text-xs font-medium text-muted-foreground">
        <History size={14} aria-hidden="true" />
        <h2 id={heading}>Exploration history</h2>
      </div>
      {skipped > 0 && (
        <p role="status" className="mt-2 px-3 text-xs text-muted-foreground">
          Some saved explorations could not be opened.
        </p>
      )}
      {entries.length ? (
        <ul aria-label="Saved explorations" className="mt-2 space-y-1">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={cn(
                "flex min-w-0 items-start gap-1 rounded-lg",
                activeId === entry.id && "bg-sidebar-accent",
              )}
            >
              <div className="min-w-0 flex-1">
                <Button
                  type="button"
                  variant="ghost"
                  aria-current={activeId === entry.id ? "true" : undefined}
                  aria-describedby={`${heading}-${entry.id}`}
                  title={entry.title}
                  className="h-auto w-full px-3 pt-2 pb-1 text-left"
                  onClick={() => onOpen(entry.id)}
                >
                  <span className="w-full truncate">{entry.title}</span>
                </Button>
                <p
                  id={`${heading}-${entry.id}`}
                  className="px-3 pb-2 text-xs leading-tight text-muted-foreground"
                >
                  {entry.conceptCount}{" "}
                  {entry.conceptCount === 1 ? "concept" : "concepts"}
                  <time dateTime={entry.updatedAt} className="mt-1 block">
                    {formatUpdatedAt.format(new Date(entry.updatedAt))}
                  </time>
                </p>
              </div>
              <Menu.Root modal={false}>
                <Menu.Trigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-1"
                      aria-label={`Actions for ${entry.title}`}
                    />
                  }
                >
                  <MoreHorizontal aria-hidden="true" />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner align="end" sideOffset={4} className="z-60">
                    <Menu.Popup className="min-w-32 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl">
                      <Menu.Item
                        className={itemStyles}
                        onClick={() => onAction({ kind: "rename", entry })}
                      >
                        <Pencil size={14} aria-hidden="true" /> Rename
                      </Menu.Item>
                      <Menu.Item
                        className={cn(itemStyles, "text-destructive")}
                        onClick={() => onAction({ kind: "delete", entry })}
                      >
                        <Trash2 size={14} aria-hidden="true" /> Delete
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 px-3 text-xs leading-relaxed text-muted-foreground">
          {error
            ? "History is unavailable."
            : loaded
              ? "No saved explorations yet."
              : "Loading history…"}
        </p>
      )}
    </section>
  );
}

export function ExplorationHistoryDialog({
  action,
  onClose,
  onConfirm,
  finalFocus,
}: {
  action: HistoryAction;
  onClose: () => void;
  onConfirm: (title: string) => string | undefined;
  finalFocus: RefObject<HTMLInputElement | null>;
}) {
  const rename = action.kind === "rename";
  const [title, setTitle] = useState(action.entry.title);
  const [error, setError] = useState<string>();
  const inputId = useId();
  const errorId = useId();
  const initialFocus = useRef<HTMLInputElement | HTMLButtonElement>(null);
  const titleValid = historyTitleSchema.safeParse(title).success;

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/65" />
        <Dialog.Popup
          initialFocus={initialFocus}
          finalFocus={finalFocus}
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-1/2 rounded-xl border border-border bg-card p-5 shadow-xl outline-none sm:p-6"
        >
          <Dialog.Title className="text-xl font-semibold">
            {rename ? "Rename exploration" : "Delete exploration?"}
          </Dialog.Title>
          {!rename && (
            <Dialog.Description className="mt-2 text-sm wrap-anywhere text-muted-foreground">
              Delete “{action.entry.title}” from this browser’s history?
            </Dialog.Description>
          )}
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (rename && !titleValid) return;
              const failure = onConfirm(title);
              if (failure) setError(failure);
              else onClose();
            }}
          >
            {rename && (
              <>
                <label htmlFor={inputId} className="text-sm font-medium">
                  Exploration title
                </label>
                <input
                  id={inputId}
                  ref={(element) => {
                    initialFocus.current = element;
                  }}
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setError(undefined);
                  }}
                  required
                  aria-describedby={error ? errorId : undefined}
                  maxLength={maxHistoryTitleLength}
                  className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-primary"
                />
              </>
            )}
            {error && (
              <p
                id={errorId}
                role="alert"
                className="mt-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Dialog.Close
                render={
                  <Button
                    ref={
                      rename
                        ? undefined
                        : (element) => {
                            initialFocus.current = element;
                          }
                    }
                    type="button"
                    variant="outline"
                    size="lg"
                  />
                }
              >
                Cancel
              </Dialog.Close>
              <Button
                type="submit"
                size="lg"
                variant={rename ? "default" : "destructive"}
                disabled={rename && !titleValid}
              >
                {rename ? "Save title" : "Delete exploration"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
