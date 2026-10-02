import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/** Public NYX Gmail identity. The app password lives only in SMTP_PASS. */
export const NYX_MAIL = {
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "nyx.officialsupport@gmail.com",
  fromName: "NYX Support",
  fromAddress: "nyx.officialsupport@gmail.com",
  subject: "Your NYX Password Reset Code",
  provider: "gmail",
} as const;

export const RESET_OTP_TTL_SEC = 600;
export const RESET_OTP_DIGITS = 6;
export const RESET_MAX_ATTEMPTS = 5;
export const RESET_REQUEST_LIMIT = 3;
export const RESET_REQUEST_WINDOW_MS = 15 * 60_000;
export const RESET_CONFIRM_LIMIT = 8;
export const RESET_CONFIRM_WINDOW_MS = 15 * 60_000;
export const RESET_IP_LIMIT = 10;
export const RESET_IP_WINDOW_MS = 15 * 60_000;
export const RESET_RESEND_COOLDOWN_SEC = 60;
export const RESET_SMTP_MAX_ATTEMPTS = 3;

export const GENERIC_SEND_ERROR =
  "We couldn't send your password reset code right now. Please try again later.";

export const GENERIC_REQUEST_OK =
  "If an account exists for this email address, we'll send a password reset code.";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user: string;
  pass: string;
  from: string;
};

export type SmtpHealth = {
  emailConfigured: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpAuthenticated: boolean | null;
};

export type SmtpErrorCategory =
  | "config"
  | "auth"
  | "timeout"
  | "network"
  | "rejected"
  | "unknown";

export type PasswordResetLogEvent =
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_EMAIL_SENT"
  | "PASSWORD_RESET_EMAIL_FAILED"
  | "PASSWORD_RESET_CONFIG_ERROR"
  | "PASSWORD_RESET_OTP_VERIFIED"
  | "PASSWORD_RESET_OTP_FAILED"
  | "PASSWORD_RESET_COMPLETED"
  | "PASSWORD_RESET_RESEND";

const PLACEHOLDER_PASS = new Set([
  "",
  "your_existing_smtp_password",
  "changeme",
  "change-me",
  "todo",
  "secret",
  "password",
]);

const LOG_ALLOW = new Set([
  "requestId",
  "userId",
  "emailHash",
  "host",
  "port",
  "provider",
  "errorCode",
  "errorCategory",
  "attempt",
  "smtpHost",
  "smtpPort",
  "authenticated",
  "missing",
  "expiresInSec",
]);

export function parseSmtpSecure(raw: string | undefined, port: number): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return port === 465;
}

export function nyxFromHeader(user: string = NYX_MAIL.fromAddress): string {
  const addr = (user || NYX_MAIL.fromAddress).trim() || NYX_MAIL.fromAddress;
  return `"${NYX_MAIL.fromName}" <${addr}>`;
}

export function smtpConfigFromEnv(env: Record<string, string | undefined> = process.env): SmtpConfig {
  const host = (env.SMTP_HOST ?? "").trim() || NYX_MAIL.host;
  const gmail = host.toLowerCase() === NYX_MAIL.host;
  const portRaw = Number(env.SMTP_PORT ?? NYX_MAIL.port);
  let port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : NYX_MAIL.port;
  let secure = parseSmtpSecure(env.SMTP_SECURE, port);
  // Cloud hosts often block implicit TLS on 465. Gmail password-reset mail
  // always uses STARTTLS on 587 — even if a leftover SMTP_PORT=465 is set.
  if (gmail) {
    if (port === 465) port = 587;
    if (port === 587) secure = false;
  }
  const user = (env.SMTP_USER ?? "").trim() || NYX_MAIL.user;
  const pass = smtpPassForAuth((env.SMTP_PASS ?? "").trim());
  const fromEnv = (env.MAIL_FROM ?? "").trim();
  const from =
    fromEnv && fromEnv.toLowerCase().includes(NYX_MAIL.fromAddress)
      ? fromEnv.includes("<")
        ? fromEnv
        : nyxFromHeader(NYX_MAIL.fromAddress)
      : nyxFromHeader(user);
  return {
    host,
    port,
    secure,
    requireTLS: !secure && port === 587,
    user,
    pass,
    from,
  };
}

export function smtpPassForAuth(pass: string): string {
  const compact = pass.replace(/\s+/g, "");
  if (/^[A-Za-z0-9]{16}$/.test(compact)) return compact;
  return pass;
}

export function smtpPasswordPresent(pass: string): boolean {
  return Boolean(pass) && !PLACEHOLDER_PASS.has(pass.toLowerCase());
}

