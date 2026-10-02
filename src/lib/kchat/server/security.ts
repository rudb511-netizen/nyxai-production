import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { takeToken, rateError } from "../rate-limit";
import { requireSafety, sqlClient, ensureProfile } from "./helpers";
import { publicError } from "../public-error";

function lockMs(fails: number): number {
  if (fails < 5) return 0;
  if (fails < 8) return 15_000;
  if (fails < 12) return 120_000;
  return 15 * 60_000;
}

export const checkAuthGate = createServerFn({ method: "POST" })
  .validator((d: { email: string }) => d)
  .handler(async ({ data }) => {
    const sec = await import("./security-log.server");
    await sec.sameSite();
    const wait = takeToken(`authgate:${sec.requestIpHash()}`, 40, 60_000);
    if (wait) throw publicError(new Error(rateError(wait)), rateError(wait));
    const email = data.email.trim().toLowerCase().slice(0, 120);
    if (!email.includes("@")) return { ok: true as const };
    const sql = await sqlClient();
    const key = sec.attemptKey(email);
    try {
      const row = await sql<{ fail_count: number; lock_until: string | null }>`
        select fail_count, lock_until from login_attempts where attempt_key = ${key}
      `;
      const lock = row[0]?.lock_until ? new Date(row[0].lock_until).getTime() : 0;
      if (lock > Date.now()) {
        const s = Math.ceil((lock - Date.now()) / 1000);
        throw new Error(`Too many sign-in tries. Wait ${s}s and try again.`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Too many")) throw e;
    }
    return { ok: true as const };
  });

export const noteAuthFailure = createServerFn({ method: "POST" })
  .validator((d: { email: string }) => d)
  .handler(async ({ data }) => {
    const sec = await import("./security-log.server");
    await sec.sameSite();
    const wait = takeToken(`authfail:${sec.requestIpHash()}`, 40, 60_000);
    if (wait) return { ok: true as const };
    const email = data.email.trim().toLowerCase().slice(0, 120);
    if (!email.includes("@")) return { ok: true as const };
    const sql = await sqlClient();
    const key = sec.attemptKey(email);
    try {
      const existing = await sql<{ fail_count: number; window_started_at: string }>`
        select fail_count, window_started_at from login_attempts where attempt_key = ${key}
      `;
      const started = existing[0]?.window_started_at
        ? new Date(existing[0].window_started_at).getTime()
        : 0;
      const fresh = !existing[0] || Date.now() - started > 15 * 60_000;
      const fails = fresh ? 1 : (existing[0]?.fail_count ?? 0) + 1;
      const lock = lockMs(fails);
      const lockUntil = lock ? new Date(Date.now() + lock).toISOString() : null;
      await sql`
        insert into login_attempts (attempt_key, fail_count, window_started_at, lock_until)
        values (${key}, ${fails}, ${fresh ? new Date().toISOString() : existing[0]!.window_started_at}, ${lockUntil})
        on conflict (attempt_key) do update set
          fail_count = excluded.fail_count,
          window_started_at = excluded.window_started_at,
          lock_until = excluded.lock_until
      `;
      await sec.writeSecurityEvent(sql, { kind: "login_failed", detail: "email" });
      if (fails >= 8) {
        await sec.writeSecurityEvent(sql, { kind: "login_lockout", detail: String(fails) });
      }
    } catch {
      /* ignore */
    }
    return { ok: true as const };
  });

export const noteAuthSuccess = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sec = await import("./security-log.server");
    const sql = await sqlClient();
    await sec.recordLoginEvent(sql, context.userId, "success");
    await sec.writeSecurityEvent(sql, {
      userId: context.userId,
      actorId: context.userId,
      kind: "login_ok",
    });
    const emailRows = await sql.query<{ email: string | null }>(
      `select email from "user" where id = $1`,
      [context.userId],
    );
    const email = emailRows[0]?.email?.trim().toLowerCase();
    if (email) {
      try {
        await sql`delete from login_attempts where attempt_key = ${sec.attemptKey(email)}`;
      } catch {
        /* ignore */
      }
    }
    return { ok: true as const };
  });

export const listMySessions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    try {
      const rows = await sql.query<{
        id: string;
        createdAt: string;
        updatedAt: string;
        expiresAt: string;
        ipAddress: string | null;
        userAgent: string | null;
      }>(
        `select id, "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent"
         from "session" where "userId" = $1
         order by "updatedAt" desc limit 20`,
        [context.userId],
      );
      return rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        expiresAt: r.expiresAt,
        userAgent: r.userAgent,
      }));
    } catch {
      return [];
    }
  });

export const revokeSession = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sec = await import("./security-log.server");
    const sql = await sqlClient();
    if (!data.id || data.id.length > 80) throw new Error("Session not found.");
    try {
      await sql.query(`delete from "session" where id = $1 and "userId" = $2`, [
        data.id,
        context.userId,
      ]);
    } catch {
      throw new Error("Could not sign that device out.");
    }
    await sec.recordLoginEvent(sql, context.userId, "revoke");
    await sec.writeSecurityEvent(sql, {
      userId: context.userId,
      actorId: context.userId,
      kind: "session_revoke",
    });
    return { ok: true as const };
  });

export const revokeAllSessions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sec = await import("./security-log.server");
    const sql = await sqlClient();
    try {
      await sql.query(`delete from "session" where "userId" = $1`, [context.userId]);
    } catch {
      throw new Error("Could not sign out of all devices.");
    }
    await sec.recordLoginEvent(sql, context.userId, "logout");
    await sec.writeSecurityEvent(sql, {
      userId: context.userId,
      actorId: context.userId,
      kind: "logout_all",
    });
    return { ok: true as const };
  });

export const securityOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    requireSafety(me);
    const num = async (q: string, params: unknown[] = []) => {
      try {
        const r = await sql.query<{ n: number }>(q, params);
        return r[0]?.n ?? 0;
      } catch {
        return 0;
      }
    };
    const events = await sql
      .query<{
        id: string;
        kind: string;
        detail: string;
        created_at: string;
        user_id: string | null;
      }>(
        `select id, kind, detail, created_at, user_id from security_events
         order by created_at desc limit 40`,
      )
      .catch(() => []);
    const audits = await sql
      .query<{
        id: string;
        actor_id: string;
        action: string;
        target_id: string | null;
        detail: string;
        created_at: string;
      }>(
        `select id, actor_id, action, target_id, detail, created_at from admin_audit
         order by created_at desc limit 30`,
      )
      .catch(() => []);
    return {
      failedLogins24h: await num(
        `select count(*)::int as n from security_events
         where kind = 'login_failed' and created_at > now() - interval '24 hours'`,
      ),
      lockouts24h: await num(
        `select count(*)::int as n from security_events
         where kind = 'login_lockout' and created_at > now() - interval '24 hours'`,
      ),
      openLocks: await num(`select count(*)::int as n from login_attempts where lock_until > now()`),
      sessions: await num(`select count(*)::int as n from "session"`),
      events: events ?? [],
      audits: audits ?? [],
    };
  });
