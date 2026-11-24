import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WorkspaceSettings({
  open,
  onOpenChange,
  showLabels,
  onLabelsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showLabels: boolean;
  onLabelsChange: (show: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/65" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-1/2 rounded-xl border border-border bg-card p-6 shadow-xl outline-none">
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="text-xl font-semibold">
              Workspace settings
            </Dialog.Title>
            <Dialog.Close
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close settings"
                />
              }
            >
              <X aria-hidden="true" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Choose what to display in the graph preview.
          </Dialog.Description>
          <label className="mt-5 flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border px-3 py-3 text-sm">
            Show relationship labels
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-primary focus-visible:outline-primary"
              checked={showLabels}
              onChange={(event) => onLabelsChange(event.target.checked)}
            />
          </label>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
