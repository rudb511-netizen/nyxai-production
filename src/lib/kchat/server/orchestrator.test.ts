import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeRequest } from "./orchestrator.ts";

describe("task analyzer", () => {
  it("keeps a greeting on one fast step", () => {
    const plan = analyzeRequest("Hi");
    assert.equal(plan.kind, "simple");
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0]?.capability, "fast");
  });

  it("sends a real coding task through draft, review, and synthesis", () => {
    const plan = analyzeRequest(
      "Write a TypeScript function that reverses a linked list, handle an empty list, and explain the edge cases in the code.",
    );
    assert.equal(plan.kind, "coding");
    assert.ok(plan.steps.length >= 2);
    assert.equal(plan.steps[0]?.capability, "code");
    assert.equal(plan.steps.some((step) => step.role === "review" && step.differentProvider), true);
  });

  it("routes research through search and a second reasoning pass", () => {
    const plan = analyzeRequest("Research the latest changes in TypeScript 5.6 and compare them with 5.5. Include sources.");
    assert.equal(plan.kind, "research");
    assert.deepEqual(
      plan.steps.map((step) => step.capability),
      ["search", "reason"],
    );
  });
});
