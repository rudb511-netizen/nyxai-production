import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canCall,
  callRefusal,
  canFollow,
  canFriendRequest,
  canMessage,
  canViewPrivateAccount,
  canViewStatus,
  canViewStory,
  emptyRelation,
  isCallConnected,
  type Relation,
} from "./privacy.ts";

const base: Relation = emptyRelation();

describe("privacy", () => {
  it("hides private accounts from strangers", () => {
    assert.equal(canViewPrivateAccount(base, true), false);
    assert.equal(canViewPrivateAccount({ ...base, isFollowing: true }, true), true);
    assert.equal(canViewPrivateAccount({ ...base, isSelf: true }, true), true);
  });

  it("respects message and friend audiences", () => {
    assert.equal(canMessage(base, "nobody"), false);
    assert.equal(canMessage({ ...base, isFriend: true }, "friends"), true);
    assert.equal(canFriendRequest({ ...base, isSelf: true }, "everyone"), false);
    assert.equal(canFollow({ ...base, isBlocked: true }, "everyone"), false);
  });

  it("gates stories", () => {
    assert.equal(canViewStory(base, "friends"), false);
    assert.equal(canViewStory({ ...base, isCloseFriend: true }, "close"), true);
  });

  it("lets accepted friends, close friends, NYX contacts, and mutual follows call", () => {
    assert.equal(canCall(base, "friends"), false);
    assert.equal(canCall({ ...base, isFriend: true }, "friends"), true);
    assert.equal(canCall({ ...base, isCloseFriend: true }, "friends"), true);
    assert.equal(canCall({ ...base, isContact: true }, "friends"), true);
    assert.equal(canCall({ ...base, isMutualFollow: true }, "friends"), true);
    assert.equal(canCall({ ...base, isFollowing: true, isFollower: true }, "friends"), true);
    assert.equal(canCall({ ...base, isBlocked: true }, "everyone"), false);
    assert.equal(canCall({ ...base, isContact: true }, "nobody"), false);
    assert.equal(callRefusal(base, "friends"), "You can only call people you're connected with on NYX.");
    assert.equal(callRefusal({ ...base, isBlocked: true }, "everyone"), "You blocked this person.");
    assert.equal(callRefusal({ ...base, isContact: true }, "nobody"), "This person is not accepting calls.");
    assert.equal(callRefusal({ ...base, isContact: true }, "friends"), null);
    assert.equal(isCallConnected({ ...base, isContact: true }), true);
    assert.equal(isCallConnected(base), false);
  });

  it("honors except and only-share-with lists", () => {
    const friend: Relation = { ...base, isFriend: true };
    assert.equal(
      canViewStatus(friend, "except", { mode: "except", userIds: ["u1"] }, "u1"),
      false,
    );
    assert.equal(
      canViewStatus(friend, "except", { mode: "except", userIds: ["u1"] }, "u2"),
      true,
    );
    assert.equal(
      canViewStatus(friend, "only", { mode: "only", userIds: ["u2"] }, "u2"),
      true,
    );
    assert.equal(
      canViewStatus(friend, "only", { mode: "only", userIds: ["u2"] }, "u1"),
      false,
    );
    assert.equal(canViewStatus({ ...base, isSelf: true }, "only", { mode: "only", userIds: [] }, "me"), true);
  });
});
