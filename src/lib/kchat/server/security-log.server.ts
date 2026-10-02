import { createHash } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";
import { newId } from "../ids";
import { sqlClient } from "./helpers";

type Sql = Awaited<ReturnType<typeof sqlClient>>;

function ipHash(): string {
  try {
    const req = getRequest();
    const xf = req?.headers.get("x-forwarded-for") ?? "";
    const ip = xf.split(",")[0]?.trim() || req?.headers.get("x-real-ip") || "0";
    return createHash("sha256").update(ip).digest("hex").slice(0, 16);
  } catch {
    return "0";
  }
}

function userAgent(): string {
  try {
    return (getRequest()?.headers.get("user-agent") ?? "").slice(0, 180);
  } catch {
    return "";
  }
}

export async function sameSite() {
  const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
  assertSameSiteRequest();
}

export function requestIpHash(): string {
  return ipHash();
}

export function attemptKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export async function writeSecurityEvent(
  sql: Sql,
  opts: { userId?: string | null; actorId?: string | null; kind: string; detail?: string },
): Promise<void> {
  try {
    await sql`
      insert into security_events (id, user_id, actor_id, kind, detail, ip_hash)
      values (
        ${newId("se")},
        ${opts.userId ?? null},
        ${opts.actorId ?? null},
        ${opts.kind.slice(0, 40)},
        ${(opts.detail ?? "").slice(0, 240)},
        ${ipHash()}
      )
    `;
  } catch {
    /* table may not exist until 0011 applies */
  }
}

export async function writeAdminAudit(
  sql: Sql,
  opts: { actorId: string; action: string; targetId?: string | null; detail?: string },
): Promise<void> {
  try {
    await sql`
      insert into admin_audit (id, actor_id, action, target_id, detail)
      values (
        ${newId("aa")},
        ${opts.actorId},
        ${opts.action.slice(0, 40)},
        ${opts.targetId ?? null},
        ${(opts.detail ?? "").slice(0, 240)}
      )
    `;
  } catch {
    /* ignore */
  }
}

export async function recordLoginEvent(
  sql: Sql,
  userId: string,
  kind: "success" | "failed" | "logout" | "revoke",
): Promise<void> {
  try {
    await sql`
      insert into login_events (id, user_id, user_agent, kind, ip_hash)
      values (${newId("le")}, ${userId}, ${userAgent()}, ${kind}, ${ipHash()})
    `;
  } catch {
    try {
      await sql`
        insert into login_events (id, user_id, user_agent)
        values (${newId("le")}, ${userId}, ${userAgent()})
      `;
    } catch {
      /* ignore */
    }
  }
}
