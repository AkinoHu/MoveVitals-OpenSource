// Bring-your-own-key LLM analysis. The user's key is stored encrypted and
// only the resolved, provenance-tagged data the user allowed is sent.

import { and, desc, eq, gte } from "drizzle-orm";
import { decrypt } from "./crypto";
import { db } from "./db";
import { activityGroups, aiSettings, dailyMetrics, labResults, userAttributes } from "./db/schema";
import { safeJsonPost, allowPrivateUrls, type SafeResponse } from "./safe-fetch";
import { ageFrom } from "./attributes";
import en from "@/i18n/dict/en";
import type { Locale } from "@/i18n/config";
import { formatMetric } from "./metrics";
import { CATALOG_MAP, providerName } from "./providers/catalog";
import type { Sport } from "./sports";
import { addDays, dayInTz } from "./time";

export const AI_PRESETS = [
  { kind: "anthropic", label: "Anthropic Claude", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5" },
  { kind: "openai_compatible", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5" },
  { kind: "openai_compatible", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { kind: "openai_compatible", label: "Qwen (DashScope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-max" },
] as const;

// Local models only make sense (and are only reachable) on a self-hosted
// instance that opted in with AI_ALLOW_PRIVATE_URLS=1.
export function aiPresets() {
  return allowPrivateUrls() ? [...AI_PRESETS, { kind: "openai_compatible", label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "llama3.1" } as const] : [...AI_PRESETS];
}

const SYSTEM = `You are MoveVitals' sports-science and health-data analyst.
- Answer only from the data provided; say clearly what is missing when data is insufficient.
- Every value is tagged with its source platform; point out differences between sources and likely reasons when relevant.
- Give actionable training and recovery advice and explain the evidence (trends, deviation from baseline, load changes).
- You are not a doctor; for illness or abnormal readings, recommend consulting a medical professional.
- Be concise and well structured.`;

const REPLY_LANGUAGE: Record<Locale, string> = {
  en: "English",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese (Taiwan)",
  fr: "French",
  es: "Spanish",
};

export function isAllowed(provider: string, allowed: string[] | null | undefined): boolean {
  if (allowed) return allowed.includes(provider);
  return !CATALOG_MAP[provider]?.aiRestricted;
}

export type ContextOptions = {
  allowedProviders?: string[] | null;
  includeProfile?: boolean; // age, sex, height, max HR, FTP
  includeLabs?: boolean; // Body Lab biomarker values
  includeNames?: boolean; // free-text workout titles
};

export async function buildContext(userId: string, timezone: string, days = 42, opts: ContextOptions = {}): Promise<string> {
  const allowed = opts.allowedProviders;
  const { includeProfile = true, includeLabs = false, includeNames = true } = opts;
  const from = addDays(dayInTz(new Date(), timezone), -days);
  const [daily, groups] = await Promise.all([
    db
      .select()
      .from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, userId), gte(dailyMetrics.day, from)))
      .orderBy(dailyMetrics.day),
    db
      .select()
      .from(activityGroups)
      .where(and(eq(activityGroups.userId, userId), gte(activityGroups.startTime, new Date(`${from}T00:00:00Z`))))
      .orderBy(desc(activityGroups.startTime))
      .limit(60),
  ]);

  const attrs = includeProfile ? Object.fromEntries((await db.select().from(userAttributes).where(eq(userAttributes.userId, userId))).map((a) => [a.key, a.value])) : {};
  const age = ageFrom(attrs.birth_date);
  const profile = [
    age != null && `age ${age}`,
    attrs.sex && `sex ${attrs.sex}`,
    attrs.height_cm && `height ${attrs.height_cm} cm`,
    attrs.max_hr && `max HR ${attrs.max_hr} bpm`,
    attrs.ftp_w && `FTP ${attrs.ftp_w} W`,
  ].filter(Boolean);

  const lines: string[] = [...(profile.length ? [`# Profile: ${profile.join(", ")}`, ""] : []), `# Daily metrics (last ${days} days; format: metric=value[source]; ⚠ = sources disagree)`];
  const byDay = new Map<string, string[]>();
  for (const d of daily) {
    // Fall back to an allowed candidate if the winner's source is excluded.
    const c = isAllowed(d.selectedProvider, allowed) ? { provider: d.selectedProvider, value: d.value } : d.candidates.find((x) => isAllowed(x.provider, allowed));
    if (!c) continue;
    const label = en.metrics[d.metric as keyof typeof en.metrics] ?? d.metric;
    const entry = `${label}=${formatMetric(d.metric, c.value)}[${providerName(c.provider)}]${d.hasConflict ? "⚠" : ""}`;
    byDay.set(d.day, [...(byDay.get(d.day) ?? []), entry]);
  }
  for (const [day, entries] of byDay) lines.push(`${day}: ${entries.join("; ")}`);

  lines.push("", "# Workouts (source in parentheses after each field)");
  for (const g of groups) {
    const fields = Object.entries(g.merged)
      .filter(([k, f]) => k !== "name" && k !== "sport" && isAllowed(f.provider, allowed))
      .map(([k, f]) => `${k}=${typeof f.value === "number" ? Math.round(f.value * 10) / 10 : f.value}(${providerName(f.provider)})`);
    if (fields.length === 0) continue;
    // Sport and title are fields with a source too: only emit them when that
    // source may be shared (titles also need the "workout names" toggle).
    const sportSrc = g.merged.sport?.provider;
    const nameSrc = g.merged.name?.provider;
    const sport = !sportSrc || isAllowed(sportSrc, allowed) ? (en.sports[g.sport as Sport] ?? g.sport) : "workout";
    const name = includeNames && g.name && nameSrc && isAllowed(nameSrc, allowed) ? g.name : "";
    lines.push(`${g.startTime.toISOString().slice(0, 16)} ${sport}${name ? ` "${name}"` : ""}: ${fields.join(", ")}`);
  }

  // Lab results the user entered or confirmed (latest per marker).
  const labs = includeLabs ? await db.select().from(labResults).where(eq(labResults.userId, userId)).orderBy(labResults.takenOn) : [];
  const latestLab = new Map(labs.map((r) => [r.marker, r]));
  if (latestLab.size) {
    lines.push("", "# Lab results (latest per marker; printed reference range in brackets when given)");
    for (const r of latestLab.values()) {
      const range = r.refLow != null || r.refHigh != null ? ` [ref ${r.refLow ?? ""}–${r.refHigh ?? ""}]` : "";
      lines.push(`${r.takenOn} ${r.marker}=${Math.round(r.value * 100) / 100} ${r.unit}${range}`);
    }
  }
  return lines.join("\n");
}

