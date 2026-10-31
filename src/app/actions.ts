"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import { localeFromCookie } from "@/i18n";
import { askAI } from "@/lib/ai";
import { createApiTokenValue, createSession, currentSessionId, destroySession, requireUser, revokeOtherCredentials } from "@/lib/auth";
import { verifyCaptcha } from "@/lib/captcha";
import { clientIp } from "@/lib/client-ip";
import { sendVerificationEmail } from "@/lib/email-verification";
import { decryptOpt, encrypt, hashPassword } from "@/lib/crypto";
import { db } from "@/lib/db";
import { activities, activityGroups, aiSettings, apiTokens, authAccounts, connections, dailyOverrides, sourcePriorities, userAttributes, users } from "@/lib/db/schema";
import { createPasswordUser, isEmail, normaliseEmail, signupAllowed, verifyCredentials } from "@/lib/accounts";
import { ATTRIBUTE_KEYS, normaliseAttribute } from "@/lib/attributes";
import { feetInchesToCm } from "@/lib/units";
import { credentialsFor, getAdapter } from "@/lib/providers";
import { deleteProviderData } from "@/lib/provider-data";
import { recomputeGroup, resolveAll, resolveDays } from "@/lib/resolve";
import { checkUrl } from "@/lib/safe-fetch";
import { runSync } from "@/lib/sync";

export type FormState = { error?: string; ok?: string; token?: string; answer?: string } | undefined;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  if (process.env.ALLOW_SIGNUP === "false") return { error: "auth.errSignupClosed" };
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const name = String(form.get("name") ?? "").trim() || null;
  if (!isEmail(normaliseEmail(email))) return { error: "auth.errEmail" };
  if (password.length < 8) return { error: "auth.errPassword" };
  if (process.env.NEXT_PUBLIC_TERMS_URL && !form.get("agree")) return { error: "auth.errAgree" };
  const ip = clientIp(await headers());
  if (!(await verifyCaptcha(form, ip))) return { error: "request.errRate" };
  if (!(await signupAllowed(ip))) return { error: "request.errRate" };
  const userId = await createPasswordUser(email, password, name);
  if (!userId) return { error: "auth.errExists" };
  after(() => sendVerificationEmail(userId).catch(() => {}));
  await createSession(userId);
  redirect("/dashboard/connections");
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "");
  const ip = clientIp(await headers());
  const userId = await verifyCredentials(email, String(form.get("password") ?? ""), ip);
  if (!userId) {
    const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.email, normaliseEmail(email)));
    return { error: u && !u.hash ? "auth.errNoPassword" : "auth.errLogin" };
  }
  await createSession(userId);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/");
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export async function syncConnection(form: FormData) {
  const user = await requireUser();
  const [conn] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, String(form.get("id"))), eq(connections.userId, user.id)));
  if (!conn) return;
  after(() => runSync(conn.id, "manual"));
  revalidatePath("/", "layout");
}

export async function disconnect(form: FormData) {
  const user = await requireUser();
  const [conn] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, String(form.get("id"))), eq(connections.userId, user.id)));
  if (!conn) return;
  const adapter = getAdapter(conn.provider);
  const creds = adapter && credentialsFor(adapter);
  const token = decryptOpt(conn.accessTokenEnc);
  if (adapter?.revoke && creds && token) await adapter.revoke(token, creds, conn).catch((e) => console.warn("revoke failed", e));
  // Imported data stays unless the user ticked "also delete data from this source".
  if (form.get("deleteData") === "on") await deleteProviderData(user.id, conn.provider);
  await db.delete(connections).where(eq(connections.id, conn.id));
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Conflict management
// ---------------------------------------------------------------------------

