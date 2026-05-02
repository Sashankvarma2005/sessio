require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const { db, initDb } = require("./db");
const { signToken, requireAuth, requireRole } = require("./auth");

const app = express();
const port = process.env.PORT || 4000;

initDb();

app.use(
  cors({
    origin: /^http:\/\/localhost:\d+$/,
  })
);
app.use(express.json());

function mapSessionWithSeats(session) {
  const filled = db
    .prepare("SELECT COUNT(*) as count FROM registrations WHERE session_id = ?")
    .get(session.id).count;
  return { ...session, filledSeats: filled, availableSeats: session.capacity - filled };
}

function generateCheckinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let output = "";
  for (let i = 0; i < 8; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function uniqueCheckinCode() {
  let code = generateCheckinCode();
  while (db.prepare("SELECT id FROM registrations WHERE checkin_code = ?").get(code)) {
    code = generateCheckinCode();
  }
  return code;
}

function buildCheckinPayload(registrationId, checkinCode) {
  return `SESSIO-CHECKIN:${registrationId}:${checkinCode}`;
}

function parseCheckinPayload(payload) {
  if (!payload || typeof payload !== "string") return null;
  if (!payload.startsWith("SESSIO-CHECKIN:")) return null;
  const [, rawId, rawCode] = payload.split(":");
  const registrationId = Number(rawId);
  if (!registrationId || !rawCode) return null;
  return { registrationId, checkinCode: rawCode.trim().toUpperCase() };
}

function createStudentNotification(userId, type, title, message) {
  db.prepare(
    "INSERT INTO student_notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)"
  ).run(userId, type, title, message);
}

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.post("/api/auth/signup", (req, res) => {
  const { name, email, password, role = "student" } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required." });
  }
  const allowedRole = ["student", "organizer"].includes(role) ? role : "student";
  const passwordHash = bcrypt.hashSync(password, 10);
  try {
    const result = db
      .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)")
      .run(name, email.toLowerCase(), passwordHash, allowedRole);
    const user = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(result.lastInsertRowid);
    return res.status(201).json({ token: signToken(user), user });
  } catch {
    return res.status(409).json({ message: "Email already in use." });
  }
});

app.post("/api/auth/signin", (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").toLowerCase());
  if (!user || !user.password_hash || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ message: "Invalid email or password." });
  }
  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  return res.json({ token: signToken(safeUser), user: safeUser });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ message: "User not found." });
  return res.json(user);
});

app.get("/api/events", requireAuth, (req, res) => {
  const events = db.prepare(`
    SELECT e.*, u.name as organizer_name
    FROM events e
    JOIN users u ON e.organizer_id = u.id
    ORDER BY e.created_at DESC
  `).all();

  const withSessions = events.map((event) => {
    const sessions = db
      .prepare("SELECT * FROM sessions WHERE event_id = ? ORDER BY starts_at ASC")
      .all(event.id)
      .map(mapSessionWithSeats);
    return { ...event, sessions };
  });
  return res.json(withSessions);
});

app.post("/api/events", requireAuth, requireRole("organizer", "admin"), (req, res) => {
  const { title, description, location } = req.body;
  if (!title || !description || !location) {
    return res.status(400).json({ message: "Title, description and location are required." });
  }
  const organizerId = req.user.role === "admin" && req.body.organizerId ? req.body.organizerId : req.user.id;
  const result = db
    .prepare("INSERT INTO events (title, description, location, organizer_id) VALUES (?, ?, ?, ?)")
    .run(title, description, location, organizerId);
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(result.lastInsertRowid);
  return res.status(201).json(event);
});

