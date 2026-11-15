-- Hard anti-double-booking guard. Only pending and confirmed appointments
-- block their time range; rejected, cancelled, completed and no-show rows are
-- excluded from the constraint, so rejecting a request frees the slot.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_no_overlap" EXCLUDE USING gist ("staff_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" IN ('pending', 'confirmed'));
