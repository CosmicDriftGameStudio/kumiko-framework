CREATE TABLE "kumiko_archived_streams" (
	"tenant_id" uuid NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"archived_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"archived_by" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "kumiko_event_consumers" (
	"name" text NOT NULL,
	"instance_id" text DEFAULT '__shared__' NOT NULL,
	"last_processed_event_id" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kumiko_event_consumers_name_instance_id_pk" PRIMARY KEY("name","instance_id")
);
--> statement-breakpoint
CREATE TABLE "kumiko_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kumiko_projections" (
	"name" text PRIMARY KEY NOT NULL,
	"last_processed_event_id" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_rebuild_at" timestamp(3) with time zone,
	"last_error" text,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kumiko_snapshots" (
	"aggregate_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"version" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kumiko_snapshots_aggregate_id_version_pk" PRIMARY KEY("aggregate_id","version")
);
--> statement-breakpoint
CREATE TABLE "read_cap_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"cap_name" text NOT NULL,
	"value" integer NOT NULL,
	"period_start" timestamptz NOT NULL,
	"last_soft_warned_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE "read_config_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"key" text NOT NULL,
	"value" text,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "read_delivery_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notification_type" text NOT NULL,
	"channel" text NOT NULL,
	"recipient_id" text,
	"recipient_address" text,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_download_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"result" text NOT NULL,
	"via" text NOT NULL,
	"token_hash" text,
	"job_id" text,
	"attempted_by_user_id" text,
	"ip" text,
	"user_agent" text,
	"attempted_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_export_download_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"job_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"issued_at" timestamptz NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"last_used_at" timestamptz,
	"use_count" bigint,
	"last_used_from_ip" text,
	"last_used_user_agent" text
);
--> statement-breakpoint
CREATE TABLE "read_export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"user_id" text NOT NULL,
	"requested_from_tenant_id" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamptz NOT NULL,
	"started_at" timestamptz,
	"completed_at" timestamptz,
	"download_storage_key" text,
	"expires_at" timestamptz,
	"error_message" text,
	"bytes_written" bigint
);
--> statement-breakpoint
CREATE TABLE "read_custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"entity_name" text NOT NULL,
	"field_key" text NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"searchable" boolean DEFAULT false NOT NULL,
	"display_order" integer NOT NULL,
	"serialized_field" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"field_name" text
);
--> statement-breakpoint
CREATE TABLE "read_job_run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"timestamp" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"job_name" text NOT NULL,
	"bull_job_id" text NOT NULL,
	"status" text NOT NULL,
	"payload" text,
	"error" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamptz NOT NULL,
	"finished_at" timestamptz,
	"duration" integer,
	"triggered_by_id" text
);
--> statement-breakpoint
CREATE TABLE "read_notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"user_id" text NOT NULL,
	"notification_type" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"provider_name" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"status" text NOT NULL,
	"tier" text NOT NULL,
	"current_period_end" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_template_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"locale" text NOT NULL,
	"content" text,
	"content_format" text NOT NULL,
	"variable_schema" text,
	"linked_resources" text,
	"scope" text NOT NULL,
	"parent_template_id" text,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_tenant_compliance_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"profile_key" text NOT NULL,
	"override" text
);
--> statement-breakpoint
CREATE TABLE "read_tenant_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_tenant_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"user_id" text NOT NULL,
	"roles" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_tenant_retention_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"entity_name" text NOT NULL,
	"config" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_tenant_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"key" text NOT NULL,
	"kek_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_text_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"slug" text NOT NULL,
	"lang" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"folder" text
);
--> statement-breakpoint
CREATE TABLE "read_tier_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"tier" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"user_id" text NOT NULL,
	"created_at" timestamptz NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"revoked_at" timestamptz,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "read_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"inserted_at" timestamptz DEFAULT now() NOT NULL,
	"modified_at" timestamptz,
	"inserted_by_id" text,
	"modified_by_id" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamptz,
	"deleted_by_id" text,
	"email" text NOT NULL,
	"password_hash" text,
	"display_name" text NOT NULL,
	"locale" text DEFAULT 'de',
	"last_active_tenant_id" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"roles" text DEFAULT '[]' NOT NULL,
	"status" text NOT NULL,
	"grace_period_end" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kumiko_archived_streams_pk" ON "kumiko_archived_streams" USING btree ("tenant_id","aggregate_id");--> statement-breakpoint
