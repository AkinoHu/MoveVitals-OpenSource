// Article Markdown: pure functions, safe to import from client components
// (the CMS editor previews with the same renderer the site uses).

import { Marked, type Tokens } from "marked";

export type TocItem = { id: string; text: string; depth: number };

// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Link and image targets: only http(s), mailto and relative URLs. Anything else
// (javascript:, data:, vbscript:, file:…) is dropped, including variants with
// embedded control characters or whitespace that browsers would still parse.
export function safeHref(raw: string, opts: { mailto?: boolean } = { mailto: true }): string | null {
  const href = (raw ?? "").trim();
  const compact = href.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  if (!compact) return null;
  if (compact.startsWith("//")) return null; // protocol-relative: ambiguous, not needed
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  if (!scheme) return href; // relative, fragment or query
  if (scheme === "http" || scheme === "https") return href;
  if (scheme === "mailto" && opts.mailto !== false) return href;
  return null;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Renders article Markdown. Raw HTML is escaped (content is plain Markdown
// only), headings get stable ids, and h2/h3 feed the table of contents.
export function renderMarkdown(md: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  const used = new Map<string, number>();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(text);
      },
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens);
        const plain = token.text.replace(/[*_`[\]]/g, "");
        let id = slugify(plain) || `section-${toc.length + 1}`;
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n + 1}`;
        if (token.depth === 2 || token.depth === 3) toc.push({ id, text: plain, depth: token.depth });
        return `<h${token.depth} id="${id}">${inner}<a href="#${id}" class="anchor" aria-hidden="true">#</a></h${token.depth}>\n`;
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        const href = safeHref(token.href ?? "");
        if (!href) return text;
        const external = /^https?:\/\//i.test(href) && !href.startsWith("https://movevitals.com");
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${escapeHtml(href)}"${title}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
      },
      image(token: Tokens.Image) {
        const src = safeHref(token.href ?? "", { mailto: false });
        const alt = escapeHtml(token.text ?? "");
        if (!src) return alt;
        const cap = token.title ? `<figcaption>${escapeHtml(token.title)}</figcaption>` : "";
        return `<figure><img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" decoding="async" />${cap}</figure>`;
      },
      table(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: "th" | "td") => `<${tag}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const head = `<tr>${token.header.map((c) => cell(c, "th")).join("")}</tr>`;
        const rows = token.rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("");
        return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  });
  const html = marked.parse(md, { async: false }) as string;
  return { html, toc };
}

// ~230 wpm for Latin text, ~400 characters/min for CJK.
export function readingMinutes(md: string): number {
  const cjk = (md.match(/[㐀-鿿]/g) ?? []).length;
  const words = md.replace(/[㐀-鿿]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230 + cjk / 400));
}

