const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const dbPath = path.join(__dirname, "..", "campus_event_hub.db");
const db = new Database(dbPath);

db.pragma("foreign_keys = ON");

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL CHECK(role IN ('student', 'organizer', 'admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      organizer_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(organizer_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK(capacity > 0),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, session_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS removal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL,
      requested_by INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      reviewed_by INTEGER,
      review_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS removal_request_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      removal_request_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(removal_request_id) REFERENCES removal_requests(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attendance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL,
      actor_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      method TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
      FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS student_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS support_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      registration_id INTEGER,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(registration_id) REFERENCES registrations(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS support_thread_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(thread_id) REFERENCES support_threads(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  ensureRegistrationColumns();
  seedMissingCheckinCodes();

  seedDefaults();
}

function ensureRegistrationColumns() {
  const columns = db.prepare("PRAGMA table_info(registrations)").all();
  const hasColumn = (name) => columns.some((column) => column.name === name);

  if (!hasColumn("checkin_code")) {
    db.exec("ALTER TABLE registrations ADD COLUMN checkin_code TEXT");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_checkin_code ON registrations(checkin_code)");
  }
  if (!hasColumn("attendance_status")) {
    db.exec("ALTER TABLE registrations ADD COLUMN attendance_status TEXT NOT NULL DEFAULT 'registered'");
  }
  if (!hasColumn("checked_in_at")) {
    db.exec("ALTER TABLE registrations ADD COLUMN checked_in_at TEXT");
  }
}

function generateCheckinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let output = "";
  for (let i = 0; i < 8; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function seedMissingCheckinCodes() {
  const rows = db.prepare("SELECT id FROM registrations WHERE checkin_code IS NULL OR checkin_code = ''").all();
  const update = db.prepare("UPDATE registrations SET checkin_code = ? WHERE id = ?");
  for (const row of rows) {
    let code = generateCheckinCode();
    while (db.prepare("SELECT id FROM registrations WHERE checkin_code = ?").get(code)) {
      code = generateCheckinCode();
    }
    update.run(code, row.id);
  }
}

function seedDefaults() {
  const count = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
  if (count > 0) return;

  const pw = bcrypt.hashSync("Password123!", 10);
  const insert = db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)"
  );
  insert.run("Admin User", "admin@campus.local", pw, "admin");
  const organizer = insert.run("Organizer One", "organizer@campus.local", pw, "organizer");
  insert.run("Student One", "student@campus.local", pw, "student");

  const eventId = db
    .prepare(
      "INSERT INTO events (title, description, location, organizer_id) VALUES (?, ?, ?, ?)"
    )
    .run(
      "Hackathon Weekend",
      "Build projects with peers and mentors in a multi-session event.",
      "Student Center Hall A",
      organizer.lastInsertRowid
    ).lastInsertRowid;

  db.prepare(
    "INSERT INTO sessions (event_id, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?)"
  ).run(eventId, "2026-04-27T09:00:00", "2026-04-27T12:00:00", 50);
}

module.exports = { db, initDb };
