-- Email verification arrived without a mail service configured, so every
-- account created before it had no way to prove its address. Treat the
-- accounts that already exist as verified (keeps CMS access for admins and
-- stops a later Google/Apple sign-in from resetting their credentials); the
-- verification rules apply to accounts created from now on.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;
