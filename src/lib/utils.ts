import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}

export function timeAgo(iso: string | Date): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function inboxTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const t = d.getTime();
  if (!Number.isFinite(t)) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= startToday) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (t >= startToday - 86_400_000) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "K";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
