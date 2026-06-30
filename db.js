// SQLite data layer (better-sqlite3 — synchronous, fast, single-file).
// Replaces the previous flat-file JSON stores. Listing projects no longer
// reads/parses every project's full payload: metadata columns are denormalised
// so the list query never touches the large `data` blob.
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'cologic.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // better concurrency + crash safety
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id        TEXT PRIMARY KEY,
  email     TEXT UNIQUE NOT NULL,
  password  TEXT NOT NULL,
  name      TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  name       TEXT,
  client     TEXT,
  data       TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner);
`);

const clientOf = (data) => (data && data.form && data.form.fields && data.form.fields.f_client) || '';

// One-time migration from the legacy JSON files (only runs while tables empty).
function migrateFromJson() {
    try {
        if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0) {
            const f = path.join(__dirname, 'users.json');
            if (fs.existsSync(f)) {
                const arr = JSON.parse(fs.readFileSync(f, 'utf8') || '[]');
                const ins = db.prepare('INSERT OR IGNORE INTO users (id, email, password, name) VALUES (?, ?, ?, ?)');
                const tx = db.transaction(rows => rows.forEach(u =>
                    ins.run(String(u.id || Date.now()), u.email, u.password, u.name || 'User')));
                tx(arr);
                if (arr.length) console.log(`Migrated ${arr.length} user(s) from users.json into SQLite.`);
            }
        }
        if (db.prepare('SELECT COUNT(*) AS c FROM projects').get().c === 0) {
            const f = path.join(__dirname, 'projects.json');
            if (fs.existsSync(f)) {
                const arr = JSON.parse(fs.readFileSync(f, 'utf8') || '[]');
                const ins = db.prepare('INSERT OR IGNORE INTO projects (id, owner, name, client, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
                const tx = db.transaction(rows => rows.forEach(p => {
                    const now = new Date().toISOString();
                    ins.run(String(p.id), p.owner, p.name || 'Untitled Project', clientOf(p.data),
                        JSON.stringify(p.data || {}), p.createdAt || now, p.updatedAt || now);
                }));
                tx(arr);
                if (arr.length) console.log(`Migrated ${arr.length} project(s) from projects.json into SQLite.`);
            }
        }
    } catch (e) {
        console.warn('JSON migration skipped:', e.message);
    }
}
migrateFromJson();

// Prepared statements (compiled once, reused).
const stmts = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    createUser: db.prepare('INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)'),
    updatePassword: db.prepare('UPDATE users SET password = ? WHERE id = ?'),
    listProjects: db.prepare('SELECT id, name, client, updated_at AS updatedAt FROM projects WHERE owner = ? ORDER BY updated_at DESC'),
    getProject: db.prepare('SELECT * FROM projects WHERE id = ? AND owner = ?'),
    findProject: db.prepare('SELECT id FROM projects WHERE id = ? AND owner = ?'),
    insertProject: db.prepare('INSERT INTO projects (id, owner, name, client, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    updateProject: db.prepare('UPDATE projects SET name = ?, client = ?, data = ?, updated_at = ? WHERE id = ? AND owner = ?'),
    deleteProject: db.prepare('DELETE FROM projects WHERE id = ? AND owner = ?')
};

module.exports = {
    getUserByEmail: (email) => stmts.userByEmail.get(email),
    createUser: (u) => stmts.createUser.run(u.id, u.email, u.password, u.name),
    updateUserPassword: (id, password) => stmts.updatePassword.run(password, id),

    listProjects: (owner) => stmts.listProjects.all(owner),
    getProject: (id, owner) => {
        const row = stmts.getProject.get(id, owner);
        if (!row) return null;
        return {
            id: row.id, owner: row.owner, name: row.name,
            createdAt: row.created_at, updatedAt: row.updated_at,
            data: JSON.parse(row.data || '{}')
        };
    },
    upsertProject: ({ id, owner, name, data }) => {
        const now = new Date().toISOString();
        const client = clientOf(data);
        const json = JSON.stringify(data);
        if (id && stmts.findProject.get(id, owner)) {
            stmts.updateProject.run(name, client, json, now, id, owner);
            return { id, updatedAt: now };
        }
        const newId = Date.now().toString();
        stmts.insertProject.run(newId, owner, name, client, json, now, now);
        return { id: newId, updatedAt: now };
    },
    deleteProject: (id, owner) => stmts.deleteProject.run(id, owner).changes
};
