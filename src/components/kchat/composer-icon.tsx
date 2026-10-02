import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/utils/nativeCapabilities";

export function ComposerIcon({
  label,
  pressed,
  tone = "plain",
  className,
  children,
  onClick,
  ...props
}: ComponentProps<"button"> & {
  label: string;
  pressed?: boolean;
  tone?: "plain" | "send" | "record";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={cn("kc-composer-icon", tone !== "plain" && `kc-composer-icon-${tone}`, className)}
      onClick={(e) => {
        if (tone === "send" || tone === "record") triggerHaptic();
        onClick?.(e);
      }}
      {...props}
    >
      <span className="kc-composer-icon-glyph">{children}</span>
    </button>
  );
}
