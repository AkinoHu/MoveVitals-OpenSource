// The caller's IP, for rate limits. `X-Forwarded-For` is client-controlled up to
// the first trusted proxy, so the *leftmost* entry (what we used to read) can be
// forged to dodge every per-IP limit. We count from the right instead:
//
//   CLIENT_IP_HEADER   a header your edge sets and overwrites (e.g. "cf-connecting-ip",
//                      "x-real-ip"); wins when present.
//   TRUSTED_PROXY_HOPS number of proxies in front of the app that append to
//                      X-Forwarded-For (default 1: Railway's edge). The address
//                      added by the outermost trusted proxy is used.

export function clientIp(h: Pick<Headers, "get">): string {
  const custom = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (custom) {
    const v = h.get(custom)?.split(",")[0]?.trim();
    if (v) return v;
  }
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1) || 1);
  const chain = (h.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (chain.length) return chain[Math.max(0, chain.length - hops)];
  return h.get("x-real-ip")?.trim() || "unknown";
}
