import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractHashtags,
  extractMentions,
  normalizeUsername,
  slugifyName,
  validateUsername,
} from "./usernames.ts";

describe("usernames", () => {
  it("normalizes and validates", () => {
    assert.equal(normalizeUsername("@Ada_Lovelace"), "ada_lovelace");
    assert.equal(validateUsername("ab"), "too_short");
    assert.equal(validateUsername("admin"), "reserved");
    assert.equal(validateUsername("1bad"), "invalid");
    assert.equal(validateUsername("kchat_user"), null);
  });

  it("extracts entities", () => {
    assert.deepEqual(extractHashtags("hello #KChat #kchat #Now"), ["kchat", "now"]);
    assert.deepEqual(extractMentions("hi @Ada and @ada"), ["ada"]);
  });

  it("slugifies display names", () => {
    assert.equal(slugifyName("Ada Lovelace"), "ada_lovelace");
  });
});
