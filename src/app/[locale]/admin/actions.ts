"use server";

import { and, eq, ne, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { requireAdmin } from "@/lib/admin";
import { isCategory, readingMinutes, slugify } from "@/lib/content";
import { db } from "@/lib/db";
import { authors, integrationRequests, media, posts } from "@/lib/db/schema";

export type SaveState = { ok?: boolean; error?: "required" | "slug" | "duplicate"; id?: string; at?: number };

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => str(f, k) || null;

function refresh() {
  revalidatePath("/", "layout");
}

export async function savePost(_: SaveState, f: FormData): Promise<SaveState> {
  await requireAdmin();
  const id = opt(f, "id");
  const locale = str(f, "locale");
  const slug = str(f, "slug").toLowerCase();
  const translationKey = str(f, "translationKey");
  const category = str(f, "category");
  const title = str(f, "title");
  if (!title || !slug || !translationKey || !isLocale(locale) || !isCategory(category)) return { error: "required" };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { error: "slug" };
  // /guides/<category> is the category page, so those names are taken.
  if (isCategory(slug)) return { error: "duplicate" };

  const clash = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.locale, locale), or(eq(posts.slug, slug), eq(posts.translationKey, translationKey)), id ? ne(posts.id, id) : undefined));
  if (clash.length) return { error: "duplicate" };

  const body = String(f.get("body") ?? "");
  const status = str(f, "status") === "published" ? "published" : "draft";
  const date = str(f, "publishedAt");
  const values = {
    locale,
    slug,
    translationKey,
    category,
    title,
    body,
    excerpt: opt(f, "excerpt"),
    tags: str(f, "tags")
      .split(",")
      // Metric codes and provider ids keep their underscores (hrv_rmssd, apple_health).
      .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"))
      .filter(Boolean),
    coverUrl: opt(f, "coverUrl"),
    authorId: opt(f, "authorId"),
    reviewerId: opt(f, "reviewerId"),
    status,
    featured: f.get("featured") === "on",
    order: Number(str(f, "order")) || 100,
    seoTitle: opt(f, "seoTitle"),
    seoDescription: opt(f, "seoDescription"),
    readingMinutes: readingMinutes(body),
    publishedAt: date ? new Date(date) : status === "published" ? new Date() : null,
    seedHash: null, // edited by a person: repo content no longer overwrites it
    updatedAt: new Date(),
  };

  let saved = id;
  if (id) await db.update(posts).set(values).where(eq(posts.id, id));
  else [{ id: saved }] = await db.insert(posts).values(values).returning({ id: posts.id });
  refresh();
  if (!id) redirect(`/admin/posts/${saved}?saved=1`);
  return { ok: true, id: saved!, at: Date.now() };
}

export async function deletePost(f: FormData) {
  await requireAdmin();
  await db.delete(posts).where(eq(posts.id, str(f, "id")));
  refresh();
  redirect("/admin/posts");
}

export async function saveAuthor(f: FormData) {
  await requireAdmin();
  const id = opt(f, "id");
  const name = str(f, "name");
  if (!name) return;
  const values = {
    name,
    slug: slugify(str(f, "slug") || name) || crypto.randomUUID().slice(0, 8),
    role: opt(f, "role"),
    bio: opt(f, "bio"),
    avatarUrl: opt(f, "avatarUrl"),
    url: opt(f, "url"),
    updatedAt: new Date(),
  };
  if (id) await db.update(authors).set(values).where(eq(authors.id, id));
  else await db.insert(authors).values(values).onConflictDoNothing();
  refresh();
}

export async function deleteAuthor(f: FormData) {
  await requireAdmin();
  await db.delete(authors).where(eq(authors.id, str(f, "id")));
  refresh();
}

const MAX_MEDIA = 4 * 1024 * 1024;

export async function uploadMedia(input: { filename: string; mime: string; data: string; width: number; height: number }): Promise<{ id: string } | { error: string }> {
  const user = await requireAdmin();
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(input.mime)) return { error: "type" };
  const bytes = Math.floor((input.data.length * 3) / 4);
  if (bytes > MAX_MEDIA) return { error: "size" };
  const [row] = await db
    .insert(media)
    .values({ filename: input.filename.slice(0, 200), mime: input.mime, data: input.data, width: input.width, height: input.height, bytes, uploadedBy: user.id })
    .returning({ id: media.id });
  revalidatePath("/[locale]/admin/media", "page");
  return { id: row.id };
}

export async function deleteMedia(f: FormData) {
  await requireAdmin();
  await db.delete(media).where(eq(media.id, str(f, "id")));
  revalidatePath("/[locale]/admin/media", "page");
}

export async function setRequestStatus(f: FormData) {
  await requireAdmin();
  const status = str(f, "status");
  if (!["new", "planned", "done", "declined"].includes(status)) return;
  await db.update(integrationRequests).set({ status }).where(eq(integrationRequests.id, str(f, "id")));
  revalidatePath("/[locale]/admin/requests", "page");
}

export async function backupNow() {
  await requireAdmin();
  const { runBackup } = await import("@/lib/backup");
  await runBackup();
  revalidatePath("/[locale]/admin/backups", "page");
}
