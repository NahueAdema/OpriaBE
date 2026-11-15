CREATE TABLE "app"."customer_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_refresh_tokens_expiry_after_creation" CHECK ("app"."customer_refresh_tokens"."expires_at" > "app"."customer_refresh_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "app"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(40) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_lowercase" CHECK ("app"."customers"."email" = lower("app"."customers"."email")),
	CONSTRAINT "customers_phone_length" CHECK (length("app"."customers"."phone") between 6 and 40)
);
--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."tenants" ADD COLUMN "city" varchar(120);--> statement-breakpoint
ALTER TABLE "app"."customer_refresh_tokens" ADD CONSTRAINT "customer_refresh_tokens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_refresh_tokens_hash_unique" ON "app"."customer_refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_refresh_tokens_customer_idx" ON "app"."customer_refresh_tokens" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_refresh_tokens_family_idx" ON "app"."customer_refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "customer_refresh_tokens_expires_idx" ON "app"."customer_refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_unique" ON "app"."customers" USING btree ("email");--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_customer_starts_at_idx" ON "app"."appointments" USING btree ("customer_id","starts_at");