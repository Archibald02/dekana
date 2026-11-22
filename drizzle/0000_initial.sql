CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, student TEXT NOT NULL, expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX session_expiry ON sessions(expires);
--> statement-breakpoint
CREATE TABLE applications (id TEXT PRIMARY KEY, owner TEXT NOT NULL, type TEXT NOT NULL, note TEXT NOT NULL, created INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX application_owner ON applications(owner, created DESC);
--> statement-breakpoint
CREATE TABLE notices_read (owner TEXT NOT NULL, notice TEXT NOT NULL, PRIMARY KEY(owner, notice));
--> statement-breakpoint
CREATE TABLE login_limits (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX login_expiry ON login_limits(expires);
