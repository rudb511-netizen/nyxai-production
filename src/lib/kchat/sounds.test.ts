import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSoundPrefs, typingLoopShouldRun } from "./sounds.ts";

describe("typing sound loop", () => {
  it("runs only while someone else is typing, prefs are on, and the tab is visible", () => {
    assert.equal(typingLoopShouldRun({ othersTyping: true, prefsOn: true, hidden: false }), true);
    assert.equal(typingLoopShouldRun({ othersTyping: false, prefsOn: true, hidden: false }), false);
    assert.equal(typingLoopShouldRun({ othersTyping: true, prefsOn: false, hidden: false }), false);
    assert.equal(typingLoopShouldRun({ othersTyping: true, prefsOn: true, hidden: true }), false);
  });

  it("defaults typing sounds on", () => {
    assert.equal(parseSoundPrefs({}).typing, true);
    assert.equal(parseSoundPrefs({ typing: false }).typing, false);
  });
});
