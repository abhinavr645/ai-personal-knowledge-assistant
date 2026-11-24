import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex max-w-72 flex-col items-center text-center">
      <span className="grid size-12 place-items-center rounded-xl border border-primary/20 bg-primary/8 text-primary">
        <Icon size={22} aria-hidden="true" />
      </span>
      <p className="mt-4 text-base font-medium text-foreground">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
