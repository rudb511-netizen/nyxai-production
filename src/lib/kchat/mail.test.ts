import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NYX_MAIL,
  GENERIC_REQUEST_OK,
  GENERIC_SEND_ERROR,
  buildResetEmail,
  classifySmtpError,
  generateResetCode,
  hashForLog,
  hashResetCode,
  isResetCodeShape,
  looksLikeEmail,
  normalizeResetEmail,
  nyxFromHeader,
  parseSmtpSecure,
  passwordResetLog,
  resetCodesMatch,
  resetOtpTtlSec,
  resetResendCooldownMs,
  sanitizeMailLog,
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
} from "./mail.ts";

describe("smtp config", () => {
  it("defaults to Gmail 587 STARTTLS and NYX Support", () => {
    const cfg = smtpConfigFromEnv({ SMTP_PASS: "app-password-from-deploy" });
    assert.equal(cfg.host, "smtp.gmail.com");
    assert.equal(cfg.port, 587);
    assert.equal(cfg.secure, false);
    assert.equal(cfg.requireTLS, true);
    assert.equal(cfg.user, "nyx.officialsupport@gmail.com");
    assert.equal(cfg.from, `"NYX Support" <nyx.officialsupport@gmail.com>`);
    assert.equal(smtpConfigured(cfg), true);
    assert.equal(smtpConfigIssue(cfg), null);
  });

  it("uses STARTTLS on 587 when secure is false", () => {
    const cfg = smtpConfigFromEnv({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_USER: "nyx.officialsupport@gmail.com",
      SMTP_PASS: "app-password-from-deploy",
    });
    assert.equal(cfg.port, 587);
    assert.equal(cfg.secure, false);
    assert.equal(cfg.requireTLS, true);
  });

  it("keeps SMTP_PASS exactly as provided and never copies it into health", () => {
    const pass = "keep-this-existing-secret-value";
    const cfg = smtpConfigFromEnv({ SMTP_PASS: pass });
    assert.equal(cfg.pass, pass);
    const health = smtpHealthSnapshot(cfg, true);
    assert.deepEqual(Object.keys(health).sort(), [
      "emailConfigured",
      "smtpAuthenticated",
      "smtpHost",
      "smtpPort",
    ]);
    assert.equal(JSON.stringify(health).includes(pass), false);
    assert.equal(health.emailConfigured, true);
    assert.equal(health.smtpHost, "smtp.gmail.com");
    assert.equal(health.smtpPort, 587);
    assert.equal(health.smtpAuthenticated, true);
  });

  it("treats missing or placeholder passwords as unconfigured", () => {
    assert.equal(smtpPasswordPresent(""), false);
    assert.equal(smtpPasswordPresent("YOUR_EXISTING_SMTP_PASSWORD"), false);
    assert.equal(smtpConfigured(smtpConfigFromEnv({})), false);
    assert.equal(smtpConfigIssue(smtpConfigFromEnv({})), "SMTP_PASS");
    const health = smtpHealthSnapshot(smtpConfigFromEnv({}), false);
    assert.equal(health.emailConfigured, false);
    assert.equal(health.smtpAuthenticated, false);
  });

  it("normalizes spaced 16-character Gmail app passwords for SMTP auth", () => {
    const grouped = "abcd efgh ijkl mnop";
    assert.equal(smtpPassForAuth(grouped), "abcdefghijklmnop");
    const cfg = smtpConfigFromEnv({ SMTP_PASS: grouped });
    assert.equal(cfg.pass, "abcdefghijklmnop");
    assert.equal(smtpConfigured(cfg), true);
    assert.equal(JSON.stringify(smtpHealthSnapshot(cfg, true)).includes(grouped), false);
  });

  it("remaps leftover Gmail port 465 to 587 STARTTLS", () => {
    const cfg = smtpConfigFromEnv({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_PASS: "app-password-from-deploy",
    });
    assert.equal(cfg.port, 587);
    assert.equal(cfg.secure, false);
    assert.equal(cfg.requireTLS, true);
    assert.equal(parseSmtpSecure(undefined, 587), false);
    assert.equal(parseSmtpSecure(undefined, 465), true);
  });
});

describe("reset codes", () => {
  it("hashes with sha256 and compares in constant time", () => {
    const code = "482913";
    const hash = hashResetCode(code);
    assert.equal(hash.length, 64);
    assert.equal(resetCodesMatch(hash, code), true);
    assert.equal(resetCodesMatch(hash, "000000"), false);
    assert.equal(resetCodesMatch(hash, "48291"), false);
  });

  it("generates a 6-digit code including leading zeros", () => {
    for (let i = 0; i < 40; i++) {
      const code = generateResetCode();
      assert.equal(isResetCodeShape(code), true);
      assert.match(code, /^\d{6}$/);
    }
  });
});

describe("reset email", () => {
  it("uses the required subject, sender, and body copy", () => {
    const mail = buildResetEmail({
      to: "member@example.com",
      code: "123456",
      from: nyxFromHeader(),
    });
    assert.equal(mail.subject, "Your NYX Password Reset Code");
    assert.equal(mail.from, `"NYX Support" <nyx.officialsupport@gmail.com>`);
    assert.match(mail.text, /We received a request to reset your NYX password/);
    assert.match(mail.text, /Your password reset code is:/);
    assert.match(mail.text, /123456/);
    assert.match(mail.text, /This code expires in 10 minutes/);
    assert.match(mail.text, /If you did not request a password reset/);
    assert.match(mail.text, /never share this code/);
    assert.match(mail.text, /NYX Support/);
    assert.match(mail.html, /123456/);
    assert.match(mail.html, /c8f04d/);
    assert.equal(mail.to, "member@example.com");
  });

  it("does not put internal errors in the email", () => {
    const mail = buildResetEmail({
      to: "a@b.co",
      code: "999111",
      from: nyxFromHeader(),
    });
    assert.doesNotMatch(mail.text, /SMTP|stack|EAUTH|nodemailer/i);
    assert.doesNotMatch(mail.html, /SMTP|stack|EAUTH|nodemailer/i);
  });
});

