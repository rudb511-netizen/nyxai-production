import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractPdfText, parseCsvPreview, sniffKind, summarizeExtract } from "./omni-files.ts";

describe("sniffKind", () => {
  it("classifies common uploads", () => {
    assert.equal(sniffKind("shot.png", "image/png"), "image");
    assert.equal(sniffKind("data.csv", "text/csv"), "table");
    assert.equal(sniffKind("brief.pdf", "application/pdf"), "doc");
    assert.equal(sniffKind("notes.txt", "text/plain"), "text");
  });
});

describe("parseCsvPreview", () => {
  it("keeps a header plus rows", () => {
    const raw = "name,n\na,1\nb,2\nc,3";
    assert.match(parseCsvPreview(raw), /name,n/);
    assert.match(parseCsvPreview(raw), /c,3/);
  });
});

describe("extractPdfText", () => {
  it("pulls Tj strings and never invents", () => {
    const src = "%PDF-1.4\n(Hello NYX) Tj\n(Page two) Tj";
    const bytes = new TextEncoder().encode(src);
    const text = extractPdfText(bytes);
    assert.match(text, /Hello NYX/);
    assert.match(text, /Page two/);
  });
});

describe("summarizeExtract", () => {
  it("flags empty files honestly", () => {
    assert.match(
      summarizeExtract({ name: "empty.pdf", mime: "application/pdf", kind: "doc", text: "", bytes: 12 }),
      /no extractable text/,
    );
  });
});
