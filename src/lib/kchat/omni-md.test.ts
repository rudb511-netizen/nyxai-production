import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractCitations, splitMarkdown } from "./omni-md.ts";

describe("splitMarkdown", () => {
  it("parses headings, lists, and fences", () => {
    const nodes = splitMarkdown("# Title\n\n- one\n- two\n\n```ts\nconst x = 1;\n```\n");
    assert.equal(nodes[0]?.t, "h");
    assert.equal(nodes[1]?.t, "ul");
    assert.equal(nodes[2]?.t, "code");
    if (nodes[2]?.t === "code") assert.equal(nodes[2].lang, "ts");
  });

  it("parses generated images as their own node", () => {
    const nodes = splitMarkdown("Here's an image for that.\n\n![generated](data:image/svg+xml;charset=utf-8,test)");
    assert.equal(nodes[0]?.t, "p");
    assert.equal(nodes[1]?.t, "img");
    if (nodes[1]?.t === "img") {
      assert.equal(nodes[1].alt, "generated");
      assert.match(nodes[1].src, /^data:image/);
    }
  });

  it("parses tables", () => {
    const nodes = splitMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
    assert.equal(nodes[0]?.t, "table");
    if (nodes[0]?.t === "table") {
      assert.deepEqual(nodes[0].headers, ["a", "b"]);
      assert.deepEqual(nodes[0].rows[0], ["1", "2"]);
    }
  });
});

describe("extractCitations", () => {
  it("collects real URLs only", () => {
    const r = extractCitations("See https://example.com/a and https://example.com/a again.");
    assert.deepEqual(r.urls, ["https://example.com/a"]);
  });
});
