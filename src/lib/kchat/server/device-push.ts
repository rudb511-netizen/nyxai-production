import { SignJWT, importPKCS8 } from "jose";
import type { Sql } from "@/lib/db";

/** Fire-and-forget native push. No-ops when FCM / APNs secrets are not configured. Never fakes delivery. */
export async function pushDeviceNotification(
  sql: Sql,
  opts: { userId: string; title: string; body: string; path?: string },
): Promise<void> {
  let rows = await sql<{ token: string; platform: string }>`
    select token, platform from device_push_tokens
    where user_id = ${opts.userId} and coalesce(status, 'active') = 'active'
  `.catch(() => null);
  if (!rows) {
    rows = await sql<{ token: string; platform: string }>`
      select token, platform from device_push_tokens where user_id = ${opts.userId}
    `.catch(() => []);
  }
  if (!rows.length) return;
  for (const row of rows) {
    try {
      if (row.platform === "android") await sendFcm(sql, row.token, opts);
      else if (row.platform === "ios") await sendApns(sql, row.token, opts);
    } catch {
      /* one bad device must not block the others */
    }
  }
}

type SaJson = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
  project_id?: string;
};

function serviceAccount(): SaJson | null {
  const raw =
    process.env.FCM_SERVICE_ACCOUNT_JSON?.trim() || process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim() || "";
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SaJson;
  } catch {
    return null;
  }
}

let fcmCache: { token: string; project: string; exp: number } | null = null;

async function fcmAccess(): Promise<{ token: string; project: string } | null> {
  const sa = serviceAccount();
  const project = process.env.FCM_PROJECT_ID?.trim() || sa?.project_id || "";
  if (!sa?.client_email || !sa.private_key || !project) return null;
  if (fcmCache && fcmCache.project === project && fcmCache.exp > Date.now() + 60_000) {
    return { token: fcmCache.token, project };
  }
  const key = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(sa.token_uri || "https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) return null;
  fcmCache = { token: j.access_token, project, exp: Date.now() + 50 * 60_000 };
  return { token: j.access_token, project };
}

function tokenDead(body: string): boolean {
  return /UNREGISTERED|NotRegistered|InvalidRegistration|BadDeviceToken/.test(body);
}

async function forgetToken(sql: Sql, token: string): Promise<void> {
  await sql`delete from device_push_tokens where token = ${token}`.catch(() => undefined);
}

async function sendFcm(
  sql: Sql,
  token: string,
  opts: { title: string; body: string; path?: string },
): Promise<void> {
  const v1 = await fcmAccess().catch(() => null);
  if (v1) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(v1.project)}/messages:send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${v1.token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        message: {
          token,
          notification: { title: opts.title, body: opts.body },
          data: { path: opts.path ?? "", title: opts.title, body: opts.body },
          android: {
            priority: "HIGH",
            notification: { channel_id: "nyx-default", sound: "default" },
          },
        },
      }),
    });
    if (res.ok) return;
    const text = await res.text().catch(() => "");
    if (tokenDead(text)) {
      await forgetToken(sql, token);
      return;
    }
    if (res.status !== 401 && res.status !== 403) return;
  }
  await sendFcmLegacy(sql, token, opts);
}

async function sendFcmLegacy(
  sql: Sql,
  token: string,
  opts: { title: string; body: string; path?: string },
): Promise<void> {
  const key = process.env.FCM_SERVER_KEY?.trim();
  if (!key) return;
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      Authorization: `key=${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      to: token,
      priority: "high",
      notification: { title: opts.title, body: opts.body, sound: "default", android_channel_id: "nyx-default" },
      data: { path: opts.path ?? "", title: opts.title, body: opts.body },
    }),
  });
  const text = await res.text().catch(() => "");
  if (tokenDead(text)) await forgetToken(sql, token);
}

async function sendApns(
  sql: Sql,
  token: string,
  opts: { title: string; body: string; path?: string },
): Promise<void> {
  const p8raw = process.env.APNS_P8?.trim();
  const kid = process.env.APNS_KEY_ID?.trim();
  const team = process.env.APNS_TEAM_ID?.trim();
  const topic = process.env.APNS_BUNDLE_ID?.trim() || "com.nyx.app";
  if (!p8raw || !kid || !team) return;
  const pem = p8raw.includes("BEGIN")
    ? p8raw
    : `-----BEGIN PRIVATE KEY-----\n${p8raw}\n-----END PRIVATE KEY-----`;
  const key = await importPKCS8(pem, "ES256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuer(team)
    .setIssuedAt()
    .sign(key);
  const host =
    process.env.APNS_SANDBOX === "1" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const res = await fetch(`${host}/3/device/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      aps: { alert: { title: opts.title, body: opts.body }, sound: "default" },
      path: opts.path ?? "",
    }),
  });
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  if (res.status === 410 || tokenDead(text) || /Unregistered/.test(text)) {
    await forgetToken(sql, token);
  }
}
