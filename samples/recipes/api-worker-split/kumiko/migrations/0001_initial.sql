-- API/Worker-Split sample: entity tables for the orders feature.
-- Framework infra tables (kumiko_events, consumer state, projections) are
-- created idempotently by `kumiko schema apply` before this runs.
CREATE TABLE IF NOT EXISTS "read_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "modified_at" timestamp with time zone,
  "inserted_by_id" text,
  "modified_by_id" text,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "deleted_at" timestamp with time zone,
  "deleted_by_id" text,
  "customer_name" text NOT NULL,
  "amount" numeric NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL
);
CREATE INDEX IF NOT EXISTS "read_orders_tenant_id_idx" ON "read_orders" ("tenant_id");

CREATE TABLE IF NOT EXISTS "read_fulfillments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "modified_at" timestamp with time zone,
  "inserted_by_id" text,
  "modified_by_id" text,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "deleted_at" timestamp with time zone,
  "deleted_by_id" text,
  "order_key" text NOT NULL,
  "carrier" text NOT NULL,
  "label" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "read_fulfillments_tenant_id_idx" ON "read_fulfillments" ("tenant_id");

CREATE TABLE IF NOT EXISTS "read_order_activity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "order_key" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "read_order_activity_tenant_id_idx" ON "read_order_activity" ("tenant_id");
