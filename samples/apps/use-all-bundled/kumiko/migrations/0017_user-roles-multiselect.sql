-- Migration 0017_user-roles-multiselect
-- Generated: 2026-08-25T09:46:19.755Z
-- Hand-edited: text → jsonb in place (USING), not DROP+rebuild.
-- Existing JSON array strings (`[]`, `["SystemAdmin"]`) convert cleanly.

-- === Changed tables ===
-- read_users.roles: text → jsonb string[] (multiSelect)
ALTER TABLE "read_users"
  ALTER COLUMN "roles" DROP DEFAULT,
  ALTER COLUMN "roles" TYPE jsonb USING (
    CASE
      WHEN "roles" IS NULL OR btrim("roles"::text) = '' THEN '[]'::jsonb
      ELSE "roles"::jsonb
    END
  ),
  ALTER COLUMN "roles" SET DEFAULT '[]'::jsonb,
  ALTER COLUMN "roles" SET NOT NULL;
