// MoveVitals data model.
//
// Provenance is a first-class concern: every value we store can be traced to
// (1) the connection/channel it arrived through (`provider`),
// (2) the device or app that originally recorded it (`origin`), and
// (3) the raw payload it was parsed from (`rawRecordId`; refreshed in place when upstream revises a record).
// Values from different sources are never overwritten; they are kept side by
// side and a resolution layer (daily_metrics / activity_groups) records which
// candidate won and why.

import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // Null for accounts created through Google/Apple sign-in.
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  name: text("name"),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  units: text("units").notNull().default("metric"), // metric | imperial (display only)
  // Small square image as a data URL (resized client-side to 256 px).
  avatar: text("avatar"),
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
  // Cross-device cloud sync. When off, the mobile app keeps on-device data
  // (HealthKit, Bluetooth sensors) local and the ingest API refuses uploads.
  cloudSync: boolean("cloud_sync").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// External identities used to sign in (Google today, Apple next).
export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // google | apple
    subject: text("subject").notNull(), // the provider's stable user id ("sub")
    email: text("email"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("auth_accounts_provider_subject_uq").on(t.provider, t.subject), index("auth_accounts_user_idx").on(t.userId)],
);

// Pending sign-in round trips (state + PKCE verifier), short-lived.
export const loginStates = pgTable("login_states", {
  state: text("state").primaryKey(),
  provider: text("provider").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  // "web" sets a session cookie; "app" hands a token back to the iOS app.
  client: text("client").notNull().default("web"),
  // Signed-in user linking a new identity from settings.
  linkUserId: uuid("link_user_id").references(() => users.id, { onDelete: "cascade" }),
  // sha256 of the one-time httpOnly cookie set when the round trip started.
  nonceHash: text("nonce_hash"),
  createdAt: createdAt(),
});

// Database backups written by the worker (see lib/backup.ts).
export const backups = pgTable("backups", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("running"), // running | ok | failed
  storage: text("storage").notNull(), // s3 | local
  location: text("location"), // object key or file path
  // Encrypted backups can exceed 2 GiB, so this is a bigint (read back as a JS number).
  bytes: bigint("bytes", { mode: "number" }),
  tables: integer("tables"),
  rows: integer("rows"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

// Rarely-changing personal attributes (height, date of birth, max HR…),
// each with the source that set it. A value the user entered by hand is
// never overwritten by a device sync.
export const userAttributes = pgTable(
  "user_attributes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // see lib/attributes.ts
    value: text("value").notNull(),
    source: text("source").notNull().default("manual"), // manual | apple_health | …
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const sessions = pgTable(
  "sessions",
  {
    // sha256 of the cookie token; the raw token is never stored.
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// Personal API tokens: used by the future iOS app and scripts to push data.
export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // "personal" tokens are made in settings; "app" tokens are issued at mobile sign-in.
  kind: text("kind").notNull().default("personal"),
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  // "app" tokens expire after a period of inactivity (rolling, see lib/auth.ts);
  // null means the token never expires (personal tokens and tokens issued
  // before expiry existed, which start rolling on their next use).
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// One-time e-mail verification tokens (sha256 of the emailed token).
export const emailTokens = pgTable(
  "email_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // The address the token proves; a later e-mail change invalidates it.
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("email_tokens_user_idx").on(t.userId)],
);

// Fixed-window counters shared by every web/worker process (see lib/ratelimit.ts).
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

// Cross-process leases for jobs that must not overlap (sync per connection,
// token refresh, backups). See lib/locks.ts.
export const jobLocks = pgTable("job_locks", {
  key: text("key").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------
// Connections to external platforms
// ---------------------------------------------------------------------------

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalUserId: text("external_user_id"),
    displayName: text("display_name"),
    // AES-256-GCM encrypted, see lib/crypto.ts
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes"),
    status: text("status").notNull().default("active"), // active | error | revoked
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    // Per-resource incremental sync cursors, e.g. { workouts: "2026-10-01T00:00:00Z" }
    cursor: jsonb("cursor").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("connections_user_provider_uq").on(t.userId, t.provider),
    index("connections_provider_external_idx").on(t.provider, t.externalUserId),
  ],
);

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  codeVerifier: text("code_verifier"),
  // Binds the round trip to the browser that started it: sha256 of a one-time
  // httpOnly cookie, and the id of the session that was signed in at the time.
  nonceHash: text("nonce_hash"),
  sessionId: text("session_id"),
  // Adapter-specific context carried to the callback (e.g. COROS region).
  extra: jsonb("extra").$type<Record<string, string>>(),
  createdAt: createdAt(),
});

// OAuth clients registered at runtime through RFC 7591 dynamic client
// registration (COROS MCP), one per provider, authorization server and
// redirect URI. Secrets are encrypted like tokens.
export const oauthClients = pgTable(
  "oauth_clients",
  {
    provider: text("provider").notNull(),
    issuer: text("issuer").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    clientId: text("client_id").notNull(),
    clientSecretEnc: text("client_secret_enc"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.issuer, t.redirectUri] })],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(), // initial | manual | schedule | webhook
    status: text("status").notNull().default("running"), // running | ok | error
    stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sync_runs_connection_idx").on(t.connectionId, t.startedAt)],
);

