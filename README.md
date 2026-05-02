# Sessio (CSC 4370)

Full-stack campus events app (**Vue + Vite** frontend, **Express** API, **SQLite**).  
This repo is set up for **local development only** (no deployment config in-tree).

Repository: https://github.com/Sashankvarma2005/sessio

## Prerequisites
- [Node.js](https://nodejs.org/) **20.x or newer** (recommended for current Vite)
- npm (comes with Node)

## What is included
- Sign in page with email/password authentication.
- Role-based experience for `student`, `organizer`, and `admin`.
- Event listing, session capacity tracking, register/cancel workflow.
- Organizer dashboard for creating events and sessions.
- Organizer/admin analytics page for event progress and fill rates.
- SQLite persistence with seeded demo users.

## Run locally
From the repository root:

1. Install dependencies (first time):
   ```bash
   npm --prefix backend install
   npm --prefix frontend install
   ```
2. Create backend environment file:
   ```bash
   cp backend/.env.example backend/.env
   ```
3. Start the API (runs on port **4000** by default):
   ```bash
   npm --prefix backend run dev
   ```
4. In a **second terminal**, start the frontend:
   ```bash
   npm --prefix frontend run dev
   ```
5. Open the app: **http://localhost:5173**

The frontend is configured to call the API at **http://localhost:4000**; keep both processes running while you develop.

## Demo credentials
- `student@campus.local` / `Password123!`
- `organizer@campus.local` / `Password123!`
- `admin@campus.local` / `Password123!`

## Notes
- SQLite database file: `backend/campus_event_hub.db` (created on first API start).
- If sign-in fails, confirm the backend is running and `.env` exists with `JWT_SECRET` set (`backend/.env.example` has defaults).
