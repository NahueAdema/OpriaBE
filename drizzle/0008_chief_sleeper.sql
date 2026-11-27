CREATE TYPE "app"."notification_log_outcome" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TABLE "app"."notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"type" varchar(80) NOT NULL,
	"recipient" varchar(254) NOT NULL,
	"outcome" "app"."notification_log_outcome" NOT NULL,
	"attempt" integer NOT NULL,
	"error" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."notification_jobs" ADD COLUMN "appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."notification_jobs" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."notification_log" ADD CONSTRAINT "notification_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_log" ADD CONSTRAINT "notification_log_job_id_notification_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "app"."notification_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_log_tenant_created_idx" ON "app"."notification_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_log_job_idx" ON "app"."notification_log" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "app"."notification_jobs" ADD CONSTRAINT "notification_jobs_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "app"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_jobs_appointment_idx" ON "app"."notification_jobs" USING btree ("appointment_id","type");