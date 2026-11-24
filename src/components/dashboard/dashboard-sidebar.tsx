import { Compass, History, Network, Plus, Settings, X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/button";
import {
  exampleEntries,
  type ExampleEntry,
} from "@/lib/mock-data/example-exploration";
import { cn } from "@/lib/utils";

export interface SidebarActions {
  activeQuery: string | null;
  onNew: () => void;
  onNavigate: () => void;
  onRecent: (entry: ExampleEntry) => void;
  onSettings: () => void;
}

export function DashboardSidebar({
  activeQuery,
  onNew,
  onNavigate,
  onRecent,
  onSettings,
  drawer = false,
}: SidebarActions & { drawer?: boolean }) {
  const hasActiveRecent = exampleEntries.some(
    ({ query }) => query === activeQuery,
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar px-4 pt-5 pb-4">
      <div className="mb-9 flex items-center gap-2.5 px-1">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/12 text-primary">
          <Network size={19} aria-hidden="true" />
        </span>
        <span className="text-sm leading-tight font-semibold tracking-tight text-foreground">
          Knowledge Assistant
        </span>
        {drawer && (
          <Dialog.Close
            render={
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                aria-label="Close navigation"
              />
            }
          >
            <X aria-hidden="true" />
          </Dialog.Close>
        )}
      </div>

      <nav
        aria-label="Workspace navigation"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        <Button
          variant="outline"
          type="button"
          className="mb-6 h-10 w-full justify-start gap-2.5 border-primary/25 bg-primary/9 px-3 font-semibold text-primary hover:bg-primary/15 hover:text-primary dark:border-primary/25 dark:bg-primary/9 dark:hover:bg-primary/15"
          onClick={onNew}
        >
          <Plus aria-hidden="true" /> New exploration
        </Button>
        <Button
          variant="ghost"
          type="button"
          aria-current={hasActiveRecent ? undefined : "page"}
          onClick={onNavigate}
          className={cn(
            "h-10 w-full justify-start gap-2.5 px-3",
            !hasActiveRecent && "bg-sidebar-accent text-foreground",
          )}
        >
          <Compass
            aria-hidden="true"
            className={
              hasActiveRecent ? "text-muted-foreground" : "text-primary"
            }
          />{" "}
          Explorer
        </Button>
        <div className="mt-9 flex items-center gap-2 px-3 text-xs font-medium text-muted-foreground">
          <History size={14} aria-hidden="true" />
          <h2>Recent explorations</h2>
        </div>
        <ul className="mt-2 space-y-0.5">
          {exampleEntries.map((entry) => (
            <li key={entry.nodeId}>
              <Button
                variant="ghost"
                type="button"
                className={cn(
                  "h-9 w-full justify-start gap-2.5 px-3 text-muted-foreground",
                  activeQuery === entry.query &&
                    "bg-sidebar-accent text-foreground",
                )}
                aria-current={activeQuery === entry.query ? "true" : undefined}
                onClick={() => onRecent(entry)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full bg-muted-foreground/55",
                    activeQuery === entry.query && "bg-primary",
                  )}
                />
                {entry.name}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-auto border-t border-sidebar-border pt-3">
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full justify-start gap-2.5 px-3 text-muted-foreground"
            onClick={onSettings}
          >
            <Settings aria-hidden="true" /> Settings
          </Button>
        </div>
      </nav>
    </div>
  );
}
