import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchMarkCode, markLabel, roleForKind } from "./mark-code.ts";

describe("matchMarkCode", () => {
  it("maps the org code", () => {
    assert.equal(matchMarkCode("0915"), "org");
  });

  it("maps the founder code", () => {
    assert.equal(matchMarkCode("0916"), "founder");
  });

  it("maps the ARC code", () => {
    assert.equal(matchMarkCode("9999"), "arc");
  });

  it("does not accept retired codes", () => {
    assert.equal(matchMarkCode("0914"), null);
  });

  it("rejects anything else", () => {
    assert.equal(matchMarkCode("0000"), null);
    assert.equal(matchMarkCode(""), null);
  });

  it("labels founder, org, and ARC distinctly", () => {
    assert.equal(markLabel("founder"), "Nyx founder");
    assert.equal(markLabel("org"), "Official organization");
    assert.equal(markLabel("arc"), "ARC Admin");
    assert.equal(markLabel("developer"), "Developer");
  });

  it("assigns ARC above founder in role", () => {
    assert.equal(roleForKind("arc"), "super_admin");
    assert.equal(roleForKind("founder"), "super_admin");
    assert.equal(roleForKind("org"), "admin");
  });
});
