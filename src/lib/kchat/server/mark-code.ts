/** Server-only mark codes. Never import this from client routes. */

import type { VerifyKind } from "../types";

const ORG = "0915";
const FOUNDER = "0916";
const ARC = "9999";

export function matchMarkCode(raw: string): Exclude<VerifyKind, "none"> | null {
  const code = raw.replace(/\s+/g, "").trim();
  if (code === ARC) return "arc";
  if (code === FOUNDER) return "founder";
  if (code === ORG) return "org";
  return null;
}

export function markLabel(kind: VerifyKind): string | null {
  if (kind === "org") return "Official organization";
  if (kind === "founder") return "Nyx founder";
  if (kind === "developer") return "Developer";
  if (kind === "arc") return "ARC Admin";
  return null;
}

export function roleForKind(kind: VerifyKind): "user" | "admin" | "super_admin" {
  if (kind === "arc" || kind === "founder") return "super_admin";
  if (kind === "org" || kind === "developer") return "admin";
  return "user";
}

export function isFounderExclusive(kind: VerifyKind): boolean {
  return kind === "founder";
}
