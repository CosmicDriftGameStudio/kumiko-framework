-- Migration 0004_user-roles-multiselect
-- Generated: 2026-08-25
-- Hand-edited: text → jsonb in place (USING), not DROP+rebuild.

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