app.delete("/api/events/:eventId", requireAuth, requireRole("organizer", "admin"), (req, res) => {
  const { eventId } = req.params;
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
  if (!event) return res.status(404).json({ message: "Event not found." });

  if (req.user.role !== "admin" && event.organizer_id !== req.user.id) {
    return res.status(403).json({ message: "You can only delete your own events." });
  }

  try {
    const tx = db.transaction(() => {
      const sessionIds = db.prepare("SELECT id FROM sessions WHERE event_id = ?").all(eventId).map((row) => row.id);

      if (sessionIds.length > 0) {
        const placeholders = sessionIds.map(() => "?").join(", ");

        const registrationIds = db
          .prepare(`SELECT id FROM registrations WHERE session_id IN (${placeholders})`)
          .all(...sessionIds)
          .map((row) => row.id);

        if (registrationIds.length > 0) {
          const registrationPlaceholders = registrationIds.map(() => "?").join(", ");
          db.prepare(`DELETE FROM removal_request_messages WHERE removal_request_id IN (
            SELECT id FROM removal_requests WHERE registration_id IN (${registrationPlaceholders})
          )`).run(...registrationIds);
          db.prepare(`DELETE FROM removal_requests WHERE registration_id IN (${registrationPlaceholders})`).run(
            ...registrationIds
          );
          db.prepare(`DELETE FROM attendance_logs WHERE registration_id IN (${registrationPlaceholders})`).run(
            ...registrationIds
          );
          db.prepare(`DELETE FROM registrations WHERE id IN (${registrationPlaceholders})`).run(...registrationIds);
        }

        db.prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`).run(...sessionIds);
      }

      db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
    });

    tx();
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete event. Please try again." });
  }
});

app.delete(
  "/api/events/:eventId/registrations",
  requireAuth,
  requireRole("organizer", "admin"),
  (req, res) => {
    const { eventId } = req.params;
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });

    if (req.user.role !== "admin" && event.organizer_id !== req.user.id) {
      return res.status(403).json({ message: "You can only manage your own events." });
    }

    const result = db
      .prepare(
        `
        DELETE FROM registrations
        WHERE session_id IN (
          SELECT id FROM sessions WHERE event_id = ?
        )
      `
      )
      .run(eventId);

    return res.json({ success: true, removedRegistrations: result.changes });
  }
);

app.post("/api/events/:eventId/sessions", requireAuth, requireRole("organizer", "admin"), (req, res) => {
  const { eventId } = req.params;
  const { startsAt, endsAt, capacity } = req.body;
  const startDate = new Date(startsAt);
  const endDate = new Date(endsAt);

  if (
    !startsAt ||
    !endsAt ||
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime())
  ) {
    return res.status(400).json({ message: "Valid start and end date/time are required." });
  }

  if (startDate <= new Date()) {
    return res.status(400).json({ message: "Session start time has already passed." });
  }

  if (endDate <= startDate) {
    return res.status(400).json({ message: "Session end time must be after start time." });
  }

  const startDay = String(startsAt).slice(0, 10);
  const endDay = String(endsAt).slice(0, 10);
  const daySpan =
    (new Date(`${endDay}T12:00:00`).getTime() - new Date(`${startDay}T12:00:00`).getTime()) /
    86400000;
  if (daySpan > 10) {
    return res.status(400).json({
      message: "Session dates must be within 10 days of each other (start date through end date).",
    });
  }

  if (!Number.isInteger(Number(capacity)) || Number(capacity) < 1) {
    return res.status(400).json({ message: "Capacity must be a whole number greater than zero." });
  }

  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
  if (!event) return res.status(404).json({ message: "Event not found." });
  if (req.user.role !== "admin" && event.organizer_id !== req.user.id) {
    return res.status(403).json({ message: "You can only manage your own events." });
  }
  const result = db
    .prepare("INSERT INTO sessions (event_id, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?)")
    .run(eventId, startsAt, endsAt, capacity);
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(result.lastInsertRowid);
  return res.status(201).json(mapSessionWithSeats(session));
});

app.delete("/api/sessions/:sessionId", requireAuth, requireRole("organizer", "admin"), (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sessionId);
  if (!session) return res.status(404).json({ message: "Session not found." });
  const registrations = db
    .prepare("SELECT COUNT(*) as count FROM registrations WHERE session_id = ?")
    .get(session.id).count;
  if (registrations > 0) {
    return res.status(409).json({ message: "Cannot delete a session with registrations." });
  }
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(session.event_id);
  if (req.user.role !== "admin" && event.organizer_id !== req.user.id) {
    return res.status(403).json({ message: "You can only manage your own events." });
  }
  db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
  return res.json({ success: true });
});

app.post("/api/sessions/:sessionId/register", requireAuth, requireRole("student", "admin"), (req, res) => {
  const { sessionId } = req.params;
  const { reason } = req.body;
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
  if (!session || session.status !== "open") {
    return res.status(400).json({ message: "This session is not open for registration." });
  }

  const transaction = db.transaction(() => {
    const current = db
      .prepare("SELECT COUNT(*) as count FROM registrations WHERE session_id = ?")
      .get(sessionId).count;
    if (current >= session.capacity) throw new Error("FULL");
    db.prepare(
      "INSERT INTO registrations (user_id, session_id, reason, checkin_code, attendance_status) VALUES (?, ?, ?, ?, 'registered')"
    ).run(req.user.id, sessionId, reason || "", uniqueCheckinCode());
  });

  try {
    transaction();
    return res.status(201).json({ success: true });
  } catch (error) {
    if (error.message === "FULL") {
      return res
        .status(409)
        .json({ message: "All slots are filled for this session. Please look for another event." });
    }
    return res.status(409).json({ message: "You are already registered in this session." });
  }
});

app.delete("/api/sessions/:sessionId/register", requireAuth, requireRole("student", "admin"), (req, res) => {
  db.prepare("DELETE FROM registrations WHERE user_id = ? AND session_id = ?").run(
    req.user.id,
    req.params.sessionId
  );
  return res.json({ success: true });
});

app.post("/api/checkin/mark", requireAuth, requireRole("organizer", "admin"), (req, res) => {
  const { payload, checkinCode } = req.body;

  let registration;
  if (payload) {
    const parsed = parseCheckinPayload(payload);
    if (!parsed) return res.status(400).json({ message: "Invalid QR payload." });
    registration = db
      .prepare(
        `
        SELECT
          r.*,
          u.name as student_name,
          e.title as event_title,
          e.organizer_id
        FROM registrations r
        JOIN users u ON u.id = r.user_id
        JOIN sessions s ON s.id = r.session_id
        JOIN events e ON e.id = s.event_id
        WHERE r.id = ? AND UPPER(r.checkin_code) = ?
      `
      )
      .get(parsed.registrationId, parsed.checkinCode);
  } else if (checkinCode) {
    registration = db
      .prepare(
        `
        SELECT
          r.*,
          u.name as student_name,
          e.title as event_title,
          e.organizer_id
        FROM registrations r
        JOIN users u ON u.id = r.user_id
        JOIN sessions s ON s.id = r.session_id
        JOIN events e ON e.id = s.event_id
        WHERE UPPER(r.checkin_code) = ?
      `
      )
      .get(String(checkinCode).trim().toUpperCase());
  } else {
    return res.status(400).json({ message: "Provide a QR payload or check-in code." });
  }

  if (!registration) {
    return res.status(404).json({ message: "No registration found for this code." });
  }
  if (req.user.role !== "admin" && registration.organizer_id !== req.user.id) {
    return res.status(403).json({ message: "You can only check in students for your own events." });
  }

  if (registration.attendance_status === "checked_in") {
    const existingLog = db
      .prepare(
        "SELECT id FROM attendance_logs WHERE registration_id = ? AND action = 'checkin' LIMIT 1"
      )
      .get(registration.id);
    if (!existingLog) {
      db.prepare(
        "INSERT INTO attendance_logs (registration_id, actor_id, action, method, details) VALUES (?, ?, 'checkin', ?, ?)"
      ).run(
        registration.id,
        req.user.id,
        payload ? "qr" : "manual",
        "Backfilled check-in log for an already checked-in registration"
      );
    }
    return res.json({
      success: true,
      alreadyCheckedIn: true,
      studentName: registration.student_name,
      eventTitle: registration.event_title,
      checkedInAt: registration.checked_in_at,
    });
  }

  db.prepare(
    "UPDATE registrations SET attendance_status = 'checked_in', checked_in_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(registration.id);
  db.prepare(
    "INSERT INTO attendance_logs (registration_id, actor_id, action, method, details) VALUES (?, ?, 'checkin', ?, ?)"
  ).run(
    registration.id,
    req.user.id,
    payload ? "qr" : "manual",
    payload ? "Scanned QR payload" : `Manual check-in code ${String(checkinCode).trim().toUpperCase()}`
  );

  return res.json({
    success: true,
    studentName: registration.student_name,
    eventTitle: registration.event_title,
    checkedInAt: new Date().toISOString(),
  });
});

app.get("/api/checkin/logs", requireAuth, requireRole("organizer", "admin"), (req, res) => {
  const params = req.user.role === "admin" ? [] : [req.user.id];
  const where = req.user.role === "admin" ? "" : "WHERE event.organizer_id = ?";
  const logs = db
    .prepare(
      `
      SELECT
        al.id,
        al.action,
        al.method,
        al.details,
        al.created_at,
        student.name as student_name,
        event.title as event_title,
        actor.name as actor_name
      FROM attendance_logs al
      JOIN registrations r ON r.id = al.registration_id
      JOIN users student ON student.id = r.user_id
      JOIN sessions s ON s.id = r.session_id
      JOIN events event ON event.id = s.event_id
      JOIN users actor ON actor.id = al.actor_id
      ${where}
      ORDER BY al.created_at DESC
      LIMIT 100
    `
    )
    .all(...params);
  return res.json(logs);
});

app.post(
  "/api/removal-requests",
  requireAuth,
  requireRole("organizer"),
  (req, res) => {
    const { registrationId, reason } = req.body;
    if (!registrationId || !reason || reason.trim().length < 10) {
      return res
        .status(400)
        .json({ message: "Please provide a specific reason (at least 10 characters)." });
    }

    const registration = db
      .prepare(
        `
        SELECT
          r.id as registration_id,
          r.user_id as student_id,
          s.id as session_id,
          s.starts_at,
          e.id as event_id,
          e.title as event_title,
          e.organizer_id,
          u.name as student_name
        FROM registrations r
        JOIN sessions s ON s.id = r.session_id
        JOIN events e ON e.id = s.event_id
        JOIN users u ON u.id = r.user_id
        WHERE r.id = ?
      `
      )
      .get(registrationId);

    if (!registration) {
      return res.status(404).json({ message: "Registration not found." });
    }

    if (registration.organizer_id !== req.user.id) {
      return res.status(403).json({ message: "You can only request removals for your own events." });
    }

    const existingPending = db
      .prepare(
        "SELECT id FROM removal_requests WHERE registration_id = ? AND status = 'pending' LIMIT 1"
      )
      .get(registrationId);
    if (existingPending) {
      return res.status(409).json({ message: "A pending removal request already exists for this student." });
    }

    const result = db
      .prepare(
        "INSERT INTO removal_requests (registration_id, requested_by, reason) VALUES (?, ?, ?)"
      )
      .run(registrationId, req.user.id, reason.trim());

    return res.status(201).json({
      success: true,
      requestId: result.lastInsertRowid,
      message: `Removal request submitted for ${registration.student_name}.`,
    });
  }
);

app.delete(
  "/api/registrations/:registrationId",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const registration = db
      .prepare(
        `
        SELECT
          r.id,
          r.user_id,
          e.title as event_title,
          s.starts_at
        FROM registrations r
        JOIN sessions s ON s.id = r.session_id
        JOIN events e ON e.id = s.event_id
        WHERE r.id = ?
      `
      )
      .get(req.params.registrationId);

    if (!registration) {
      return res.status(404).json({ message: "Registration not found." });
    }

    db.prepare("DELETE FROM registrations WHERE id = ?").run(registration.id);
    createStudentNotification(
      registration.user_id,
      "admin_removal",
      "Removed from event",
      `An admin removed your registration for ${registration.event_title} (${new Date(
        registration.starts_at
      ).toLocaleString()}).`
    );
    return res.json({ success: true });
  }
);

app.post(
  "/api/removal-requests/:requestId/decision",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const { decision, reviewNote = "" } = req.body;
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be either approved or rejected." });
    }

    const request = db
      .prepare(
        `
        SELECT rr.*, r.id as existing_registration_id
        FROM removal_requests rr
        LEFT JOIN registrations r ON r.id = rr.registration_id
        WHERE rr.id = ?
      `
      )
      .get(req.params.requestId);

    if (!request) return res.status(404).json({ message: "Removal request not found." });
    if (request.status !== "pending") {
      return res.status(409).json({ message: "This removal request has already been reviewed." });
    }

    const tx = db.transaction(() => {
      if (decision === "approved" && request.existing_registration_id) {
        const registrationContext = db
          .prepare(
            `
            SELECT
              r.user_id,
              e.title as event_title,
              s.starts_at
            FROM registrations r
            JOIN sessions s ON s.id = r.session_id
            JOIN events e ON e.id = s.event_id
            WHERE r.id = ?
          `
          )
          .get(request.registration_id);
        db.prepare("DELETE FROM registrations WHERE id = ?").run(request.registration_id);
        if (registrationContext) {
          createStudentNotification(
            registrationContext.user_id,
            "admin_removal",
            "Removed from event",
            `Your registration for ${registrationContext.event_title} (${new Date(
              registrationContext.starts_at
            ).toLocaleString()}) was removed by admin approval.`
          );
        }
      }

      db.prepare(
        `
          UPDATE removal_requests
          SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
      ).run(decision, req.user.id, reviewNote.trim(), request.id);
    });

    tx();
    return res.json({ success: true });
  }
);

app.post(
  "/api/removal-requests/:requestId/followups",
  requireAuth,
  requireRole("organizer", "admin"),
  (req, res) => {
    const { message } = req.body;
    if (!message || message.trim().length < 3) {
      return res.status(400).json({ message: "Follow-up message must be at least 3 characters." });
    }

    const request = db
      .prepare("SELECT id, requested_by FROM removal_requests WHERE id = ?")
      .get(req.params.requestId);

    if (!request) return res.status(404).json({ message: "Removal request not found." });
    if (req.user.role !== "admin" && request.requested_by !== req.user.id) {
      return res.status(403).json({ message: "You can only follow up on your own removal requests." });
    }

    db.prepare(
      "INSERT INTO removal_request_messages (removal_request_id, sender_id, message) VALUES (?, ?, ?)"
    ).run(request.id, req.user.id, message.trim());

    return res.status(201).json({ success: true });
  }
);

app.get("/api/registrations/me", requireAuth, requireRole("student", "admin"), async (req, res) => {
  const registrations = db.prepare(`
    SELECT
      r.id,
      r.reason,
      r.created_at,
      r.checkin_code,
      r.attendance_status,
      r.checked_in_at,
      s.id as session_id,
      s.starts_at,
      s.ends_at,
      e.title as event_title
    FROM registrations r
    JOIN sessions s ON r.session_id = s.id
    JOIN events e ON s.event_id = e.id
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC
  `).all(req.user.id);

  const withQr = await Promise.all(
    registrations.map(async (item) => {
      const qrPayload = buildCheckinPayload(item.id, item.checkin_code);
      const qrCodeDataUrl = await QRCode.toDataURL(qrPayload, { width: 180, margin: 1 });
      return { ...item, qrPayload, qrCodeDataUrl };
    })
  );
  return res.json(withQr);
});

app.get("/api/notifications/me", requireAuth, requireRole("student", "admin"), (req, res) => {
  const notifications = db
    .prepare(
      `
      SELECT id, type, title, message, created_at
      FROM student_notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `
    )
    .all(req.user.id);
  return res.json(notifications);
});

app.get("/api/support-threads", requireAuth, requireRole("student", "admin"), (req, res) => {
  const baseQuery = `
    SELECT
      st.id,
      st.student_id,
      st.registration_id,
      st.subject,
      st.status,
      st.created_at,
      student.name as student_name,
      student.email as student_email,
      e.title as event_title,
      s.starts_at as session_starts_at,
      (
        SELECT stm.message
        FROM support_thread_messages stm
        WHERE stm.thread_id = st.id
        ORDER BY stm.created_at DESC, stm.id DESC
        LIMIT 1
      ) as last_message,
      (
        SELECT stm.created_at
        FROM support_thread_messages stm
        WHERE stm.thread_id = st.id
        ORDER BY stm.created_at DESC, stm.id DESC
        LIMIT 1
      ) as last_message_at
    FROM support_threads st
    JOIN users student ON student.id = st.student_id
    LEFT JOIN registrations r ON r.id = st.registration_id
    LEFT JOIN sessions s ON s.id = r.session_id
    LEFT JOIN events e ON e.id = s.event_id
  `;
  const where = req.user.role === "admin" ? "" : "WHERE st.student_id = ?";
  const params = req.user.role === "admin" ? [] : [req.user.id];
  const threads = db
    .prepare(
      `
      ${baseQuery}
      ${where}
      ORDER BY COALESCE(last_message_at, st.created_at) DESC
      LIMIT 100
    `
    )
    .all(...params);
  return res.json(threads);
});

app.post("/api/support-threads", requireAuth, requireRole("student"), (req, res) => {
  const { registrationId = null, subject = "", message = "" } = req.body;
  if (!subject.trim() || subject.trim().length < 4) {
    return res.status(400).json({ message: "Subject must be at least 4 characters." });
  }
  if (!message.trim() || message.trim().length < 5) {
    return res.status(400).json({ message: "Message must be at least 5 characters." });
  }

  let validatedRegistrationId = null;
  if (registrationId) {
    const ownedRegistration = db
      .prepare("SELECT id FROM registrations WHERE id = ? AND user_id = ?")
      .get(registrationId, req.user.id);
    if (!ownedRegistration) {
      return res.status(403).json({ message: "You can only reference your own registration." });
    }
    validatedRegistrationId = ownedRegistration.id;
  }

  const tx = db.transaction(() => {
    const thread = db
      .prepare(
        "INSERT INTO support_threads (student_id, registration_id, subject, status) VALUES (?, ?, ?, 'open')"
      )
      .run(req.user.id, validatedRegistrationId, subject.trim());
    db.prepare("INSERT INTO support_thread_messages (thread_id, sender_id, message) VALUES (?, ?, ?)").run(
      thread.lastInsertRowid,
      req.user.id,
      message.trim()
    );
    return thread.lastInsertRowid;
  });

  const threadId = tx();
  return res.status(201).json({ success: true, threadId });
});

app.get("/api/support-threads/:threadId/messages", requireAuth, requireRole("student", "admin"), (req, res) => {
  const thread = db
    .prepare("SELECT id, student_id FROM support_threads WHERE id = ?")
    .get(req.params.threadId);
  if (!thread) return res.status(404).json({ message: "Thread not found." });
  if (req.user.role !== "admin" && thread.student_id !== req.user.id) {
    return res.status(403).json({ message: "You can only view your own support threads." });
  }

  const messages = db
    .prepare(
      `
      SELECT
        stm.id,
        stm.thread_id,
        stm.sender_id,
        sender.name as sender_name,
        sender.role as sender_role,
        stm.message,
        stm.created_at
      FROM support_thread_messages stm
      JOIN users sender ON sender.id = stm.sender_id
      WHERE stm.thread_id = ?
      ORDER BY stm.created_at ASC, stm.id ASC
    `
    )
    .all(thread.id);
  return res.json(messages);
});

app.post("/api/support-threads/:threadId/messages", requireAuth, requireRole("student", "admin"), (req, res) => {
  const { message = "" } = req.body;
  if (!message.trim() || message.trim().length < 3) {
    return res.status(400).json({ message: "Message must be at least 3 characters." });
  }

  const thread = db
    .prepare("SELECT id, student_id, status FROM support_threads WHERE id = ?")
    .get(req.params.threadId);
  if (!thread) return res.status(404).json({ message: "Thread not found." });
  if (req.user.role !== "admin" && thread.student_id !== req.user.id) {
    return res.status(403).json({ message: "You can only reply to your own support threads." });
  }
  if (thread.status === "closed") {
    return res.status(409).json({ message: "This support thread is closed." });
  }

  db.prepare("INSERT INTO support_thread_messages (thread_id, sender_id, message) VALUES (?, ?, ?)").run(
    thread.id,
    req.user.id,
    message.trim()
  );

  if (req.user.role === "admin") {
    createStudentNotification(
      thread.student_id,
      "admin_support_reply",
      "Admin replied to your support request",
      "Open My Registrations to view the latest admin response."
    );
  }

  return res.status(201).json({ success: true });
});

app.get("/api/organizer/overview", requireAuth, requireRole("organizer", "admin"), (req, res) => {
  const params = req.user.role === "admin" ? [] : [req.user.id];
  const where = req.user.role === "admin" ? "" : "WHERE e.organizer_id = ?";
  const data = db.prepare(`
    SELECT e.id as event_id, e.title, s.id as session_id, s.starts_at, s.capacity,
      COUNT(r.id) as registrations
    FROM events e
    JOIN sessions s ON s.event_id = e.id
    LEFT JOIN registrations r ON r.session_id = s.id
    ${where}
    GROUP BY s.id
    ORDER BY e.title, s.starts_at
  `).all(...params);
  return res.json(data);
});

app.get("/api/analytics", requireAuth, requireRole("organizer", "admin"), (req, res) => {
  const params = req.user.role === "admin" ? [] : [req.user.id];
  const where = req.user.role === "admin" ? "" : "WHERE e.organizer_id = ?";

  const totals = db
    .prepare(
      `
      SELECT
        COUNT(DISTINCT e.id) as total_events,
        COUNT(DISTINCT s.id) as total_sessions,
        COUNT(r.id) as total_registrations,
        COUNT(CASE WHEN r.attendance_status = 'checked_in' THEN 1 END) as total_checked_in,
        COALESCE(SUM(s.capacity), 0) as total_capacity
      FROM events e
      LEFT JOIN sessions s ON s.event_id = e.id
      LEFT JOIN registrations r ON r.session_id = s.id
      ${where}
    `
    )
    .get(...params);

  const eventPerformance = db
    .prepare(
      `
      SELECT
        e.id as event_id,
        e.title,
        COUNT(DISTINCT s.id) as sessions_count,
        COUNT(r.id) as registrations_count,
        COUNT(CASE WHEN r.attendance_status = 'checked_in' THEN 1 END) as checked_in_count,
        COALESCE(SUM(s.capacity), 0) as capacity_total
      FROM events e
      LEFT JOIN sessions s ON s.event_id = e.id
      LEFT JOIN registrations r ON r.session_id = s.id
      ${where}
      GROUP BY e.id
      ORDER BY registrations_count DESC, e.title ASC
    `
    )
    .all(...params);

  const sessionFillRates = db
    .prepare(
      `
      SELECT
        s.id as session_id,
        e.title as event_title,
        s.starts_at,
        s.capacity,
        COUNT(r.id) as registrations_count,
        COUNT(CASE WHEN r.attendance_status = 'checked_in' THEN 1 END) as checked_in_count
      FROM sessions s
      JOIN events e ON e.id = s.event_id
      LEFT JOIN registrations r ON r.session_id = s.id
      ${where}
      GROUP BY s.id
      ORDER BY s.starts_at ASC
    `
    )
    .all(...params)
    .map((row) => ({
      ...row,
      fillRate: row.capacity > 0 ? Math.round((row.registrations_count / row.capacity) * 100) : 0,
      attendanceRate: row.registrations_count > 0 ? Math.round((row.checked_in_count / row.registrations_count) * 100) : 0,
    }));

  const recentRegistrations = db
    .prepare(
      `
      SELECT
        DATE(r.created_at) as day,
        COUNT(r.id) as count
      FROM registrations r
      JOIN sessions s ON s.id = r.session_id
      JOIN events e ON e.id = s.event_id
      ${where}
      GROUP BY DATE(r.created_at)
      ORDER BY day DESC
      LIMIT 7
    `
    )
    .all(...params)
    .reverse();

  const registrationDetails = db
    .prepare(
      `
      SELECT
        r.id as registration_id,
        u.name as student_name,
        u.email as student_email,
        e.title as event_title,
        s.starts_at,
        r.reason,
        r.created_at
      FROM registrations r
      JOIN users u ON u.id = r.user_id
      JOIN sessions s ON s.id = r.session_id
      JOIN events e ON e.id = s.event_id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT 30
    `
    )
    .all(...params);

  const removalScopeWhere = req.user.role === "admin" ? "" : "WHERE rr.requested_by = ?";
  const removalScopeParams = req.user.role === "admin" ? [] : [req.user.id];

  const removalRequests = db
    .prepare(
      `
      SELECT
        rr.id,
        rr.registration_id,
        rr.reason,
        rr.status,
        rr.review_note,
        rr.created_at,
        rr.reviewed_at,
        requester.name as requested_by_name,
        reviewer.name as reviewed_by_name,
        COALESCE(student.name, 'Removed User') as student_name,
        COALESCE(student.email, 'removed@example.local') as student_email,
        COALESCE(e.title, 'Removed Event') as event_title
      FROM removal_requests rr
      JOIN users requester ON requester.id = rr.requested_by
      LEFT JOIN registrations r ON r.id = rr.registration_id
      LEFT JOIN users student ON student.id = r.user_id
      LEFT JOIN sessions s ON s.id = r.session_id
      LEFT JOIN events e ON e.id = s.event_id
      LEFT JOIN users reviewer ON reviewer.id = rr.reviewed_by
      ${removalScopeWhere}
      ORDER BY rr.created_at DESC
      LIMIT 50
    `
    )
    .all(...removalScopeParams);

  const removalRequestMessages = db
    .prepare(
      `
      SELECT
        rrm.id,
        rrm.removal_request_id,
        rrm.message,
        rrm.created_at,
        sender.name as sender_name,
        sender.role as sender_role
      FROM removal_request_messages rrm
      JOIN removal_requests rr ON rr.id = rrm.removal_request_id
      JOIN users sender ON sender.id = rrm.sender_id
      ${removalScopeWhere}
      ORDER BY rrm.created_at ASC
    `
    )
    .all(...removalScopeParams);

  return res.json({
    totals: {
      totalEvents: totals.total_events || 0,
      totalSessions: totals.total_sessions || 0,
      totalRegistrations: totals.total_registrations || 0,
      totalCheckedIn: totals.total_checked_in || 0,
      totalCapacity: totals.total_capacity || 0,
      utilizationPercent:
        totals.total_capacity > 0
          ? Math.round((totals.total_registrations / totals.total_capacity) * 100)
          : 0,
    },
    eventPerformance,
    sessionFillRates,
    recentRegistrations,
    registrationDetails,
    removalRequests,
    removalRequestMessages,
  });
});

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
