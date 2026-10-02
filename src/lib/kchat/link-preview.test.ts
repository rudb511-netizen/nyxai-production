import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractSafeLinks,
  hostnameLooksPrivate,
  parseHtmlMeta,
  parseSafeHttpUrl,
} from "./link-preview.ts";

describe("link preview ssrf", () => {
  it("blocks loopback and RFC1918", () => {
    assert.equal(parseSafeHttpUrl("http://127.0.0.1/"), null);
    assert.equal(parseSafeHttpUrl("http://localhost/x"), null);
    assert.equal(parseSafeHttpUrl("http://10.0.0.4/"), null);
    assert.equal(parseSafeHttpUrl("http://192.168.1.1/"), null);
    assert.equal(parseSafeHttpUrl("http://169.254.169.254/latest"), null);
    assert.equal(parseSafeHttpUrl("http://[::1]/"), null);
    assert.equal(hostnameLooksPrivate("metadata.google.internal"), true);
  });

  it("allows public https", () => {
    const u = parseSafeHttpUrl("https://www.example.com/a?q=1");
    assert.ok(u);
    assert.equal(u!.domain, "example.com");
  });

  it("rejects credentials and file urls", () => {
    assert.equal(parseSafeHttpUrl("https://user:pass@example.com/"), null);
    assert.equal(parseSafeHttpUrl("file:///etc/passwd"), null);
  });

  it("extracts only safe links", () => {
    const links = extractSafeLinks("see https://example.com/x and http://127.0.0.1/admin");
    assert.equal(links.length, 1);
    assert.equal(links[0]!.domain, "example.com");
  });

  it("parses open graph tags", () => {
    const meta = parseHtmlMeta(
      `<html><head><title>Page</title><meta property="og:title" content="Hello & Co"/><meta name="description" content="Desc"/></head></html>`,
    );
    assert.equal(meta.title, "Hello & Co");
    assert.equal(meta.description, "Desc");
  });
});
