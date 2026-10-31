// Identifies an uploaded report by its leading bytes. The browser-supplied
// content type is attacker-controlled, so the stored/served type is the one we
// detect here, and an upload whose bytes do not match an allowed type is refused.
export type ReportMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

export function sniffReportMime(b: Uint8Array): ReportMime | null {
  const at = (i: number, s: string) => s.split("").every((c, k) => b[i + k] === c.charCodeAt(0));
  // PDFs may have a few bytes of junk before the header; the spec allows 1024.
  const head = Buffer.from(b.subarray(0, 1024)).toString("latin1");
  if (head.includes("%PDF-")) return "application/pdf";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && at(1, "PNG") && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length > 12 && at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  return null;
}
