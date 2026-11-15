CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."membership_role" AS ENUM('owner', 'admin', 'staff', 'customer');--> statement-breakpoint
CREATE TYPE "app"."tenant_plan" AS ENUM('free', 'pro', 'business');--> statement-breakpoint
CREATE TYPE "app"."tenant_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TABLE "app"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app"."membership_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(63) NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	"plan" "app"."tenant_plan" DEFAULT 'free' NOT NULL,
	"status" "app"."tenant_status" DEFAULT 'active' NOT NULL,
	"cancellation_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_format" CHECK ("app"."tenants"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "tenants_cancellation_hours_non_negative" CHECK ("app"."tenants"."cancellation_hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(120) NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("app"."users"."email" = lower("app"."users"."email"))
);
--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_unique" ON "app"."memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "app"."memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_unique" ON "app"."tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "app"."users" USING btree ("email");