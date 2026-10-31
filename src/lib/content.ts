// Guides / CMS content: categories, Markdown rendering and queries.

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { db } from "./db";
import { authors, posts } from "./db/schema";

export const CATEGORIES = ["metrics", "training", "recovery", "mobility", "devices"] as const;
export type Category = (typeof CATEGORIES)[number];
export const isCategory = (v: string): v is Category => (CATEGORIES as readonly string[]).includes(v);

export type Post = typeof posts.$inferSelect;
export type Author = typeof authors.$inferSelect;
export { readingMinutes, renderMarkdown, slugify, type TocItem } from "./markdown";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const published = (locale: string) => and(eq(posts.locale, locale), eq(posts.status, "published"));

export async function listPublished(locale: Locale): Promise<Post[]> {
  return db.select().from(posts).where(published(locale)).orderBy(asc(posts.category), asc(posts.order), desc(posts.publishedAt));
}

// Published posts for a locale, falling back to English for articles that
// have no translation yet (flagged with `fallback`).
export async function listWithFallback(locale: Locale): Promise<(Post & { fallback: boolean })[]> {
  const own = await listPublished(locale);
  if (locale === DEFAULT_LOCALE) return own.map((p) => ({ ...p, fallback: false }));
  const have = new Set(own.map((p) => p.translationKey));
  const en = (await listPublished(DEFAULT_LOCALE)).filter((p) => !have.has(p.translationKey));
  return [...own.map((p) => ({ ...p, fallback: false })), ...en.map((p) => ({ ...p, fallback: true }))].sort(
    (a, b) => a.category.localeCompare(b.category) || a.order - b.order,
  );
}

export async function getPublished(locale: string, slug: string): Promise<{ post: Post; author: Author | null; reviewer: Author | null } | null> {
  const [post] = await db.select().from(posts).where(and(published(locale), eq(posts.slug, slug)));
  if (!post) return null;
  const ids = [post.authorId, post.reviewerId].filter((x): x is string => !!x);
  const people = ids.length ? await db.select().from(authors).where(inArray(authors.id, ids)) : [];
  return { post, author: people.find((a) => a.id === post.authorId) ?? null, reviewer: people.find((a) => a.id === post.reviewerId) ?? null };
}

export async function translationsOf(translationKey: string): Promise<{ locale: string; slug: string }[]> {
  return db.select({ locale: posts.locale, slug: posts.slug }).from(posts).where(and(eq(posts.translationKey, translationKey), eq(posts.status, "published")));
}

export async function relatedPosts(post: Post, limit = 3): Promise<Post[]> {
  return db
    .select()
    .from(posts)
    .where(and(published(post.locale), eq(posts.category, post.category), ne(posts.id, post.id)))
    .orderBy(asc(posts.order))
    .limit(limit);
}

// Published posts in a locale whose tags overlap `tags` (e.g. metric codes),
// most relevant first.
export async function postsTagged(locale: string, tags: string[], limit = 6, excludeId?: string): Promise<Post[]> {
  if (tags.length === 0) return [];
  const rows = await db
    .select()
    .from(posts)
    .where(and(published(locale), sql`${posts.tags} ?| ${sql.raw(`array[${tags.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")}]`)}`))
    .orderBy(asc(posts.order))
    .limit(limit * 3);
  const score = (p: Post) => p.tags.filter((t) => tags.includes(t)).length;
  return rows
    .filter((p) => p.id !== excludeId)
    .sort((a, b) => score(b) - score(a) || a.order - b.order)
    .slice(0, limit);
}

export async function postByKey(locale: string, translationKey: string): Promise<Post | null> {
  const [p] = await db.select().from(posts).where(and(published(locale), eq(posts.translationKey, translationKey)));
  return p ?? null;
}
