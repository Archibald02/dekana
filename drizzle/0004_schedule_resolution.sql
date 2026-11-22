ALTER TABLE applications ADD COLUMN conflict_event TEXT;
--> statement-breakpoint
ALTER TABLE applications ADD COLUMN conflict_day TEXT;
--> statement-breakpoint
ALTER TABLE applications ADD COLUMN conflict_lesson TEXT;
--> statement-breakpoint
ALTER TABLE applications ADD COLUMN offer_start TEXT;
--> statement-breakpoint
ALTER TABLE applications ADD COLUMN offer_room TEXT;
--> statement-breakpoint
ALTER TABLE applications ADD COLUMN offer_at INTEGER;
--> statement-breakpoint
ALTER TABLE applications ADD COLUMN accepted_at INTEGER;
--> statement-breakpoint
CREATE UNIQUE INDEX active_conflict_application ON applications(owner,conflict_event) WHERE conflict_event IS NOT NULL AND resolved_at IS NULL;
--> statement-breakpoint
CREATE INDEX resolved_schedule ON applications(owner,conflict_day,accepted_at) WHERE accepted_at IS NOT NULL;
