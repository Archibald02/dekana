ALTER TABLE sessions ADD COLUMN demo_scope TEXT;
--> statement-breakpoint
ALTER TABLE demo_schedule_changes ADD COLUMN new_start TEXT;
--> statement-breakpoint
CREATE TABLE application_messages (
  id INTEGER PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  kind TEXT NOT NULL CHECK(kind IN ('question','answer')),
  message TEXT NOT NULL,
  created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX messages_application ON application_messages(application_id, id DESC);
--> statement-breakpoint
CREATE TABLE consultation_bookings (
  scope TEXT NOT NULL,
  slot TEXT NOT NULL,
  owner TEXT NOT NULL,
  PRIMARY KEY(scope,slot),
  UNIQUE(scope,owner)
);
--> statement-breakpoint
CREATE TABLE study_checks (
  owner TEXT NOT NULL,
  step TEXT NOT NULL,
  PRIMARY KEY(owner,step)
);