export async function savePriority(form: FormData) {
  const user = await requireUser();
  const scope = String(form.get("scope"));
  const providers = String(form.get("providers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (providers.length === 0) {
    await db.delete(sourcePriorities).where(and(eq(sourcePriorities.userId, user.id), eq(sourcePriorities.scope, scope)));
  } else {
    await db
      .insert(sourcePriorities)
      .values({ userId: user.id, scope, providers })
      .onConflictDoUpdate({ target: [sourcePriorities.userId, sourcePriorities.scope], set: { providers, updatedAt: new Date() } });
  }
  await resolveAll(user.id);
  revalidatePath("/", "layout");
}

export async function setDailyOverride(form: FormData) {
  const user = await requireUser();
  const day = String(form.get("day"));
  const metric = String(form.get("metric"));
  const provider = String(form.get("provider") ?? "");
  if (provider) {
    await db
      .insert(dailyOverrides)
      .values({ userId: user.id, day, metric, provider })
      .onConflictDoUpdate({ target: [dailyOverrides.userId, dailyOverrides.day, dailyOverrides.metric], set: { provider } });
  } else {
    await db.delete(dailyOverrides).where(and(eq(dailyOverrides.userId, user.id), eq(dailyOverrides.day, day), eq(dailyOverrides.metric, metric)));
  }
  await resolveDays(user.id, [day]);
  revalidatePath("/", "layout");
}

export async function pinActivity(form: FormData) {
  const user = await requireUser();
  const groupId = String(form.get("groupId"));
  const activityId = String(form.get("activityId") ?? "") || null;
  if (activityId) {
    const [a] = await db.select({ id: activities.id }).from(activities).where(and(eq(activities.id, activityId), eq(activities.groupId, groupId), eq(activities.userId, user.id)));
    if (!a) return;
  }
  await db
    .update(activityGroups)
    .set({ manualPrimaryActivityId: activityId })
    .where(and(eq(activityGroups.id, groupId), eq(activityGroups.userId, user.id)));
  await recomputeGroup(user.id, groupId);
  revalidatePath("/", "layout");
}

// Split a wrongly merged activity out of its group.
export async function detachActivity(form: FormData) {
  const user = await requireUser();
  const activityId = String(form.get("activityId"));
  const [a] = await db.select().from(activities).where(and(eq(activities.id, activityId), eq(activities.userId, user.id)));
  if (!a?.groupId) return;
  const [g] = await db
    .insert(activityGroups)
    .values({ userId: user.id, sport: a.sport, name: a.name, startTime: a.startTime, endTime: a.endTime, manualPrimaryActivityId: a.id })
    .returning({ id: activityGroups.id });
  // manualSplit stops automatic grouping from merging it straight back.
  await db.update(activities).set({ groupId: g.id, manualSplit: true }).where(eq(activities.id, a.id));
  await recomputeGroup(user.id, a.groupId);
  await recomputeGroup(user.id, g.id);
  redirect(`/dashboard/activities/${g.id}`);
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export async function saveAISettings(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const kind = String(form.get("kind"));
  const model = String(form.get("model") ?? "").trim();
  const baseUrl = String(form.get("baseUrl") ?? "").trim() || null;
  const apiKey = String(form.get("apiKey") ?? "").trim();
  if (!["anthropic", "openai_compatible"].includes(kind) || !model) return { error: "dash.ai.fill" };
  if (baseUrl) {
    try {
      checkUrl(baseUrl);
    } catch {
      return { error: "dash.ai.badUrl" };
    }
  } else if (kind === "openai_compatible") {
    return { error: "dash.ai.fill" };
  }
  const [existing] = await db.select().from(aiSettings).where(eq(aiSettings.userId, user.id));
  if (!apiKey && !existing) return { error: "dash.ai.needKey" };
  const allowed = form.getAll("allowed").map(String);
  const values = {
    userId: user.id,
    kind,
    model,
    baseUrl,
    apiKeyEnc: apiKey ? encrypt(apiKey) : existing!.apiKeyEnc,
    allowedProviders: allowed.length ? allowed : null,
    includeProfile: form.get("includeProfile") === "on",
    includeLabs: form.get("includeLabs") === "on",
    includeNames: form.get("includeNames") === "on",
    updatedAt: new Date(),
  };
  await db.insert(aiSettings).values(values).onConflictDoUpdate({ target: aiSettings.userId, set: values });
  revalidatePath("/", "layout");
  return { ok: "common.saved" };
}

export async function ask(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const question = String(form.get("question") ?? "").trim();
  if (!question) return { error: "dash.ai.needQuestion" };
  try {
    return { answer: await askAI(user.id, user.timezone, question, await localeFromCookie()) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const timezone = String(form.get("timezone") ?? "UTC");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    return { error: "dash.settings.tzInvalid" };
  }
  const units = form.get("units") === "imperial" ? "imperial" : "metric";
  await db
    .update(users)
    .set({ name: String(form.get("name") ?? "").trim() || null, timezone, units })
    .where(eq(users.id, user.id));
  revalidatePath("/", "layout");
  return { ok: "common.saved" };
}

export async function createApiToken(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = String(form.get("name") ?? "").trim() || "iOS App";
  const { token, hash } = createApiTokenValue();
  await db.insert(apiTokens).values({ userId: user.id, name, tokenHash: hash });
  revalidatePath("/", "layout");
  return { token };
}

export async function deleteApiToken(form: FormData) {
  const user = await requireUser();
  await db.delete(apiTokens).where(and(eq(apiTokens.id, String(form.get("id"))), eq(apiTokens.userId, user.id)));
  revalidatePath("/", "layout");
}

export async function deleteAccount(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (String(form.get("confirm")) !== user.email) return { error: "dash.settings.deleteMismatch" };
  const conns = await db.select().from(connections).where(eq(connections.userId, user.id));
  for (const c of conns) {
    const adapter = getAdapter(c.provider);
    const creds = adapter && credentialsFor(adapter);
    const token = decryptOpt(c.accessTokenEnc);
    if (adapter?.revoke && creds && token) await adapter.revoke(token, creds, c).catch(() => {});
  }
  // Cascades to every table holding the user's data.
  await db.delete(users).where(eq(users.id, user.id));
  await destroySession();
  redirect("/");
}

// ---------------------------------------------------------------------------
// Profile: avatar and body attributes
// ---------------------------------------------------------------------------

const MAX_AVATAR_BYTES = 300_000;

// `dataUrl` is a square image already resized in the browser; null removes it.
export async function updateAvatar(dataUrl: string | null): Promise<FormState> {
  const user = await requireUser();
  if (dataUrl !== null) {
    if (!/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) return { error: "dash.settings.avatarInvalid" };
    if (dataUrl.length > MAX_AVATAR_BYTES * 1.37) return { error: "dash.settings.avatarTooLarge" };
  }
  await db
    .update(users)
    .set({ avatar: dataUrl, avatarUpdatedAt: dataUrl ? new Date() : null })
    .where(eq(users.id, user.id));
  revalidatePath("/", "layout");
  return { ok: "common.saved" };
}

// Manual entries always win: they are stored with source "manual".
export async function saveBodyProfile(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  // Imperial forms send height as feet + inches.
  if (form.has("height_ft") || form.has("height_in")) {
    const ft = Number(form.get("height_ft") || 0);
    const inch = Number(form.get("height_in") || 0);
    form.set("height_cm", ft || inch ? String(feetInchesToCm(ft, inch)) : "");
  }
  for (const key of ATTRIBUTE_KEYS) {
    const raw = String(form.get(key) ?? "");
    if (!raw.trim()) {
      await db.delete(userAttributes).where(and(eq(userAttributes.userId, user.id), eq(userAttributes.key, key), eq(userAttributes.source, "manual")));
      continue;
    }
    const value = normaliseAttribute(key, raw);
    if (value === null) return { error: `dash.settings.invalid_${key}` };
    await db
      .insert(userAttributes)
      .values({ userId: user.id, key, value, source: "manual" })
      .onConflictDoUpdate({ target: [userAttributes.userId, userAttributes.key], set: { value, source: "manual", updatedAt: new Date() } });
  }
  revalidatePath("/", "layout");
  return { ok: "common.saved" };
}

// ---------------------------------------------------------------------------
// Sign-in methods & cloud sync
// ---------------------------------------------------------------------------

export async function setCloudSync(enabled: boolean): Promise<FormState> {
  const user = await requireUser();
  await db.update(users).set({ cloudSync: enabled }).where(eq(users.id, user.id));
  revalidatePath("/", "layout");
  return { ok: enabled ? "dash.settings.syncOn" : "dash.settings.syncOff" };
}

export async function setPassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: "auth.errPassword" };
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, user.id));
  // A new password signs every other device out (other sessions and app tokens).
  await revokeOtherCredentials(user.id, await currentSessionId());
  revalidatePath("/", "layout");
  return { ok: "dash.settings.passwordSaved" };
}

export async function resendVerification() {
  const user = await requireUser();
  const sent = await sendVerificationEmail(user.id);
  redirect(`/dashboard/settings?${sent ? "sent=1" : "verify_error=1"}`);
}

export async function unlinkAccount(form: FormData) {
  const user = await requireUser();
  const provider = String(form.get("provider"));
  const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id));
  const linked = await db.select({ id: authAccounts.id, provider: authAccounts.provider }).from(authAccounts).where(eq(authAccounts.userId, user.id));
  // Never remove the last way to sign in.
  if (!u?.hash && linked.filter((l) => l.provider !== provider).length === 0) return;
  await db.delete(authAccounts).where(and(eq(authAccounts.userId, user.id), eq(authAccounts.provider, provider)));
  revalidatePath("/", "layout");
}
