import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function localDB(path = ':memory:') {
  const db = new DatabaseSync(path);
  const directory = new URL('../drizzle/', import.meta.url);
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', directory), 'utf8'));
  const adopted = db.prepare("SELECT name FROM sqlite_master WHERE name = 'sessions'").get();
  let version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === 0 && adopted) version = 1;
  for (const {idx, tag} of journal.entries.slice(version)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(new URL(tag + '.sql', directory), 'utf8'));
      db.exec('PRAGMA user_version = ' + (idx + 1));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return { bind(...args) {
        return { async first(){return statement.get(...args)}, async all(){return {results:statement.all(...args)}}, async run(){return statement.run(...args)} };
      }};
    },
    close(){db.close()}
  };
}
