import { useEffect } from "react";
import type { ThemePref } from "@/lib/kchat/types";
import { applyNativeChromeTheme } from "@/utils/nativeCapabilities";

export function applyTheme(pref: ThemePref) {
  if (typeof document === "undefined") return;
  const dark =
    pref === "dark" ||
    (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  void applyNativeChromeTheme(dark);
  try {
    localStorage.setItem("kchat-theme", pref);
  } catch {
    /* ignore */
  }
}

export function ThemeBoot() {
  useEffect(() => {
    let pref: ThemePref = "dark";
    try {
      const s = localStorage.getItem("kchat-theme");
      if (s === "light" || s === "dark" || s === "system") pref = s;
    } catch {
      /* ignore */
    }
    applyTheme(pref);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      try {
        const s = localStorage.getItem("kchat-theme");
        if (s === "system" || !s) applyTheme("system");
      } catch {
        /* ignore */
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return null;
}
