# Sessio (CSC 4370)

Local full-stack project using Vue + Vite, Express, and SQLite.

## What is included
- Sign in page with email/password authentication.
- Role-based experience for `student`, `organizer`, and `admin`.
- Event listing, session capacity tracking, register/cancel workflow.
- Organizer dashboard for creating events and sessions.
- Organizer/admin analytics page for event progress and fill rates.
- SQLite persistence with seeded demo users.

## Run locally
1. Create backend environment file:
   - `cp backend/.env.example backend/.env`
2. Start backend:
   - `npm --prefix backend run dev`
3. Start frontend:
   - `npm --prefix frontend run dev`
4. Open: `http://localhost:5173`

## Demo credentials
- `student@campus.local` / `Password123!`
- `organizer@campus.local` / `Password123!`
- `admin@campus.local` / `Password123!`

## Notes
- Database file is created automatically at `backend/campus_event_hub.db`.
