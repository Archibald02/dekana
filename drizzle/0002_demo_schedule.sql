CREATE TABLE demo_schedule_changes (
  owner TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  day TEXT NOT NULL,
  start TEXT NOT NULL,
  room TEXT NOT NULL,
  published TEXT NOT NULL
);
