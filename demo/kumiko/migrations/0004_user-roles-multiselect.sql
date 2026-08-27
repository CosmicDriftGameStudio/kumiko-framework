-- Migration 0004_user-roles-multiselect
-- Generated: 2026-08-25
-- Hand-edited: text → jsonb in place (USING), not DROP+rebuild.
-- Corrupt / non-JSON rows fall back to [] (fw#2410); double-encoded JSON
-- strings are normalized to arrays so roles @> checks keep matching.

CREATE OR REPLACE FUNCTION pg_temp.kumiko_roles_text_to_jsonb(raw text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  parsed jsonb;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN '[]'::jsonb;
  END IF;
  BEGIN
    parsed := raw::jsonb;
  EXCEPTION WHEN others THEN
    RETURN '[]'::jsonb;
  END;
  IF jsonb_typeof(parsed) = 'array' THEN
    RETURN parsed;
  END IF;
  -- Double-encoded legacy: ""[\"SystemAdmin\"]"" → jsonb string of JSON text
  IF jsonb_typeof(parsed) = 'string' THEN
    BEGIN
      parsed := (parsed #>> '{}')::jsonb;
      IF jsonb_typeof(parsed) = 'array' THEN
        RETURN parsed;
      END IF;
    EXCEPTION WHEN others THEN
      RETURN '[]'::jsonb;
    END;
  END IF;
  RETURN '[]'::jsonb;
END;
$$;

-- === Changed tables ===
-- read_users.roles: text → jsonb string[] (multiSelect)
ALTER TABLE "read_users"
  ALTER COLUMN "roles" DROP DEFAULT,
  ALTER COLUMN "roles" TYPE jsonb USING (
    pg_temp.kumiko_roles_text_to_jsonb("roles"::text)
  ),
  ALTER COLUMN "roles" SET DEFAULT '[]'::jsonb,
  ALTER COLUMN "roles" SET NOT NULL;

DROP FUNCTION pg_temp.kumiko_roles_text_to_jsonb(text);