CREATE INDEX "kumiko_event_consumers_status_idx" ON "kumiko_event_consumers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "events_aggregate_version_uq" ON "kumiko_events" USING btree ("tenant_id","aggregate_id","version");--> statement-breakpoint
CREATE INDEX "events_load_idx" ON "kumiko_events" USING btree ("aggregate_id","version");--> statement-breakpoint
CREATE INDEX "events_tenant_type_idx" ON "kumiko_events" USING btree ("tenant_id","aggregate_type","created_at");--> statement-breakpoint
CREATE INDEX "kumiko_projections_status_idx" ON "kumiko_projections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kumiko_snapshots_latest_idx" ON "kumiko_snapshots" USING btree ("aggregate_id","tenant_id","version");--> statement-breakpoint
CREATE INDEX "read_cap_counters_tenant_id_idx" ON "read_cap_counters" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "read_config_values_tenant_id_idx" ON "read_config_values" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_config_values_unique" ON "read_config_values" USING btree ("key","tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "read_download_attempts_tenant_id_idx" ON "read_download_attempts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "read_export_download_tokens_tenant_id_idx" ON "read_export_download_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_export_download_tokens_one_per_job" ON "read_export_download_tokens" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "read_export_jobs_tenant_id_idx" ON "read_export_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_export_jobs_one_active_per_user" ON "read_export_jobs" USING btree ("user_id") WHERE status IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX "read_custom_field_definitions_tenant_id_idx" ON "read_custom_field_definitions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "file_refs_tenant_id_idx" ON "file_refs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "read_notification_preferences_tenant_id_idx" ON "read_notification_preferences" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "read_subscriptions_tenant_id_idx" ON "read_subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "read_template_resources_tenant_id_idx" ON "read_template_resources" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_template_resources_unique" ON "read_template_resources" USING btree ("tenant_id","slug","kind","locale");--> statement-breakpoint
CREATE INDEX "read_tenant_compliance_profiles_tenant_id_idx" ON "read_tenant_compliance_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_tenant_compliance_profiles_tenant_id_unique" ON "read_tenant_compliance_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "read_tenant_invitations_tenant_id_idx" ON "read_tenant_invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_tenant_invitations_tenant_email_unique" ON "read_tenant_invitations" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "read_tenant_memberships_tenant_id_idx" ON "read_tenant_memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_tenant_memberships_unique" ON "read_tenant_memberships" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "read_tenant_retention_overrides_tenant_id_idx" ON "read_tenant_retention_overrides" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_tenant_retention_overrides_tenant_id_entity_name_unique" ON "read_tenant_retention_overrides" USING btree ("tenant_id","entity_name");--> statement-breakpoint
CREATE INDEX "read_tenant_secrets_tenant_id_idx" ON "read_tenant_secrets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "read_tenants_tenant_id_idx" ON "read_tenants" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_tenants_key_unique" ON "read_tenants" USING btree ("key");--> statement-breakpoint
CREATE INDEX "read_text_blocks_tenant_id_idx" ON "read_text_blocks" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_text_blocks_unique" ON "read_text_blocks" USING btree ("tenant_id","slug","lang");--> statement-breakpoint
CREATE INDEX "read_tier_assignments_tenant_id_idx" ON "read_tier_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "read_user_sessions_tenant_id_idx" ON "read_user_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "read_users_tenant_id_idx" ON "read_users" USING btree ("tenant_id");