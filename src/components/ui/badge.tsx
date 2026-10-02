import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "default",
  children,
}: {
  className?: string;
  tone?: "default" | "accent" | "live" | "muted";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "live" && "bg-live/15 text-live",
        tone === "muted" && "bg-elevated text-muted",
        tone === "default" && "bg-elevated text-fg",
        className,
      )}
    >
      {children}
    </span>
  );
}
