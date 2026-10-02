import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isResourceId, publicError } from "./public-error.ts";
import { passwordIssue } from "./password-policy.ts";
import { assertDataUrl, assertMediaRef, assertUpload, classifyUpload } from "./upload-guard.ts";

describe("publicError", () => {
  it("keeps user-safe copy", () => {
    assert.match(publicError(new Error("You cannot message this person."), "x").message, /cannot message/);
    assert.match(
      publicError(new Error("Administrators cannot be sanctioned."), "x").message,
      /cannot be sanctioned/,
    );
  });
  it("keeps the generic password-reset send error and hides provider config copy", () => {
    assert.equal(
      publicError(
        new Error("We couldn't send your password reset code right now. Please try again later."),
        "x",
      ).message,
      "We couldn't send your password reset code right now. Please try again later.",
    );
    assert.equal(
      publicError(
        new Error("Password reset email is not configured on this deployment. Ask the operator to add a mail provider."),
        "We couldn't send your password reset code right now. Please try again later.",
      ).message,
      "We couldn't send your password reset code right now. Please try again later.",
    );
  });
  it("hides sql", () => {
    assert.equal(
      publicError(new Error('column "pinned" of relation "conversation_members" does not exist'), "Couldn't open this conversation. Please try again.").message,
      "Couldn't open this conversation. Please try again.",
    );
  });
  it("validates ids", () => {
    assert.equal(isResourceId("cv_" + "a".repeat(24), "cv"), true);
    assert.equal(isResourceId("cv_nope"), false);
    assert.equal(isResourceId("'; drop table messages;--"), false);
  });
});

describe("passwordIssue", () => {
  it("accepts a strong password", () => {
    assert.equal(passwordIssue("NyxNight2026!", "reed@example.com"), null);
  });
  it("rejects short and weak", () => {
    assert.ok(passwordIssue("short"));
    assert.ok(passwordIssue("password1234"));
    assert.ok(passwordIssue("abcdefghij"));
  });
});

describe("upload-guard", () => {
  it("allows photos and rejects html", () => {
    assert.equal(classifyUpload("image/jpeg"), "image");
    assert.equal(assertUpload({ mime: "image/png", bytes: 1200, name: "shot.png" }), "image");
    assert.throws(() => assertUpload({ mime: "text/html", bytes: 20, name: "x.html" }));
    assert.throws(() => assertDataUrl("data:text/html,<script>"));
    assert.doesNotThrow(() => assertMediaRef("/api/media/up_abc"));
    assert.throws(() => assertMediaRef("https://evil.example/x"));
  });
});