// Turn a raw model-endpoint response into JSON or a short, safe error.
function modelJson<T extends { error?: { message: string } }>(res: SafeResponse): T {
  const json = res.json as T | null;
  if (json === null || typeof json !== "object") throw new Error(`The model endpoint returned a non-JSON response (HTTP ${res.status})`);
  if (res.status < 200 || res.status >= 300) throw new Error(String(json.error?.message ?? `HTTP ${res.status}`).slice(0, 300));
  return json;
}

export type Attachment = { mime: string; data: string; filename: string }; // data: base64

export async function aiSettingsOf(userId: string) {
  const [settings] = await db.select().from(aiSettings).where(eq(aiSettings.userId, userId));
  return settings ?? null;
}

// One request to the user's configured model. PDFs and images are attached
// natively (Anthropic document/image blocks; OpenAI-style file/image parts).
export async function callModel(settings: typeof aiSettings.$inferSelect, system: string, text: string, attachments: Attachment[] = []): Promise<string> {
  const apiKey = decrypt(settings.apiKeyEnc);
  if (settings.kind === "anthropic") {
    const parts = attachments.map((f) =>
      f.mime === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: f.mime, data: f.data } }
        : { type: "image", source: { type: "base64", media_type: f.mime, data: f.data } },
    );
    const res = await safeJsonPost(
      `${(settings.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
      { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      JSON.stringify({ model: settings.model, max_tokens: 4096, system, messages: [{ role: "user", content: [...parts, { type: "text", text }] }] }),
    );
    const json = modelJson<{ content?: { type: string; text?: string }[]; error?: { message: string } }>(res);
    return (json.content ?? []).map((b) => b.text ?? "").join("");
  }

  const parts = attachments.map((f) =>
    f.mime === "application/pdf"
      ? { type: "file", file: { filename: f.filename, file_data: `data:${f.mime};base64,${f.data}` } }
      : { type: "image_url", image_url: { url: `data:${f.mime};base64,${f.data}` } },
  );
  const res = await safeJsonPost(
    `${(settings.baseUrl ?? "").replace(/\/$/, "")}/chat/completions`,
    { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    JSON.stringify({
      model: settings.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: attachments.length ? [...parts, { type: "text", text }] : text },
      ],
    }),
  );
  const json = modelJson<{ choices?: { message: { content: string } }[]; error?: { message: string } }>(res);
  return json.choices?.[0]?.message.content ?? "";
}

export async function askAI(userId: string, timezone: string, question: string, locale: Locale): Promise<string> {
  const settings = await aiSettingsOf(userId);
  if (!settings) throw new Error("dash.ai.notConfigured");
  const context = await buildContext(userId, timezone, 42, settings);
  return callModel(settings, `${SYSTEM}\n- Reply in ${REPLY_LANGUAGE[locale]}.`, `${context}\n\n# Question\n${question}`);
}
