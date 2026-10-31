import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMarkdown, safeHref } from "../src/lib/markdown";

describe("markdown", () => {
  it("only allows http(s), mailto and relative link targets", () => {
    for (const ok of ["https://a.com/x", "http://a.com", "mailto:a@b.co", "/docs/x", "#top", "../x", "?q=1"]) assert.equal(safeHref(ok), ok);
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " java\tscript:alert(1)", "data:text/html;base64,AAAA", "vbscript:x", "file:///etc/passwd", "//evil.com/x", ""]) assert.equal(safeHref(bad), null, bad);
    assert.equal(safeHref("mailto:a@b.co", { mailto: false }), null);
  });

  it("neutralises script links, raw HTML and bad images", () => {
    const { html } = renderMarkdown('[x](javascript:alert(1)) <script>alert(1)</script> ![a](data:image/svg+xml;base64,AAA) ![ok](https://img.example/a.png "cap") [mail](mailto:a@b.co) [d](https://example.org)');
    assert.ok(!/javascript:/i.test(html));
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("data:image"));
    assert.ok(html.includes('src="https://img.example/a.png"'));
    assert.ok(html.includes('href="mailto:a@b.co"'));
    assert.ok(html.includes('href="https://example.org" target="_blank" rel="noopener noreferrer"'));
  });

  it("builds heading ids and a table of contents", () => {
    const { html, toc } = renderMarkdown("## One\n\n### Two\n\n## One");
    assert.deepEqual(toc.map((t) => t.id), ["one", "two", "one-2"]);
    assert.ok(html.includes('id="one-2"'));
  });
});

import { sniffReportMime } from "../src/lib/lab/sniff";
describe("report upload sniffing", () => {
  it("detects allowed types by magic bytes and rejects others", () => {
    assert.equal(sniffReportMime(Buffer.from("%PDF-1.7\n...")), "application/pdf");
    assert.equal(sniffReportMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
    assert.equal(sniffReportMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), "image/png");
    assert.equal(sniffReportMime(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
    assert.equal(sniffReportMime(Buffer.from("<html><script>alert(1)</script>")), null);
    assert.equal(sniffReportMime(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
    assert.equal(sniffReportMime(Buffer.alloc(0)), null);
  });
});
