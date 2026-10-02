import { createServerFn } from "@tanstack/react-start";
import { sqlClient } from "./helpers";
import { takeToken, rateError } from "../rate-limit";
import { passwordIssue } from "../password-policy";
import { newId } from "../ids";
import {
  GENERIC_REQUEST_OK,
  NYX_MAIL,
  RESET_CONFIRM_LIMIT,
  RESET_CONFIRM_WINDOW_MS,
  RESET_IP_LIMIT,
  RESET_IP_WINDOW_MS,
  RESET_MAX_ATTEMPTS,
  RESET_REQUEST_LIMIT,
  RESET_REQUEST_WINDOW_MS,
  generateResetCode,
  hashForLog,
  hashResetCode,
  isResetCodeShape,
  logSmtpFailure,
  looksLikeEmail,
  normalizeResetEmail,
  nyxFromHeader,
  passwordResetLog,
  resetCodesMatch,
  resetOtpTtlSec,
  resetResendCooldownMs,
  smtpConfigIssue,
  smtpConfigured,
  smtpHealthSnapshot,
  smtpPublicError,
} from "../mail";
import { resolveSmtpConfig } from "./mail";

function hideDeliveryError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/Gmail|Couldn't reach Gmail|Couldn't send the password reset|Password reset mail is missing/i.test(raw)) {
    return new Error(raw);
  }
  logSmtpFailure("password-reset", err);
  return new Error(smtpPublicError(err));
}

function readOtp(data: { otp?: string; code?: string }): string {
  return String(data.otp ?? data.code ?? "").replace(/\s/g, "");
}

async function cleanupExpiredOtps(sql: Awaited<ReturnType<typeof sqlClient>>): Promise<void> {
  try {
    await sql`
      delete from password_reset_otps
      where expires_at < now() - interval '7 days'
         or (used_at is not null and used_at < now() - interval '7 days')
    `;
  } catch {
    /* table may not exist yet */
  }
}

async function loadActiveOtp(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  email: string,
): Promise<{
  id: string;
  user_id: string | null;
  code_hash: string;
  attempts: number;
  expires_at: string;
  used_at: string | null;
  request_id: string | null;
} | null> {
  try {
    const rows = await sql<{
      id: string;
      user_id: string | null;
      code_hash: string;
      attempts: number;
      expires_at: string;
      used_at: string | null;
      request_id: string | null;
    }>`
      select id, user_id, code_hash, attempts, expires_at, used_at, request_id
      from password_reset_otps
      where email_lc = ${email} and used_at is null
      order by created_at desc
      limit 1
    `;
    const row = rows[0];
    return row ? { ...row, request_id: row.request_id ?? row.id } : null;
  } catch {
    const rows = await sql<{
      id: string;
      user_id: string | null;
      code_hash: string;
      attempts: number;
      expires_at: string;
      used_at: string | null;
    }>`
      select id, user_id, code_hash, attempts, expires_at, used_at
      from password_reset_otps
      where email_lc = ${email} and used_at is null
      order by created_at desc
      limit 1
    `;
    const row = rows[0];
    return row ? { ...row, request_id: row.id } : null;
  }
}

export const smtpHealth = createServerFn({ method: "POST" }).handler(async () => {
  const sec = await import("./security-log.server");
  await sec.sameSite().catch(() => undefined);
  const wait = takeToken(`smtp-health:${sec.requestIpHash()}`, 8, 60_000);
  if (wait) throw new Error(rateError(wait));
  const cfg = resolveSmtpConfig();
  if (!smtpConfigured(cfg)) {
    return smtpHealthSnapshot(cfg, false);
  }
  try {
    const { probeSmtpAuth } = await import("./mail");
    return await probeSmtpAuth();
  } catch {
    console.error("[nyx-mail] health probe unavailable");
    return smtpHealthSnapshot(cfg, false);
  }
});

