# Online Deploy (EASIEST PATH) — Render + Persistent Disk

This repo is already structured as a monorepo:
- /backend (Express API)
- /frontend (Vite/React)

## What you get
- Backend web service on Render
- Frontend static site on Render
- Persistent data (JSON store) on a Render Persistent Disk
- You and Chris can use it from anywhere

## Important limitation (simple + acceptable for now)
This uses a single-instance backend service because Render persistent disks can't be shared across multiple instances.
That is perfect for 2 users.

## Setup Steps (no guesswork)
1) Put this code in a GitHub repo (private is fine).
2) In Render: **New > Blueprint**
3) Select the repo and the `render.yaml` at the repo root.
4) Create the services.

## After first deploy: set these 2 values
### A) Backend: CORS_ORIGINS
Set it to your frontend URL (from Render), like:
- https://smltakeoff-frontend.onrender.com

### B) Frontend: VITE_API_BASE
Set it to your backend URL (from Render), like:
- https://smltakeoff-backend.onrender.com

Then redeploy both services.

## Verify
- Backend health: https://YOUR_BACKEND/health
- Frontend app loads and you can login.

## Backups
Use the in-app Backup download on the Account page.
