import { useEffect, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Keep CSS viewport tokens in sync with the visual viewport (keyboard, browser chrome). */
export function ViewportSync() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const vv = window.visualViewport;
      const height = Math.round(vv?.height ?? window.innerHeight);
      const width = Math.round(vv?.width ?? window.innerWidth);
      const top = Math.round(vv?.offsetTop ?? 0);
      const keyboard = Math.max(0, Math.round(window.innerHeight - height - top));
      root.style.setProperty("--kc-vv-h", `${height}px`);
      root.style.setProperty("--kc-vv-w", `${width}px`);
      root.style.setProperty("--kc-vv-top", `${top}px`);
      root.style.setProperty("--kc-inner-h", `${window.innerHeight}px`);
      root.style.setProperty("--kc-inner-w", `${window.innerWidth}px`);
      if (!root.classList.contains("native-app")) {
        root.style.setProperty("--kc-keyboard-h", `${keyboard}px`);
        root.classList.toggle("keyboard-open", keyboard > 80);
      }
    };
    apply();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    void import("@/lib/kchat/purchase-service").then((m) => m.installNativeBillingBridge()).catch(() => undefined);
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);
  return null;
}

export function NyxSafeArea({
  children,
  top,
  bottom,
  left,
  right,
  className,
}: {
  children?: ReactNode;
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
  className?: string;
}) {
  const style: CSSProperties = {
    paddingTop: top ? "var(--kc-safe-top)" : undefined,
    paddingBottom: bottom ? "var(--kc-safe-bottom)" : undefined,
    paddingLeft: left ? "var(--kc-safe-left)" : undefined,
    paddingRight: right ? "var(--kc-safe-right)" : undefined,
  };
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

export function NyxPage({
  children,
  className,
  width = "page",
}: {
  children: ReactNode;
  className?: string;
  width?: "feed" | "page" | "wide" | "full";
}) {
  return (
    <div
      className={cn(
        "kc-page-enter min-w-0",
        width === "feed" && "kc-feed",
        width === "page" && "kc-page",
        width === "wide" && "kc-page-wide",
        width === "full" && "w-full",
        className,
      )}
    >
      {children}
    </div>
  );
}
