import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateTotpSecret, totpAt, verifyTotp } from "./totp.ts";

describe("totp", () => {
  it("verifies a freshly generated code", async () => {
    const secret = generateTotpSecret();
    const code = await totpAt(secret);
    assert.match(code, /^\d{6}$/);
    assert.equal(await verifyTotp(secret, code), true);
    assert.equal(await verifyTotp(secret, "000000"), false);
  });
});
