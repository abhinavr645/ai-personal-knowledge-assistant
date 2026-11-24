import { Dialog } from "@base-ui/react/dialog";
import { ChevronRight, FlaskConical, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardSidebar, type SidebarActions } from "./dashboard-sidebar";

export function DashboardHeader({
  sidebar,
  open,
  onOpenChange,
  returnFocus,
}: {
  sidebar: SidebarActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => HTMLElement | boolean | null;
}) {
  return (
    <header className="flex h-15 items-center justify-between gap-2 border-b border-border px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-2.5 text-sm">
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
          <Dialog.Trigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation"
                className="-ml-1 md:hidden"
              />
            }
          >
            <PanelLeft aria-hidden="true" />
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/65" />
            <Dialog.Popup
              finalFocus={returnFocus}
              className="fixed inset-y-0 left-0 z-50 w-66 max-w-[85vw] border-r border-border outline-none"
            >
              <Dialog.Title className="sr-only">Workspace menu</Dialog.Title>
              <DashboardSidebar {...sidebar} drawer />
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
        <span className="hidden text-muted-foreground sm:inline">
          Workspace
        </span>
        <ChevronRight
          size={14}
          aria-hidden="true"
          className="hidden text-muted-foreground sm:inline"
        />
        <span className="font-medium text-foreground">Explorer</span>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
        <FlaskConical size={14} aria-hidden="true" className="text-primary" />{" "}
        Local demo
      </span>
    </header>
  );
}
