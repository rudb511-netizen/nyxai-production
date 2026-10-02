import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-fg placeholder:text-subtle outline-none transition-[box-shadow] duration-150 focus-visible:shadow-[0_0_0_2px_var(--kc-accent)] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-28 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-sm text-fg placeholder:text-subtle outline-none transition-[box-shadow] duration-150 focus-visible:shadow-[0_0_0_2px_var(--kc-accent)] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
