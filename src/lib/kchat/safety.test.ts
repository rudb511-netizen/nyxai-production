import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminRank,
  canAccessSafety,
  canDeleteComment,
  canDeleteOwned,
  canManageAdministrator,
  canPunishTarget,
  isAdministrator,
  isProtectedAccount,
  isReportTargetKind,
  isStaffRole,
  RANK,
} from "./safety.ts";

describe("safety", () => {
  it("lets authors and staff delete owned posts", () => {
    assert.equal(canDeleteOwned("a", "a", "user"), true);
    assert.equal(canDeleteOwned("a", "b", "user"), false);
    assert.equal(canDeleteOwned("mod", "b", "moderator"), true);
    assert.equal(canDeleteOwned("admin", "b", "admin"), true);
  });

  it("lets comment authors, post authors, and staff delete comments", () => {
    assert.equal(
      canDeleteComment({ viewerId: "c", commentAuthorId: "c", postAuthorId: "p", role: "user" }),
      true,
    );
    assert.equal(
      canDeleteComment({ viewerId: "p", commentAuthorId: "c", postAuthorId: "p", role: "user" }),
      true,
    );
    assert.equal(
      canDeleteComment({ viewerId: "x", commentAuthorId: "c", postAuthorId: "p", role: "user" }),
      false,
    );
    assert.equal(
      canDeleteComment({ viewerId: "x", commentAuthorId: "c", postAuthorId: "p", role: "admin" }),
      true,
    );
  });

  it("opens the safety desk to staff and marked official handles", () => {
    assert.equal(canAccessSafety("user", "none"), false);
    assert.equal(canAccessSafety("moderator", "none"), true);
    assert.equal(canAccessSafety("user", "org"), true);
    assert.equal(canAccessSafety("user", "founder"), true);
    assert.equal(canAccessSafety("user", "arc"), true);
    assert.equal(isStaffRole("super_admin"), true);
    assert.equal(isReportTargetKind("user"), true);
    assert.equal(isReportTargetKind("story"), true);
    assert.equal(isReportTargetKind("status"), true);
    assert.equal(isReportTargetKind("flash"), true);
    assert.equal(isReportTargetKind("account"), false);
  });

  it("treats org, founder, developer, and ARC as administrators", () => {
    assert.equal(isAdministrator("user", "org"), true);
    assert.equal(isAdministrator("user", "founder"), true);
    assert.equal(isAdministrator("user", "developer"), true);
    assert.equal(isAdministrator("user", "arc"), true);
    assert.equal(isAdministrator("user", "none"), false);
    assert.equal(isAdministrator("admin", "none"), true);
  });

  it("ranks ARC above ordinary administrators", () => {
    assert.equal(adminRank("super_admin", "arc", "a1"), RANK.arc);
    assert.equal(adminRank("super_admin", "founder", "f1"), RANK.admin);
    assert.equal(adminRank("admin", "org", "o1"), RANK.admin);
    assert.equal(adminRank("user", "none", "u1"), RANK.user);
  });

  it("never lets an ordinary administrator punish another administrator", () => {
    const founder = { userId: "f1", role: "super_admin", verifyKind: "founder" };
    const org = { userId: "o1", role: "admin", verifyKind: "org" };
    const member = { userId: "u1", role: "user", verifyKind: "none" };
    const arc = { userId: "a1", role: "super_admin", verifyKind: "arc" };
    assert.equal(
      canPunishTarget({ actorId: "f1", actorRole: "super_admin", actorVerifyKind: "founder", target: org }),
      false,
    );
    assert.equal(
      canPunishTarget({ actorId: "o1", actorRole: "admin", actorVerifyKind: "org", target: founder }),
      false,
    );
    assert.equal(
      canPunishTarget({ actorId: "f1", actorRole: "super_admin", actorVerifyKind: "founder", target: founder }),
      false,
    );
    assert.equal(
      canPunishTarget({ actorId: "f1", actorRole: "super_admin", actorVerifyKind: "founder", target: member }),
      true,
    );
    assert.equal(
      canPunishTarget({ actorId: "o1", actorRole: "admin", actorVerifyKind: "org", target: member }),
      true,
    );
    assert.equal(
      canPunishTarget({
        actorId: "f1",
        actorRole: "super_admin",
        actorVerifyKind: "founder",
        target: { userId: "omni_support_system", role: "user", verifyKind: "none" },
      }),
      false,
    );
    assert.equal(isProtectedAccount({ userId: "omni_ai_system", role: "user", verifyKind: "org" }), true);
    assert.equal(
      canPunishTarget({ actorId: "f1", actorRole: "super_admin", actorVerifyKind: "founder", target: arc }),
      false,
    );
  });

  it("lets ARC manage ordinary admins but never another ARC", () => {
    const founder = { userId: "f1", role: "super_admin", verifyKind: "founder" };
    const org = { userId: "o1", role: "admin", verifyKind: "org" };
    const member = { userId: "u1", role: "user", verifyKind: "none" };
    const arc = { userId: "a1", role: "super_admin", verifyKind: "arc" };
    const arc2 = { userId: "a2", role: "super_admin", verifyKind: "arc" };
    assert.equal(
      canPunishTarget({ actorId: "a1", actorRole: "super_admin", actorVerifyKind: "arc", target: founder }),
      true,
    );
    assert.equal(
      canPunishTarget({ actorId: "a1", actorRole: "super_admin", actorVerifyKind: "arc", target: org }),
      true,
    );
    assert.equal(
      canPunishTarget({ actorId: "a1", actorRole: "super_admin", actorVerifyKind: "arc", target: member }),
      true,
    );
    assert.equal(
      canPunishTarget({ actorId: "a1", actorRole: "super_admin", actorVerifyKind: "arc", target: arc2 }),
      false,
    );
    assert.equal(
      canManageAdministrator({ actorId: "a1", actorRole: "super_admin", actorVerifyKind: "arc", target: founder }),
      true,
    );
    assert.equal(
      canManageAdministrator({ actorId: "a1", actorRole: "super_admin", actorVerifyKind: "arc", target: arc2 }),
      false,
    );
    assert.equal(
      canManageAdministrator({ actorId: "f1", actorRole: "super_admin", actorVerifyKind: "founder", target: org }),
      false,
    );
    assert.equal(
      canManageAdministrator({ actorId: "a1", actorRole: "super_admin", actorVerifyKind: "arc", target: member }),
      false,
    );
  });

  it("ranks additive ARC above the preserved identity badge", () => {
    assert.equal(adminRank("super_admin", "founder", "f1", true), RANK.arc);
    assert.equal(adminRank("admin", "org", "o1", true), RANK.arc);
    assert.equal(adminRank("user", "none", "u1", true), RANK.arc);
    assert.equal(isAdministrator("admin", "org", true), true);
    assert.equal(
      canPunishTarget({
        actorId: "f1",
        actorRole: "super_admin",
        actorVerifyKind: "founder",
        actorIsArc: true,
        target: { userId: "o1", role: "admin", verifyKind: "org" },
      }),
      true,
    );
    assert.equal(
      canPunishTarget({
        actorId: "f1",
        actorRole: "super_admin",
        actorVerifyKind: "founder",
        actorIsArc: true,
        target: { userId: "a2", role: "super_admin", verifyKind: "org", isArc: true },
      }),
      false,
    );
    assert.equal(
      canManageAdministrator({
        actorId: "o1",
        actorRole: "admin",
        actorVerifyKind: "org",
        actorIsArc: true,
        target: { userId: "f1", role: "super_admin", verifyKind: "founder" },
      }),
      true,
    );
  });
});