// Inbox for webhook deliveries; processed asynchronously by the worker.
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    externalUserId: text("external_user_id"),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"), // pending | done | error | ignored
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("webhook_events_status_idx").on(t.status, t.receivedAt)],
);

// ---------------------------------------------------------------------------
// Provenance: devices and raw payloads
// ---------------------------------------------------------------------------

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // Normalised key, e.g. "polar:h10" or "coros:vertix 2"
    key: text("key").notNull(),
    brand: text("brand"),
    model: text("model"),
    kind: text("kind"), // watch | band | chest_strap | ring | scale | trainer | bike_computer | app | phone
    firstSeenAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("devices_user_key_uq").on(t.userId, t.key)],
);

// Archive of everything fetched from upstream. Lets us re-parse history when
// mappings improve, and is the audit trail for every value. Rows are keyed by
// (user, provider, resource type, external id) and refreshed in place when the
// upstream record changes (scores are revised after the fact); `payloadHash`
// and `fetchedAt` show when the stored payload last changed.
export const rawRecords = pgTable(
  "raw_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    resourceType: text("resource_type").notNull(),
    externalId: text("external_id").notNull(),
    payload: jsonb("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("raw_records_uq").on(t.userId, t.provider, t.resourceType, t.externalId)],
);

// ---------------------------------------------------------------------------
// Normalised data
// ---------------------------------------------------------------------------

// One measured value from one source. Many observations may describe the same
// thing (e.g. HRV from Whoop and from Oura on the same night).
export const observations = pgTable(
  "observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(), // see lib/metrics.ts
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    // daily: a value summarising a calendar day; session: e.g. one sleep; sample: point-in-time
    granularity: text("granularity").notNull(),
    day: date("day"), // user-local calendar day the value belongs to
    startTime: timestamp("start_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }),
    provider: text("provider").notNull(),
    origin: text("origin"), // original recorder when relayed (e.g. "Zwift" via Strava)
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    externalId: text("external_id").notNull(),
    rawRecordId: uuid("raw_record_id").references(() => rawRecords.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("observations_uq").on(t.userId, t.provider, t.metric, t.externalId),
    index("observations_user_metric_day_idx").on(t.userId, t.metric, t.day),
  ],
);

export type CandidateValue = { provider: string; origin?: string | null; value: number; observationId: string };

// Resolved per-day view: one row per (user, day, metric) with the selected
// value, every candidate and whether the sources disagree.
export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    selectedProvider: text("selected_provider").notNull(),
    selectedObservationId: uuid("selected_observation_id").references(() => observations.id, { onDelete: "set null" }),
    method: text("method").notNull(), // single | priority | manual
    candidates: jsonb("candidates").$type<CandidateValue[]>().notNull(),
    hasConflict: boolean("has_conflict").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.metric] }), index("daily_metrics_conflict_idx").on(t.userId, t.hasConflict)],
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    origin: text("origin"),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    groupId: uuid("group_id").references((): AnyPgColumn => activityGroups.id, { onDelete: "set null" }),
    // Set when the user split this activity out of a group by hand; automatic
    // grouping never merges it back (see groupActivity in lib/resolve.ts).
    manualSplit: boolean("manual_split").notNull().default(false),
    name: text("name"),
    sport: text("sport").notNull(), // see lib/sports.ts
    sportRaw: text("sport_raw"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    utcOffsetMinutes: integer("utc_offset_minutes"),
    movingSeconds: integer("moving_seconds"),
    elapsedSeconds: integer("elapsed_seconds"),
    distanceM: doublePrecision("distance_m"),
    elevationGainM: doublePrecision("elevation_gain_m"),
    avgHr: doublePrecision("avg_hr"),
    maxHr: doublePrecision("max_hr"),
    avgPower: doublePrecision("avg_power"),
    normalizedPower: doublePrecision("normalized_power"),
    avgCadence: doublePrecision("avg_cadence"),
    avgSpeed: doublePrecision("avg_speed"),
    calories: doublePrecision("calories"),
    strain: doublePrecision("strain"),
    trainingLoad: doublePrecision("training_load"),
    hasStreams: boolean("has_streams").notNull().default(false),
    rawRecordId: uuid("raw_record_id").references(() => rawRecords.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("activities_uq").on(t.userId, t.provider, t.externalId),
    index("activities_user_time_idx").on(t.userId, t.startTime),
    index("activities_group_idx").on(t.groupId),
  ],
);

