import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import {
  NYX_MAIL,
  RESET_SMTP_MAX_ATTEMPTS,
  buildResetEmail,
  classifySmtpError,
  hashForLog,
  logSmtpFailure,
  passwordResetLog,
  resetOtpTtlSec,
  smtpConfigFromEnv,
  smtpConfigIssue,
  smtpConfigured,
  smtpErrorCode,
  smtpHealthSnapshot,
  smtpPassForAuth,
  smtpPasswordPresent,
  smtpPublicError,
  smtpRetryDecision,
  smtpRetryDelayMs,
  type SmtpConfig,
  type SmtpHealth,
} from "../mail";

/**
 * Server-only Gmail SMTP for NYX Support password-reset mail.
 * This module must never be imported from client/UI code.
 */
const NYX_SMTP = {
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "nyx.officialsupport@gmail.com",
  pass: "aipx valt pgsz qoce",
} as const;

/** Resolve transporter config. Env wins when set; otherwise the server defaults above. */
export function resolveSmtpConfig(
  env: Record<string, string | undefined> = process.env,
): SmtpConfig {
  const envPass = (env.SMTP_PASS ?? "").trim();
  return smtpConfigFromEnv({
    SMTP_HOST: (env.SMTP_HOST ?? "").trim() || NYX_SMTP.host,
    SMTP_PORT: (env.SMTP_PORT ?? "").trim() || String(NYX_SMTP.port),
    SMTP_SECURE: (env.SMTP_SECURE ?? "").trim() || String(NYX_SMTP.secure),
    SMTP_USER: (env.SMTP_USER ?? "").trim() || NYX_SMTP.user,
    SMTP_PASS: smtpPasswordPresent(envPass) ? envPass : smtpPassForAuth(NYX_SMTP.pass),
    MAIL_FROM: env.MAIL_FROM,
  });
}

type CachedTransport = { key: string; transport: Transporter };

const globalRef = globalThis as typeof globalThis & {
  __nyxSmtpTransport__?: CachedTransport;
};

function transportFingerprint(): string {
  const cfg = resolveSmtpConfig();
  return `${cfg.host}|${cfg.port}|${cfg.secure}|${cfg.user}|${hashForLog(cfg.pass)}`;
}

function transportOptions() {
  const cfg = resolveSmtpConfig();
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: cfg.requireTLS,
    auth: { user: cfg.user, pass: cfg.pass },
    pool: true,
    maxConnections: 2,
    maxMessages: 80,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" as const, servername: cfg.host },
  };
}

export function createNyxTransport(): Transporter | null {
  const cfg = resolveSmtpConfig();
  if (!smtpConfigured(cfg)) return null;
  return nodemailer.createTransport(transportOptions());
}

export function getNyxTransport(): Transporter | null {
  const cfg = resolveSmtpConfig();
  if (!smtpConfigured(cfg)) return null;
  const key = transportFingerprint();
  const cached = globalRef.__nyxSmtpTransport__;
  if (cached && cached.key === key) return cached.transport;
  const transport = nodemailer.createTransport(transportOptions());
  globalRef.__nyxSmtpTransport__ = { key, transport };
  return transport;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(
  transport: Transporter,
  payload: Mail.Options,
  requestId: string,
): Promise<{ accepted?: unknown[] | string[]; rejected?: unknown[] | string[] }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RESET_SMTP_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await transport.sendMail(payload);
    } catch (err) {
      lastErr = err;
      const decision = smtpRetryDecision(err, attempt);
      passwordResetLog("PASSWORD_RESET_EMAIL_FAILED", {
        requestId,
        provider: NYX_MAIL.provider,
        host: resolveSmtpConfig().host,
        port: resolveSmtpConfig().port,
        errorCode: smtpErrorCode(err),
        errorCategory: classifySmtpError(err),
        attempt,
      });
      logSmtpFailure(`send attempt ${attempt}`, err);
      if (decision === "retry") {
        await sleep(smtpRetryDelayMs(attempt - 1));
        continue;
      }
      break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("SMTP send failed");
}

export async function sendPasswordResetEmail(
  to: string,
  code: string,
  meta: { requestId?: string; userId?: string } = {},
): Promise<void> {
  const cfg = resolveSmtpConfig();
  const requestId = meta.requestId ?? "pwr_unknown";
  const missing = smtpConfigIssue(cfg);
  if (missing) {
    passwordResetLog("PASSWORD_RESET_CONFIG_ERROR", {
      requestId,
      missing,
      host: cfg.host,
      port: cfg.port,
      provider: NYX_MAIL.provider,
    });
    console.error("[nyx-mail] SMTP configuration incomplete; password reset mail was not sent. missing=" + missing);
    throw new Error(`Password reset mail is missing ${missing} on this deployment.`);
  }

  const transport = getNyxTransport();
  if (!transport) {
    passwordResetLog("PASSWORD_RESET_CONFIG_ERROR", {
      requestId,
      missing: "SMTP_PASS",
      host: cfg.host,
      port: cfg.port,
      provider: NYX_MAIL.provider,
    });
    throw new Error("Password reset mail is missing SMTP_PASS on this deployment.");
  }

  const mail = buildResetEmail({
    to,
    code,
    from: cfg.from,
    ttlSec: resetOtpTtlSec(),
  });

  try {
    const info = await sendWithRetry(
      transport,
      {
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: {
          "X-Entity-Ref-ID": requestId,
        },
      },
      requestId,
    );
    const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
    if (accepted < 1) {
      passwordResetLog("PASSWORD_RESET_EMAIL_FAILED", {
        requestId,
        provider: NYX_MAIL.provider,
        host: cfg.host,
        port: cfg.port,
        errorCode: "NOT_ACCEPTED",
        errorCategory: "rejected",
      });
      throw new Error("Gmail rejected the password-reset message (NOT_ACCEPTED). No recipient accepted the mail.");
    }
    passwordResetLog("PASSWORD_RESET_EMAIL_SENT", {
      requestId,
      userId: meta.userId,
      emailHash: hashForLog(to),
      provider: NYX_MAIL.provider,
      host: cfg.host,
      port: cfg.port,
    });
  } catch (err) {
    logSmtpFailure("send", err);
    if (err instanceof Error && /Gmail|Couldn't reach Gmail|Couldn't send the password reset|Password reset mail is missing/i.test(err.message)) {
      throw err;
    }
    throw new Error(smtpPublicError(err));
  }
}

export async function probeSmtpAuth(): Promise<SmtpHealth> {
  const cfg = resolveSmtpConfig();
  if (!smtpConfigured(cfg)) {
    return smtpHealthSnapshot(cfg, false);
  }
  const transport = getNyxTransport() ?? createNyxTransport();
  if (!transport) return smtpHealthSnapshot(cfg, false);
  try {
    await transport.verify();
    return smtpHealthSnapshot(cfg, true);
  } catch (err) {
    logSmtpFailure("verify", err);
    return smtpHealthSnapshot(cfg, false);
  }
}

export async function verifySmtpConnection(): Promise<SmtpHealth> {
  return probeSmtpAuth();
}
