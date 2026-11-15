CREATE TYPE "app"."appointment_status" AS ENUM('pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show');--> statement-breakpoint
CREATE TABLE "app"."appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_name" varchar(120) NOT NULL,
	"customer_phone" varchar(40) NOT NULL,
	"customer_email" varchar(254),
	"notes" varchar(500),
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"service_name" varchar(120) NOT NULL,
	"staff_name" varchar(120) NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"deposit_type" "app"."service_deposit_type" DEFAULT 'none' NOT NULL,
	"deposit_value" integer DEFAULT 0 NOT NULL,
	"status" "app"."appointment_status" DEFAULT 'pending' NOT NULL,
	"status_reason" varchar(500),
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_time_order" CHECK ("app"."appointments"."ends_at" > "app"."appointments"."starts_at"),
	CONSTRAINT "appointments_duration_positive" CHECK ("app"."appointments"."duration_minutes" > 0),
	CONSTRAINT "appointments_buffer_range" CHECK ("app"."appointments"."buffer_minutes" between 0 and 240),
	CONSTRAINT "appointments_price_non_negative" CHECK ("app"."appointments"."price_cents" >= 0),
	CONSTRAINT "appointments_deposit_value_non_negative" CHECK ("app"."appointments"."deposit_value" >= 0),
	CONSTRAINT "appointments_customer_email_lowercase" CHECK ("app"."appointments"."customer_email" is null or "app"."appointments"."customer_email" = lower("app"."appointments"."customer_email"))
);
--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "app"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_tenant_starts_at_idx" ON "app"."appointments" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_tenant_status_starts_at_idx" ON "app"."appointments" USING btree ("tenant_id","status","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_staff_starts_at_idx" ON "app"."appointments" USING btree ("staff_id","starts_at");