export type FieldSource = { value: number | string | null; provider: string; activityId: string };

// The same real-world workout reported by several sources. `merged` holds the
// winning value of each field together with the source it came from.
export const activityGroups = pgTable(
  "activity_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sport: text("sport").notNull(),
    name: text("name"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    primaryActivityId: uuid("primary_activity_id").references((): AnyPgColumn => activities.id, { onDelete: "set null" }),
    merged: jsonb("merged").$type<Record<string, FieldSource>>().notNull().default({}),
    memberCount: integer("member_count").notNull().default(1),
    hasConflict: boolean("has_conflict").notNull().default(false),
    // When set, the user pinned this activity as the source of truth.
    manualPrimaryActivityId: uuid("manual_primary_activity_id").references((): AnyPgColumn => activities.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [index("activity_groups_user_time_idx").on(t.userId, t.startTime)],
);

export const activityStreams = pgTable("activity_streams", {
  activityId: uuid("activity_id")
    .primaryKey()
    .references(() => activities.id, { onDelete: "cascade" }),
  // { time: number[], heartrate?: number[], watts?: number[], ... }
  streams: jsonb("streams").$type<Record<string, number[] | [number, number][]>>().notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// User preferences
// ---------------------------------------------------------------------------

// Ordered provider preference per scope. scope is a metric code
// (e.g. "hrv_rmssd"), a metric category ("sleep") or an activity field
// ("activity.avg_power").
export const sourcePriorities = pgTable(
  "source_priorities",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    providers: jsonb("providers").$type<string[]>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.scope] })],
);

// A per-day manual choice that beats all priority rules.
export const dailyOverrides = pgTable(
  "daily_overrides",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    metric: text("metric").notNull(),
    provider: text("provider").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.metric] })],
);

export const aiSettings = pgTable("ai_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // anthropic | openai_compatible
  baseUrl: text("base_url"),
  model: text("model").notNull(),
  apiKeyEnc: text("api_key_enc").notNull(),
  // Providers whose data may be sent to the model. Restricted providers
  // (see registry `aiRestricted`) are excluded unless explicitly listed.
  allowedProviders: jsonb("allowed_providers").$type<string[] | null>(),
  // What else may leave the app besides provider data.
  includeProfile: boolean("include_profile").notNull().default(true), // age, sex, height, max HR, FTP
  includeLabs: boolean("include_labs").notNull().default(false), // Body Lab biomarker values
  includeNames: boolean("include_names").notNull().default(true), // free-text workout titles
  updatedAt: updatedAt(),
});

