import { cn } from "@/lib/utils";

export function KMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="#07090f" />
      <path
        d="M22.4 8.2 A9.2 9.2 0 1 0 22.4 23.8 A6.8 6.8 0 1 1 22.4 8.2 Z"
        fill="var(--kc-accent)"
      />
      <circle cx="23.2" cy="9.4" r="1.35" fill="var(--kc-ai)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-fg", className)}>
      <KMark className="size-8" />
      <span className="font-display text-lg font-semibold tracking-[0.18em]">NYX</span>
    </div>
  );
}