describe("public copy and logs", () => {
  it("does not reveal whether an account exists", () => {
    assert.match(GENERIC_REQUEST_OK, /If an account exists/);
    assert.doesNotMatch(GENERIC_SEND_ERROR, /not configured/i);
    assert.doesNotMatch(GENERIC_SEND_ERROR, /SMTP/i);
    assert.match(GENERIC_SEND_ERROR, /couldn't send your password reset code/i);
  });

  it("redacts credentials from mail logs", () => {
    const log = sanitizeMailLog(
      new Error("Invalid login: pass=super-secret-app-pw user=nyx.officialsupport@gmail.com token=abcd"),
    );
    assert.doesNotMatch(log, /super-secret-app-pw/);
    assert.doesNotMatch(log, /nyx\.officialsupport@gmail\.com/);
    assert.match(log, /pass=\*\*\*/);
  });

  it("normalizes emails without leaking", () => {
    assert.equal(normalizeResetEmail("  Reed@NYX.app "), "reed@nyx.app");
    assert.equal(looksLikeEmail("not-an-email"), false);
    assert.equal(looksLikeEmail("reed@nyx.app"), true);
  });

  it("drops secrets from structured password-reset logs", () => {
    const lines: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      passwordResetLog("PASSWORD_RESET_EMAIL_FAILED", {
        requestId: "pwr_test",
        host: "smtp.gmail.com",
        port: 587,
        provider: "gmail",
        errorCode: "EAUTH",
        otp: "123456",
        pass: "should-not-appear",
      } as Record<string, string | number>);
    } finally {
      console.info = original;
    }
    assert.match(lines[0] ?? "", /PASSWORD_RESET_EMAIL_FAILED/);
    assert.doesNotMatch(lines[0] ?? "", /123456/);
    assert.doesNotMatch(lines[0] ?? "", /should-not-appear/);
    assert.match(lines[0] ?? "", /errorCode=EAUTH/);
  });
});

describe("NYX mail identity", () => {
  it("pins Gmail SMTP production values", () => {
    assert.equal(NYX_MAIL.host, "smtp.gmail.com");
    assert.equal(NYX_MAIL.port, 587);
    assert.equal(NYX_MAIL.secure, false);
    assert.equal(NYX_MAIL.user, "nyx.officialsupport@gmail.com");
    assert.equal(NYX_MAIL.fromAddress, "nyx.officialsupport@gmail.com");
  });
});

describe("otp expiry and smtp errors", () => {
  it("reads expiry and resend cooldown from env with safe bounds", () => {
    assert.equal(resetOtpTtlSec({}), 600);
    assert.equal(resetOtpTtlSec({ PASSWORD_RESET_OTP_EXPIRY_MINUTES: "10" }), 600);
    assert.equal(resetOtpTtlSec({ PASSWORD_RESET_OTP_EXPIRY_MINUTES: "1" }), 60);
    assert.equal(resetOtpTtlSec({ PASSWORD_RESET_OTP_EXPIRY_MINUTES: "999" }), 3600);
    assert.equal(resetResendCooldownMs({}), 60_000);
    assert.equal(resetResendCooldownMs({ PASSWORD_RESET_RESEND_COOLDOWN_SECONDS: "45" }), 45_000);
  });

  it("classifies auth failures as permanent and network timeouts as retryable", () => {
    const auth = Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });
    const timeout = Object.assign(new Error("connection timeout"), { code: "ETIMEDOUT" });
    assert.equal(classifySmtpError(auth), "auth");
    assert.equal(smtpErrorCode(auth), "535");
    assert.equal(smtpRetryDecision(auth, 1), "fail");
    assert.equal(classifySmtpError(timeout), "timeout");
    assert.equal(smtpRetryDecision(timeout, 1), "retry");
    assert.equal(smtpRetryDecision(timeout, 3), "fail");
    assert.equal(smtpRetryDelayMs(0), 200);
    assert.equal(smtpRetryDelayMs(2), 800);
  });

  it("surfaces the exact Gmail failure instead of a generic send error", () => {
    const auth = Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), {
      code: "EAUTH",
      responseCode: 535,
      response: "535-5.7.8 Username and Password not accepted",
    });
    const authMsg = smtpPublicError(auth);
    assert.match(authMsg, /Gmail rejected the NYX Support mailbox login/);
    assert.match(authMsg, /535/);
    assert.doesNotMatch(authMsg, /couldn't send your password reset code right now/i);
    const net = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNECTION" });
    assert.match(smtpPublicError(net), /Couldn't reach Gmail on port 587 with STARTTLS/);
    assert.match(smtpPublicError(net), /ECONNECTION/);
  });

  it("hashes log identifiers without exposing the email", () => {
    const digest = hashForLog("Reed@NYX.app");
    assert.equal(digest, hashForLog("reed@nyx.app"));
    assert.equal(digest.includes("@"), false);
    assert.equal(digest.length, 12);
  });
});
