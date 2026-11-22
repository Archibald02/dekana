ALTER TABLE applications ADD COLUMN submission_id TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX application_submission ON applications(owner, submission_id) WHERE submission_id IS NOT NULL;