// Public submissions from the Integrations page: a device someone wants
// supported, or an offer to contribute an open-source integration.
export const integrationRequests = pgTable(
  "integration_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // request | contribute
    device: text("device").notNull(),
    link: text("link"),
    email: text("email"),
    message: text("message"),
    locale: text("locale"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    ipHash: text("ip_hash"),
    status: text("status").notNull().default("new"), // new | planned | done | declined
    createdAt: createdAt(),
  },
  (t) => [index("integration_requests_created_idx").on(t.createdAt), index("integration_requests_ip_idx").on(t.ipHash, t.createdAt)],
);

// ---------------------------------------------------------------------------
// CMS: guides / articles
// ---------------------------------------------------------------------------

// Bylines with credentials (E-E-A-T for health content).
export const authors = pgTable("authors", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  role: text("role"), // e.g. "Sports scientist, CSCS"
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  url: text("url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// One row per article per language. Rows sharing `translationKey` are
// translations of each other (used for hreflang and the language switcher).
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    translationKey: text("translation_key").notNull(),
    locale: text("locale").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    body: text("body").notNull().default(""), // Markdown
    category: text("category").notNull(), // see lib/content.ts CATEGORIES
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    coverUrl: text("cover_url"),
    authorId: uuid("author_id").references(() => authors.id, { onDelete: "set null" }),
    reviewerId: uuid("reviewer_id").references(() => authors.id, { onDelete: "set null" }),
    status: text("status").notNull().default("draft"), // draft | published
    featured: boolean("featured").notNull().default(false),
    order: integer("sort_order").notNull().default(100), // position in the sidebar
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    readingMinutes: integer("reading_minutes").notNull().default(1),
    // Hash of the repo file this row was seeded from; cleared when edited in
    // the CMS so later repo updates never overwrite human edits.
    seedHash: text("seed_hash"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("posts_locale_slug_uq").on(t.locale, t.slug),
    uniqueIndex("posts_translation_locale_uq").on(t.translationKey, t.locale),
    index("posts_listing_idx").on(t.locale, t.status, t.category, t.order),
  ],
);

// Images uploaded through the CMS, served from /api/media/<id>.
export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  data: text("data").notNull(), // base64
  width: integer("width"),
  height: integer("height"),
  bytes: integer("bytes").notNull(),
  alt: text("alt"),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Body Lab: lab reports and biomarker results
// ---------------------------------------------------------------------------

export type ExtractedMarker = { marker: string; printed: string; value: number; unit: string; refLow?: number | null; refHigh?: number | null; takenOn?: string | null };

// An uploaded lab report, check-up or doctor's letter. The file is stored
// encrypted (base64 inside the app's AES-GCM envelope).
export const labReports = pgTable(
  "lab_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // lab | checkup | doctor
    title: text("title").notNull(),
    takenOn: date("taken_on"),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    fileEnc: text("file_enc").notNull(),
    // pending → extracted (awaiting confirmation) → confirmed; or stored (no extraction) / failed.
    status: text("status").notNull().default("stored"),
    extracted: jsonb("extracted").$type<ExtractedMarker[] | null>(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("lab_reports_user_idx").on(t.userId, t.createdAt)],
);

// One biomarker value, stored in the marker's canonical unit. The reference
// range printed on the report, when given, wins over our default range.
export const labResults = pgTable(
  "lab_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    marker: text("marker").notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    refLow: doublePrecision("ref_low"),
    refHigh: doublePrecision("ref_high"),
    takenOn: date("taken_on").notNull(),
    source: text("source").notNull(), // manual | report
    reportId: uuid("report_id").references(() => labReports.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("lab_results_user_marker_idx").on(t.userId, t.marker, t.takenOn)],
);
