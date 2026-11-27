CREATE TABLE "app"."appointment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"appointment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_requests_key_length" CHECK (length("app"."appointment_requests"."idempotency_key") >= 8)
);
--> statement-breakpoint
CREATE TABLE "app"."customer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"name" varchar(120) NOT NULL,
	"phone" varchar(40) NOT NULL,
	"email" varchar(254),
	"notes" varchar(2000),
	"consent_at" timestamp with time zone,
	"consent_source" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_profiles_phone_length" CHECK (length("app"."customer_profiles"."phone") between 6 and 40),
	CONSTRAINT "customer_profiles_email_lowercase" CHECK ("app"."customer_profiles"."email" is null or "app"."customer_profiles"."email" = lower("app"."customer_profiles"."email"))
);
--> statement-breakpoint
ALTER TABLE "app"."appointment_requests" ADD CONSTRAINT "appointment_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointment_requests" ADD CONSTRAINT "appointment_requests_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "app"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_profiles" ADD CONSTRAINT "customer_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_profiles" ADD CONSTRAINT "customer_profiles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_requests_tenant_key_uq" ON "app"."appointment_requests" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "appointment_requests_tenant_created_idx" ON "app"."appointment_requests" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_profiles_tenant_phone_uq" ON "app"."customer_profiles" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_profiles_tenant_customer_uq" ON "app"."customer_profiles" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_profiles_tenant_email_idx" ON "app"."customer_profiles" USING btree ("tenant_id","email");