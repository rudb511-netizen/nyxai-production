import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-8 py-16 text-center", className)}>
      <div className="grid size-14 place-items-center rounded-2xl bg-elevated text-muted">
        <Icon className="size-6" strokeWidth={1.75} />
      </div>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="max-w-xs text-sm text-muted">{body}</p>
      {action}
    </div>
  );
}
