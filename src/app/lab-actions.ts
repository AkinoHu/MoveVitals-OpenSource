"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { aiSettingsOf } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { labReports, labResults } from "@/lib/db/schema";
import { extractMarkers } from "@/lib/lab/extract";
import { MARKER_MAP, toCanonical } from "@/lib/lab/markers";
import { sniffReportMime } from "@/lib/lab/sniff";
import type { FormState } from "./actions";

const MAX_BYTES = 5 * 1024 * 1024;
const MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const KINDS = new Set(["lab", "checkup", "doctor"]);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(",", ".");
  return s === "" ? null : Number.isFinite(Number(s)) ? Number(s) : NaN;
};

type Row = { marker: string; value: number; unit: string; refLow: number | null; refHigh: number | null; takenOn: string };

// Validates one result and converts it (and its printed range) to the
// marker's canonical unit.
function canonical(r: Row): { error: string } | typeof labResults.$inferInsert {
  const def = MARKER_MAP[r.marker];
  if (!def) return { error: "dash.lab.errMarker" };
  if (!Number.isFinite(r.value)) return { error: "dash.lab.errValue" };
  if (!isDay(r.takenOn)) return { error: "dash.lab.errDate" };
  const value = toCanonical(r.marker, r.value, r.unit);
  if (value == null) return { error: "dash.lab.errUnit" };
  const conv = (x: number | null) => (x == null || !Number.isFinite(x) ? null : toCanonical(r.marker, x, r.unit));
  return { userId: "", marker: r.marker, value, unit: def.unit, refLow: conv(r.refLow), refHigh: conv(r.refHigh), takenOn: r.takenOn, source: "manual" };
}

export async function addLabResult(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const row = canonical({
    marker: String(form.get("marker") ?? ""),
    value: num(form.get("value")) ?? NaN,
    unit: String(form.get("unit") ?? ""),
    refLow: num(form.get("refLow")),
    refHigh: num(form.get("refHigh")),
    takenOn: String(form.get("takenOn") ?? ""),
  });
  if ("error" in row) return { error: row.error };
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  await db.insert(labResults).values({ ...row, userId: user.id, note });
  revalidatePath("/", "layout");
  redirect(`/dashboard/lab/${row.marker}`);
}

export async function deleteLabResult(id: string) {
  const user = await requireUser();
  await db.delete(labResults).where(and(eq(labResults.id, id), eq(labResults.userId, user.id)));
  revalidatePath("/", "layout");
}

export async function uploadLabReport(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES || !MIMES.has(file.type)) return { error: "dash.lab.errFile" };
  const kind = KINDS.has(String(form.get("kind"))) ? String(form.get("kind")) : "lab";
  const takenOn = String(form.get("takenOn") ?? "");
  const extract = form.get("extract") === "on";
  const settings = extract ? await aiSettingsOf(user.id) : null;
  if (extract && !settings) return { error: "dash.lab.errNoModel" };

  const bytes = Buffer.from(await file.arrayBuffer());
  // Trust the file's own bytes, not the browser-declared type.
  const mime = sniffReportMime(bytes);
  if (!mime || mime !== file.type) return { error: "dash.lab.errFile" };
  const data = bytes.toString("base64");
  const title = String(form.get("title") ?? "").trim().slice(0, 120) || file.name.slice(0, 120);
  const [report] = await db
    .insert(labReports)
    .values({ userId: user.id, kind, title, takenOn: isDay(takenOn) ? takenOn : null, filename: file.name.slice(0, 200), mime, bytes: file.size, fileEnc: encrypt(data), status: extract ? "pending" : "stored" })
    .returning({ id: labReports.id });

  if (settings) {
    try {
      const extracted = await extractMarkers(settings, { mime, data, filename: file.name });
      await db.update(labReports).set({ status: "extracted", extracted }).where(eq(labReports.id, report.id));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await db.update(labReports).set({ status: "failed", error: error.slice(0, 500) }).where(eq(labReports.id, report.id));
    }
  }
  revalidatePath("/", "layout");
  redirect(`/dashboard/lab/reports/${report.id}`);
}

// Saves the rows the user kept on the review screen. Rows arrive as
// parallel fields suffixed with their index: marker.0, value.0, …
export async function confirmLabReport(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const reportId = String(form.get("reportId") ?? "");
  const [report] = await db.select({ id: labReports.id, takenOn: labReports.takenOn }).from(labReports).where(and(eq(labReports.id, reportId), eq(labReports.userId, user.id)));
  if (!report) return { error: "dash.lab.errMarker" };
  const count = Number(form.get("count") ?? 0);
  const rows: (typeof labResults.$inferInsert)[] = [];
  for (let i = 0; i < count; i++) {
    if (form.get(`include.${i}`) !== "on") continue;
    const row = canonical({
      marker: String(form.get(`marker.${i}`) ?? ""),
      value: num(form.get(`value.${i}`)) ?? NaN,
      unit: String(form.get(`unit.${i}`) ?? ""),
      refLow: num(form.get(`refLow.${i}`)),
      refHigh: num(form.get(`refHigh.${i}`)),
      takenOn: String(form.get(`takenOn.${i}`) ?? report.takenOn ?? ""),
    });
    if ("error" in row) return { error: row.error };
    rows.push({ ...row, userId: user.id, source: "report", reportId: report.id });
  }
  if (rows.length) await db.insert(labResults).values(rows);
  await db.update(labReports).set({ status: "confirmed" }).where(eq(labReports.id, report.id));
  revalidatePath("/", "layout");
  redirect("/dashboard/lab");
}

export async function deleteLabReport(id: string) {
  const user = await requireUser();
  // Values already confirmed stay; they only lose the link to the file.
  await db.delete(labReports).where(and(eq(labReports.id, id), eq(labReports.userId, user.id)));
  revalidatePath("/", "layout");
  redirect("/dashboard/lab");
}

