CREATE TYPE "app"."notification_job_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "app"."notification_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(80) NOT NULL,
	"recipient" varchar(254) NOT NULL,
	"payload" jsonb NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "app"."notification_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_jobs_attempts_non_negative" CHECK ("app"."notification_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."notification_jobs" ADD CONSTRAINT "notification_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_jobs_dedupe_key_uq" ON "app"."notification_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_jobs_tenant_scheduled_idx" ON "app"."notification_jobs" USING btree ("tenant_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "notification_jobs_status_scheduled_idx" ON "app"."notification_jobs" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "notification_jobs_locked_at_idx" ON "app"."notification_jobs" USING btree ("locked_at");