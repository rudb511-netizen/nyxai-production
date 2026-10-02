#!/usr/bin/env node
/**
 * Backend-only SMTP health check.
 * Prints host/port/configured/authenticated. Never prints SMTP_PASS.
 */
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";

function loadDotEnv() {
  try {
    const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      if (!key || process.env[key]) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    /* .env is optional */
  }
}

function passForAuth(pass) {
  const compact = pass.replace(/\s+/g, "");
  return /^[A-Za-z0-9]{16}$/.test(compact) ? compact : pass;
}

loadDotEnv();

const host = (process.env.SMTP_HOST ?? "smtp.gmail.com").trim();
let port = Number(process.env.SMTP_PORT ?? 587) || 587;
const secureEnv = (process.env.SMTP_SECURE ?? "false").trim().toLowerCase();
let secure = secureEnv === "true" || secureEnv === "1";
if (host.toLowerCase() === "smtp.gmail.com") {
  if (port === 465) port = 587;
  if (port === 587) secure = false;
}
const requireTLS = !secure && port === 587;
const user = (process.env.SMTP_USER ?? "nyx.officialsupport@gmail.com").trim();
const pass = passForAuth((process.env.SMTP_PASS ?? "").trim());
const placeholder = !pass || pass.toLowerCase() === "your_existing_smtp_password";
const emailConfigured = Boolean(host && user && !placeholder);

const snapshot = {
  emailConfigured,
  smtpHost: host,
  smtpPort: port,
  smtpAuthenticated: false,
};

if (!emailConfigured) {
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
  process.exit(0);
}

const transport = nodemailer.createTransport({
  host,
  port,
  secure,
  requireTLS,
  auth: { user, pass },
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 20_000,
  tls: { minVersion: "TLSv1.2", servername: host },
});

try {
  await transport.verify();
  snapshot.smtpAuthenticated = true;
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
} catch (err) {
  const raw = err instanceof Error ? err.message : String(err);
  const safe = raw.replace(/pass(word)?[=:]\s*\S+/gi, "pass=***").replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted]").slice(0, 180);
  console.error("[nyx-mail] verify failed:", safe);
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
  process.exitCode = 1;
}