async function executePasswordResetRequest(data: { email: string }, kind: "request" | "resend") {
  const sec = await import("./security-log.server");
  await sec.sameSite().catch(() => undefined);
  const ipWait = takeToken(`pw-reset-ip:${sec.requestIpHash()}`, RESET_IP_LIMIT, RESET_IP_WINDOW_MS);
  if (ipWait) throw new Error(rateError(ipWait));

  const cfg = resolveSmtpConfig();
  const sql = await sqlClient();
  await cleanupExpiredOtps(sql);

  const missing = smtpConfigIssue(cfg);
  if (missing) {
    passwordResetLog("PASSWORD_RESET_CONFIG_ERROR", {
      missing,
      host: cfg.host,
      port: cfg.port,
      provider: NYX_MAIL.provider,
    });
    console.error("[nyx-mail] SMTP configuration incomplete; refusing to pretend a reset email was sent.");
    await sec.writeSecurityEvent(sql, { kind: "pw_reset_unconfigured", detail: missing });
    throw new Error(`Password reset mail is missing ${missing} on this deployment.`);
  }

  const email = normalizeResetEmail(data.email);
  if (!looksLikeEmail(email)) {
    throw new Error("Enter a valid email address.");
  }

  const wait = takeToken(`pw-reset:${email}`, RESET_REQUEST_LIMIT, RESET_REQUEST_WINDOW_MS);
  if (wait) throw new Error(rateError(wait));

  const resendWait = takeToken(`pw-reset-resend:${email}`, 1, resetResendCooldownMs());
  if (resendWait) throw new Error(rateError(resendWait));

  const requestId = newId("pwr");
  passwordResetLog(kind === "resend" ? "PASSWORD_RESET_RESEND" : "PASSWORD_RESET_REQUESTED", {
    requestId,
    emailHash: hashForLog(email),
    host: cfg.host,
    port: cfg.port,
    provider: NYX_MAIL.provider,
  });

  const users = await sql.query<{ id: string; email: string | null }>(
    `select id, email from "user" where lower(email) = $1 limit 1`,
    [email],
  );
  const user = users[0];

  if (user?.id && user.email) {
    const code = generateResetCode();
    const id = newId("otp");
    const ttlSec = resetOtpTtlSec();
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
    try {
      await sql`
        update password_reset_otps
        set used_at = now()
        where email_lc = ${email} and used_at is null
      `;
      const { sendPasswordResetEmail } = await import("./mail");
      await sendPasswordResetEmail(user.email, code, { requestId, userId: user.id });
      try {
        await sql`
          insert into password_reset_otps (id, email_lc, user_id, code_hash, expires_at, request_id)
          values (${id}, ${email}, ${user.id}, ${hashResetCode(code)}, ${expiresAt}, ${requestId})
        `;
      } catch {
        await sql`
          insert into password_reset_otps (id, email_lc, user_id, code_hash, expires_at)
          values (${id}, ${email}, ${user.id}, ${hashResetCode(code)}, ${expiresAt})
        `;
      }
      await sec.writeSecurityEvent(sql, {
        userId: user.id,
        kind: "pw_reset_sent",
        detail: requestId,
      });
    } catch (err) {
      await sql`update password_reset_otps set used_at = now() where id = ${id}`.catch(() => undefined);
      await sec.writeSecurityEvent(sql, {
        userId: user.id,
        kind: "pw_reset_send_fail",
        detail: "smtp",
      });
      throw hideDeliveryError(err);
    }
  } else {
    await sec.writeSecurityEvent(sql, { kind: "pw_reset_unknown", detail: "otp" });
  }

  return {
    ok: true as const,
    expiresInSec: resetOtpTtlSec(),
    resendInSec: Math.round(resetResendCooldownMs() / 1000),
    from: nyxFromHeader(),
    message: GENERIC_REQUEST_OK,
  };
}

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((d: { email: string }) => d)
  .handler(async ({ data }) => executePasswordResetRequest(data, "request"));

export const resendPasswordReset = createServerFn({ method: "POST" })
  .validator((d: { email: string }) => d)
  .handler(async ({ data }) => executePasswordResetRequest(data, "resend"));

