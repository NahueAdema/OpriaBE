CREATE TYPE "app"."service_deposit_type" AS ENUM('none', 'fixed', 'percentage');--> statement-breakpoint
CREATE TYPE "app"."cancellation_deposit_policy" AS ENUM('retain', 'refund');--> statement-breakpoint
CREATE TABLE "app"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(1000),
	"duration_minutes" integer NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"deposit_type" "app"."service_deposit_type" DEFAULT 'none' NOT NULL,
	"deposit_value" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_duration_positive" CHECK ("app"."services"."duration_minutes" > 0),
	CONSTRAINT "services_price_non_negative" CHECK ("app"."services"."price_cents" >= 0),
	CONSTRAINT "services_deposit_value_non_negative" CHECK ("app"."services"."deposit_value" >= 0),
	CONSTRAINT "services_percentage_deposit_range" CHECK ("app"."services"."deposit_type" <> 'percentage' or "app"."services"."deposit_value" <= 100),
	CONSTRAINT "services_none_deposit_zero" CHECK ("app"."services"."deposit_type" <> 'none' or "app"."services"."deposit_value" = 0)
);
--> statement-breakpoint
CREATE TABLE "app"."staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"name" varchar(120) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."staff_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."time_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_blocks_time_order" CHECK ("app"."time_blocks"."ends_at" > "app"."time_blocks"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "app"."working_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_hours_weekday_range" CHECK ("app"."working_hours"."weekday" between 1 and 7),
	CONSTRAINT "working_hours_time_order" CHECK ("app"."working_hours"."start_time" < "app"."working_hours"."end_time")
);
--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD COLUMN "logo_url" varchar(2048);--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD COLUMN "address" varchar(255);--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD COLUMN "contact_email" varchar(320);--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD COLUMN "contact_phone" varchar(32);--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD COLUMN "cancellation_deposit_policy" "app"."cancellation_deposit_policy" DEFAULT 'retain' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD COLUMN "booking_min_advance_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD COLUMN "booking_max_advance_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."services" ADD CONSTRAINT "services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."staff" ADD CONSTRAINT "staff_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."staff" ADD CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."staff_services" ADD CONSTRAINT "staff_services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."staff_services" ADD CONSTRAINT "staff_services_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "app"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."staff_services" ADD CONSTRAINT "staff_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."time_blocks" ADD CONSTRAINT "time_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."time_blocks" ADD CONSTRAINT "time_blocks_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "app"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."working_hours" ADD CONSTRAINT "working_hours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."working_hours" ADD CONSTRAINT "working_hours_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "app"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "services_tenant_active_idx" ON "app"."services" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "staff_tenant_active_idx" ON "app"."staff" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_tenant_user_unique" ON "app"."staff" USING btree ("tenant_id","user_id") WHERE "app"."staff"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_services_unique" ON "app"."staff_services" USING btree ("staff_id","service_id");--> statement-breakpoint
CREATE INDEX "staff_services_tenant_service_idx" ON "app"."staff_services" USING btree ("tenant_id","service_id");--> statement-breakpoint
CREATE INDEX "time_blocks_staff_range_idx" ON "app"."time_blocks" USING btree ("staff_id","starts_at");--> statement-breakpoint
CREATE INDEX "working_hours_staff_weekday_idx" ON "app"."working_hours" USING btree ("staff_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "working_hours_unique" ON "app"."working_hours" USING btree ("staff_id","weekday","start_time","end_time");--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD CONSTRAINT "tenants_booking_min_advance_non_negative" CHECK ("app"."tenants"."booking_min_advance_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD CONSTRAINT "tenants_booking_max_advance_positive" CHECK ("app"."tenants"."booking_max_advance_days" > 0);--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD CONSTRAINT "tenants_contact_email_lowercase" CHECK ("app"."tenants"."contact_email" is null or "app"."tenants"."contact_email" = lower("app"."tenants"."contact_email"));