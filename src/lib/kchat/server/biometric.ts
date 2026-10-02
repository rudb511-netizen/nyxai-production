import { createHash, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { ensureProfile, notify, sqlClient } from "./helpers";
import { takeToken, rateError } from "../rate-limit";

const challenges = new Map<string, { challenge: string; at: number }>();

function cleanChallenges() {
  const now = Date.now();
  for (const [k, v] of challenges) {
    if (now - v.at > 5 * 60_000) challenges.delete(k);
  }
}

function b64url(buf: Buffer | Uint8Array | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : Buffer.from(buf);
  return b.toString("base64url");
}

function originOf(): string {
  return (process.env.APP_ORIGIN ?? "").replace(/\/$/, "") || "http://127.0.0.1:8080";
}

export const biometricChallenge = createServerFn({ method: "POST" })
  .validator((d: { purpose: "register" | "assert" }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    cleanChallenges();
    const challenge = b64url(randomBytes(32));
    challenges.set(`${context.userId}:${data.purpose}`, { challenge, at: Date.now() });
    const sql = await sqlClient();
    const p = await ensureProfile(sql, { id: context.userId });
    const creds = await sql<{ credential_id: string }>`
      select credential_id from biometric_credentials where user_id = ${context.userId}
    `.catch(() => []);
    return {
      challenge,
      rpId: new URL(originOf()).hostname,
      rpName: "NYX",
      userId: b64url(context.userId),
      userName: p.username,
      displayName: p.display_name,
      allowCredentials: creds.map((c) => c.credential_id),
    };
  });

export const registerBiometric = createServerFn({ method: "POST" })
  .validator(
    (d: { credentialId: string; publicKey: string; clientDataJSON: string }) => d,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const wait = takeToken(`bio-reg:${context.userId}`, 6, 60_000);
    if (wait) throw new Error(rateError(wait));
    const expected = challenges.get(`${context.userId}:register`);
    if (!expected) throw new Error("Start biometric setup again.");
    challenges.delete(`${context.userId}:register`);
    let parsed: { type?: string; challenge?: string; origin?: string };
    try {
      parsed = JSON.parse(Buffer.from(data.clientDataJSON, "base64url").toString("utf8")) as typeof parsed;
    } catch {
      throw new Error("Could not read the authenticator response.");
    }
    if (parsed.type !== "webauthn.create") throw new Error("Unexpected authenticator response.");
    if (parsed.challenge !== expected.challenge) throw new Error("That security challenge expired.");
    const sql = await sqlClient();
    await sql`
      insert into biometric_credentials (id, user_id, credential_id, public_key)
      values (${newId("bio")}, ${context.userId}, ${data.credentialId}, ${data.publicKey})
      on conflict (credential_id) do update set public_key = excluded.public_key
    `;
    await sql`update profiles set biometric_enabled = true where user_id = ${context.userId}`;
    await notify(sql, {
      userId: context.userId,
      kind: "security",
      body: "Biometric account protection is on. NYX will not photograph you in the background.",
    });
    return { ok: true as const };
  });

export const assertBiometric = createServerFn({ method: "POST" })
  .validator(
    (d: {
      credentialId: string;
      clientDataJSON: string;
      authenticatorData: string;
      signature: string;
    }) => d,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const wait = takeToken(`bio-as:${context.userId}`, 12, 60_000);
    if (wait) throw new Error(rateError(wait));
    const expected = challenges.get(`${context.userId}:assert`);
    if (!expected) throw new Error("Start the security check again.");
    let parsed: { type?: string; challenge?: string };
    try {
      parsed = JSON.parse(Buffer.from(data.clientDataJSON, "base64url").toString("utf8")) as typeof parsed;
    } catch {
      throw new Error("Could not read the authenticator response.");
    }
    if (parsed.type !== "webauthn.get" || parsed.challenge !== expected.challenge) {
      const sql = await sqlClient();
      await notify(sql, {
        userId: context.userId,
        kind: "security",
        body: "A biometric check failed. Sensitive actions stay locked until you confirm it's you.",
      }).catch(() => {});
      throw new Error("That security check failed. Try again, or use your password.");
    }
    const sql = await sqlClient();
    const row = await sql<{ id: string; public_key: string; counter: number }>`
      select id, public_key, counter from biometric_credentials
      where user_id = ${context.userId} and credential_id = ${data.credentialId}
      limit 1
    `;
    if (!row[0]) throw new Error("That passkey is not enrolled on this account.");
    const ok = await verifyAssertion(row[0].public_key, data.authenticatorData, data.clientDataJSON, data.signature);
    if (!ok) {
      await notify(sql, {
        userId: context.userId,
        kind: "security",
        body: "A biometric check failed. Your account is not permanently locked — confirm it's you to continue.",
      });
      throw new Error("That security check failed. Try again, or use your password.");
    }
    challenges.delete(`${context.userId}:assert`);
    await sql`update biometric_credentials set counter = counter + 1 where id = ${row[0].id}`;
    return { ok: true as const };
  });

export const disableBiometric = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await sql`delete from biometric_credentials where user_id = ${context.userId}`;
    await sql`update profiles set biometric_enabled = false where user_id = ${context.userId}`;
    return { ok: true as const };
  });

async function verifyAssertion(
  publicKeyB64: string,
  authenticatorDataB64: string,
  clientDataB64: string,
  signatureB64: string,
): Promise<boolean> {
  try {
    const { createPublicKey, verify } = await import("node:crypto");
    const spki = Buffer.from(publicKeyB64, "base64url");
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    const authData = Buffer.from(authenticatorDataB64, "base64url");
    const clientHash = createHash("sha256").update(Buffer.from(clientDataB64, "base64url")).digest();
    const signed = Buffer.concat([authData, clientHash]);
    const sig = derToRaw(Buffer.from(signatureB64, "base64url"));
    return verify("SHA256", signed, key, sig) || verify(null, signed, key, Buffer.from(signatureB64, "base64url"));
  } catch {
    return false;
  }
}

function derToRaw(der: Buffer): Buffer {
  if (der.length === 64) return der;
  try {
    let offset = 2;
    if (der[1]! & 0x80) offset += der[1]! & 0x7f;
    if (der[offset] !== 0x02) return der;
    const rLen = der[offset + 1]!;
    let r = der.subarray(offset + 2, offset + 2 + rLen);
    offset = offset + 2 + rLen;
    const sLen = der[offset + 1]!;
    let s = der.subarray(offset + 2, offset + 2 + sLen);
    if (r.length > 32 && r[0] === 0) r = r.subarray(r.length - 32);
    if (s.length > 32 && s[0] === 0) s = s.subarray(s.length - 32);
    const raw = Buffer.alloc(64);
    r.copy(raw, 32 - r.length);
    s.copy(raw, 64 - s.length);
    return raw;
  } catch {
    return der;
  }
}