export const verifyPasswordResetOtp = createServerFn({ method: "POST" })
  .validator((d: { email: string; otp?: string; code?: string }) => d)
  .handler(async ({ data }) => {
    const sec = await import("./security-log.server");
    await sec.sameSite().catch(() => undefined);
    const ipWait = takeToken(`pw-verify-ip:${sec.requestIpHash()}`, RESET_IP_LIMIT, RESET_IP_WINDOW_MS);
    if (ipWait) throw new Error(rateError(ipWait));

    const email = normalizeResetEmail(data.email);
    const wait = takeToken(`pw-verify:${email}`, RESET_CONFIRM_LIMIT, RESET_CONFIRM_WINDOW_MS);
    if (wait) throw new Error(rateError(wait));
    const code = readOtp(data);
    if (!looksLikeEmail(email) || !isResetCodeShape(code)) {
      throw new Error("Enter the 6-digit code from the email.");
    }

    const sql = await sqlClient();
    const row = await loadActiveOtp(sql, email);
    if (!row || !row.user_id) {
      passwordResetLog("PASSWORD_RESET_OTP_FAILED", { emailHash: hashForLog(email), errorCategory: "unknown" });
      throw new Error("That code is not valid.");
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await sql`update password_reset_otps set used_at = now() where id = ${row.id}`;
      passwordResetLog("PASSWORD_RESET_OTP_FAILED", {
        requestId: row.request_id ?? row.id,
        userId: row.user_id,
        errorCategory: "unknown",
      });
      throw new Error("That code has expired. Request a new one.");
    }
    if (row.attempts >= RESET_MAX_ATTEMPTS) {
      await sql`update password_reset_otps set used_at = now() where id = ${row.id}`;
      passwordResetLog("PASSWORD_RESET_OTP_FAILED", {
        requestId: row.request_id ?? row.id,
        userId: row.user_id,
        errorCategory: "unknown",
      });
      throw new Error("Too many attempts. Request a new code.");
    }
    if (!resetCodesMatch(row.code_hash, code)) {
      await sql`update password_reset_otps set attempts = attempts + 1 where id = ${row.id}`;
      await sec.writeSecurityEvent(sql, {
        userId: row.user_id,
        kind: "pw_reset_bad_code",
        detail: "otp",
      });
      passwordResetLog("PASSWORD_RESET_OTP_FAILED", {
        requestId: row.request_id ?? row.id,
        userId: row.user_id,
        errorCategory: "unknown",
      });
      throw new Error("That code is not valid.");
    }

    try {
      await sql`update password_reset_otps set verified_at = now() where id = ${row.id}`;
    } catch {
      /* column added in 0025; verification still succeeds via the code itself */
    }
    passwordResetLog("PASSWORD_RESET_OTP_VERIFIED", {
      requestId: row.request_id ?? row.id,
      userId: row.user_id,
    });
    await sec.writeSecurityEvent(sql, {
      userId: row.user_id,
      kind: "pw_reset_verified",
      detail: "otp",
    });
    return { ok: true as const };
  });

export const confirmPasswordReset = createServerFn({ method: "POST" })
  .validator((d: { email: string; otp?: string; code?: string; password: string }) => d)
  .handler(async ({ data }) => {
    const sec = await import("./security-log.server");
    await sec.sameSite().catch(() => undefined);
    const ipWait = takeToken(`pw-confirm-ip:${sec.requestIpHash()}`, RESET_IP_LIMIT, RESET_IP_WINDOW_MS);
    if (ipWait) throw new Error(rateError(ipWait));

    const email = normalizeResetEmail(data.email);
    const wait = takeToken(`pw-confirm:${email}`, RESET_CONFIRM_LIMIT, RESET_CONFIRM_WINDOW_MS);
    if (wait) throw new Error(rateError(wait));
    const issue = passwordIssue(data.password, email);
    if (issue) throw new Error(issue);
    const code = readOtp(data);
    if (!isResetCodeShape(code)) throw new Error("Enter the 6-digit code from the email.");

    const sql = await sqlClient();
    await cleanupExpiredOtps(sql);
    const row = await loadActiveOtp(sql, email);
    if (!row || !row.user_id) {
      passwordResetLog("PASSWORD_RESET_OTP_FAILED", { emailHash: hashForLog(email), errorCategory: "unknown" });
      throw new Error("That code is not valid.");
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await sql`update password_reset_otps set used_at = now() where id = ${row.id}`;
      throw new Error("That code has expired. Request a new one.");
    }
    if (row.attempts >= RESET_MAX_ATTEMPTS) {
      await sql`update password_reset_otps set used_at = now() where id = ${row.id}`;
      throw new Error("Too many attempts. Request a new code.");
    }
    if (!resetCodesMatch(row.code_hash, code)) {
      await sql`update password_reset_otps set attempts = attempts + 1 where id = ${row.id}`;
      await sec.writeSecurityEvent(sql, {
        userId: row.user_id,
        kind: "pw_reset_bad_code",
        detail: "otp",
      });
      passwordResetLog("PASSWORD_RESET_OTP_FAILED", {
        requestId: row.request_id ?? row.id,
        userId: row.user_id,
        errorCategory: "unknown",
      });
      throw new Error("That code is not valid.");
    }

    const { auth } = await import("@/lib/auth/server");
    const ctx = await auth.$context;
    const hashed = await ctx.password.hash(data.password);
    await sql.query(
      `update account set password = $1 where "userId" = $2 and "providerId" = 'credential'`,
      [hashed, row.user_id],
    );
    await sql.query(`delete from session where "userId" = $1`, [row.user_id]);
    try {
      await sql.query(`delete from verification where identifier = $1`, [email]);
    } catch {
      /* optional better-auth table */
    }
    await sql`update password_reset_otps set used_at = now() where email_lc = ${email} and used_at is null`;
    passwordResetLog("PASSWORD_RESET_COMPLETED", {
      requestId: row.request_id ?? row.id,
      userId: row.user_id,
    });
    await sec.writeSecurityEvent(sql, {
      userId: row.user_id,
      kind: "pw_reset_ok",
      detail: "otp",
    });
    await sec.recordLoginEvent(sql, row.user_id, "revoke");
    return { ok: true as const };
  });