export function smtpConfigured(cfg: SmtpConfig = smtpConfigFromEnv()): boolean {
  return Boolean(cfg.host && cfg.user && smtpPasswordPresent(cfg.pass));
}

export function smtpConfigIssue(
  cfg: SmtpConfig = smtpConfigFromEnv(),
): "SMTP_HOST" | "SMTP_USER" | "SMTP_PASS" | null {
  if (!cfg.host) return "SMTP_HOST";
  if (!cfg.user) return "SMTP_USER";
  if (!smtpPasswordPresent(cfg.pass)) return "SMTP_PASS";
  return null;
}

/** Operator snapshot — never includes the password or auth tokens. */
export function smtpHealthSnapshot(
  cfg: SmtpConfig = smtpConfigFromEnv(),
  authenticated: boolean | null = null,
): SmtpHealth {
  return {
    emailConfigured: smtpConfigured(cfg),
    smtpHost: cfg.host,
    smtpPort: cfg.port,
    smtpAuthenticated: authenticated,
  };
}

export function resetOtpTtlSec(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.PASSWORD_RESET_OTP_EXPIRY_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return RESET_OTP_TTL_SEC;
  return Math.round(Math.min(60, Math.max(1, raw))) * 60;
}

export function resetResendCooldownMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return RESET_RESEND_COOLDOWN_SEC * 1000;
  return Math.round(Math.min(600, Math.max(15, raw))) * 1000;
}

export function hashResetCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function hashForLog(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 12);
}

