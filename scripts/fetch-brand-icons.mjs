// Downloads each brand's own site icon (apple-touch-icon / largest favicon)
// into public/brands/<id>.<ext>. Brands covered by Simple Icons are rendered
// from that package instead and are not fetched here.
//   node scripts/fetch-brand-icons.mjs [id ...]   (no ids: fetch every brand)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITES = {
  whoop: "https://www.whoop.com",
  polar: "https://www.polar.com",
  oura: "https://ouraring.com",
  withings: "https://www.withings.com",
  suunto: "https://www.suunto.com",
  wahoo: "https://www.wahoofitness.com",
  concept2: "https://www.concept2.com",
  dexcom: "https://www.dexcom.com",
  zwift: "https://www.zwift.com",
  coros: "https://coros.com",
  zepp: "https://www.zepp.com",
  ultrahuman: "https://www.ultrahuman.com",
  trainingpeaks: "https://www.trainingpeaks.com",
  rouvy: "https://rouvy.com",
  magene: "https://www.magene.com",
  intervals_icu: "https://intervals.icu",
  ihealth: "https://ihealthlabs.com",
};

const OUT = path.join(process.cwd(), "public", "brands");
mkdirSync(OUT, { recursive: true });
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" };

function candidates(html, base) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || !/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const size = Number(/sizes=["'](\d+)x\d+["']/i.exec(tag)?.[1] ?? (/apple-touch/.test(rel) ? 180 : 32));
    out.push({ url: new URL(href, base).toString(), size: /\.svg(\?|$)/i.test(href) ? 1000 : size });
  }
  out.push({ url: new URL("/apple-touch-icon.png", base).toString(), size: 179 }, { url: new URL("/favicon.ico", base).toString(), size: 16 });
  return out.sort((a, b) => b.size - a.size);
}

const only = process.argv.slice(2);
for (const [id, site] of Object.entries(SITES).filter(([id]) => !only.length || only.includes(id))) {
  try {
    const res = await fetch(site, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const html = await res.text();
    let saved = false;
    for (const c of candidates(html, res.url)) {
      const r = await fetch(c.url, { headers: UA, signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (!r?.ok) continue;
      const type = r.headers.get("content-type") ?? "";
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 200 || /text\/html/.test(type)) continue;
      const ext = /svg/.test(type) || c.url.endsWith(".svg") ? "svg" : /png/.test(type) ? "png" : /icon|ico/.test(type) || c.url.endsWith(".ico") ? "ico" : /jpe?g/.test(type) ? "jpg" : /webp/.test(type) ? "webp" : "png";
      writeFileSync(path.join(OUT, `${id}.${ext}`), buf);
      console.log(`${id}: ${c.url} (${buf.length} bytes, ${ext})`);
      saved = true;
      break;
    }
    if (!saved) console.log(`${id}: no icon found`);
  } catch (e) {
    console.log(`${id}: ${e.message}`);
  }
}
