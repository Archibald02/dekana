ALTER TABLE applications ADD COLUMN started_at INTEGER;
--> statement-breakpoint
ALTER TABLE applications ADD COLUMN resolved_at INTEGER;
--> statement-breakpoint
ALTER TABLE applications ADD COLUMN reply TEXT NOT NULL DEFAULT '';