export function resetCodesMatch(storedHash: string, code: string): boolean {
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(hashResetCode(code.replace(/\s/g, "")), "hex");
  if (a.length !== 32 || b.length !== 32 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function generateResetCode(): string {
  return String(randomInt(0, 10 ** RESET_OTP_DIGITS)).padStart(RESET_OTP_DIGITS, "0");
}

export function isResetCodeShape(code: string): boolean {
  return new RegExp(`^\\d{${RESET_OTP_DIGITS}}$`).test(code.replace(/\s/g, ""));
}

export function normalizeResetEmail(email: string): string {
  return email.trim().toLowerCase().slice(0, 120);
}

export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function ttlCopy(ttlSec = RESET_OTP_TTL_SEC): string {
  const minutes = Math.max(1, Math.round(ttlSec / 60));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function buildResetEmail(opts: {
  to: string;
  code: string;
  from: string;
  ttlSec?: number;
}): { from: string; to: string; subject: string; text: string; html: string } {
  const ttl = ttlCopy(opts.ttlSec ?? RESET_OTP_TTL_SEC);
  const text = [
    "Hello,",
    "",
    "We received a request to reset your NYX password.",
    "",
    "Your password reset code is:",
    "",
    opts.code,
    "",
    `This code expires in ${ttl}.`,
    "",
    "For your security, never share this code with anyone.",
    "",
    "If you did not request a password reset, you can safely ignore this email.",
    "",
    "NYX Support",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${NYX_MAIL.subject}</title>
</head>
<body style="margin:0;padding:0;background:#07090f;color:#f2f5f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07090f;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#10141c;border:1px solid rgba(200,240,77,.18);border-radius:24px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px;font-family:Outfit,Inter,system-ui,sans-serif;">
              <p style="margin:0;letter-spacing:.34em;font-size:13px;font-weight:700;color:#c8f04d;">NYX</p>
              <h1 style="margin:16px 0 0;font-size:22px;line-height:1.25;color:#f2f5f8;">Password reset code</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 0;font-family:Outfit,Inter,system-ui,sans-serif;font-size:15px;line-height:1.6;color:#c5ccd6;">
              <p style="margin:0;">Hello,</p>
              <p style="margin:12px 0 0;">We received a request to reset your NYX password.</p>
              <p style="margin:12px 0 0;">Your password reset code is:</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 28px;">
              <div style="display:inline-block;padding:14px 22px;border-radius:16px;background:#181e28;border:1px solid rgba(200,240,77,.28);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;letter-spacing:.28em;color:#c8f04d;font-weight:700;">
                ${opts.code}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;font-family:Outfit,Inter,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#9aa3b2;">
              <p style="margin:0;">This code expires in ${ttl}.</p>
              <p style="margin:12px 0 0;">For your security, never share this code with anyone.</p>
              <p style="margin:12px 0 0;">If you did not request a password reset, you can safely ignore this email.</p>
              <p style="margin:20px 0 0;color:#c8f04d;letter-spacing:.08em;font-size:12px;font-weight:600;">NYX Support</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    from: opts.from,
    to: opts.to,
    subject: NYX_MAIL.subject,
    text,
    html,
  };
}

export function sanitizeMailLog(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  return raw
    .replace(/pass(word)?[=:]\s*\S+/gi, "pass=***")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted]")
    .replace(/[A-Za-z0-9+/=]{24,}/g, "[redacted]")
    .slice(0, 300);
}

export function smtpErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const rec = err as { code?: unknown; responseCode?: unknown };
    if (typeof rec.responseCode === "number") return String(rec.responseCode);
    if (typeof rec.code === "string" && rec.code) return rec.code;
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = msg.match(/\b(EAUTH|ECONNECTION|ETIMEDOUT|ESOCKET|ETLS|EENVELOPE|EPROTOCOL|EDNS)\b/i);
  return m?.[1]?.toUpperCase() ?? "UNKNOWN";
}

export function classifySmtpError(err: unknown): SmtpErrorCategory {
  const code = smtpErrorCode(err);
  const msg = `${code} ${err instanceof Error ? err.message : String(err ?? "")}`;
  if (/missing|not configured|SMTP_PASS|SMTP_HOST|SMTP_USER/i.test(msg) && /config/i.test(msg)) {
    return "config";
  }
  if (/EAUTH|535|534|invalid login|authentication/i.test(msg)) return "auth";
  if (/ETIMEDOUT|greeting timeout|connection timeout|timeout/i.test(msg)) return "timeout";
  if (/EENVELOPE|550|551|552|553|554|recipient/i.test(msg)) return "rejected";
  if (/ECONNECTION|ESOCKET|ETLS|ECONN|ENOTFOUND|EAI_AGAIN|421|450|451|452/i.test(msg)) return "network";
  return "unknown";
}

export function isTransientSmtpError(err: unknown): boolean {
  const category = classifySmtpError(err);
  return category === "timeout" || category === "network";
}

export function isPermanentSmtpAuthError(err: unknown): boolean {
  return classifySmtpError(err) === "auth";
}

export function smtpRetryDecision(
  err: unknown,
  attempt: number,
  maxAttempts = RESET_SMTP_MAX_ATTEMPTS,
): "retry" | "fail" {
  if (attempt >= maxAttempts) return "fail";
  if (isPermanentSmtpAuthError(err)) return "fail";
  if (isTransientSmtpError(err)) return "retry";
  return "fail";
}

export function smtpRetryDelayMs(attempt: number): number {
  return 200 * 2 ** Math.max(0, attempt);
}

export function smtpResponseSnippet(err: unknown): string {
  if (err && typeof err === "object") {
    const rec = err as { response?: unknown; command?: unknown; message?: unknown };
    const command = typeof rec.command === "string" ? rec.command : "";
    const response = typeof rec.response === "string" ? rec.response : "";
    const message = typeof rec.message === "string" ? rec.message : err instanceof Error ? err.message : "";
    return sanitizeMailLog([command, response || message].filter(Boolean).join(" — "));
  }
  return sanitizeMailLog(err);
}

export function smtpPublicError(err: unknown): string {
  const category = classifySmtpError(err);
  const code = smtpErrorCode(err);
  const detail = smtpResponseSnippet(err);
  if (category === "auth") {
    return `Gmail rejected the NYX Support mailbox login (${code}). ${detail || "The app password on this deployment may be wrong or revoked."}`;
  }
  if (category === "timeout" || category === "network") {
    return `Couldn't reach Gmail on port 587 with STARTTLS (${code}). ${detail}`;
  }
  if (category === "rejected") {
    return `Gmail rejected the password-reset message (${code}). ${detail}`;
  }
  if (category === "config") {
    return `Password reset mail is missing ${smtpConfigIssue() ?? "SMTP_PASS"} on this deployment.`;
  }
  if (detail && code !== "UNKNOWN") return `Couldn't send the password reset code (${code}). ${detail}`;
  return GENERIC_SEND_ERROR;
}

export function logSmtpFailure(phase: string, err: unknown): void {
  const cfg = smtpConfigFromEnv();
  console.error(
    `[nyx-mail] ${phase} failed host=${cfg.host} port=${cfg.port} secure=${cfg.secure} requireTLS=${cfg.requireTLS} user=${cfg.user} code=${smtpErrorCode(err)} category=${classifySmtpError(err)} detail=${smtpResponseSnippet(err)}`,
  );
}

export function passwordResetLog(
  event: PasswordResetLogEvent,
  fields: Record<string, string | number | boolean | undefined> = {},
): void {
  const parts = Object.entries(fields)
    .filter(([key, value]) => LOG_ALLOW.has(key) && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`);
  console.info(`[PasswordReset] ${event}${parts.length ? ` ${parts.join(" ")}` : ""}`);
}
