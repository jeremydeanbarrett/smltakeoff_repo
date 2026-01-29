SML Takeoff - ONLINE MVP (Render + Vercel)

You have TWO modes:
1) LOCAL (default)
   - Backend: http://localhost:10000
   - Frontend: http://localhost:5173

2) ONLINE
   - Backend hosted on Render
   - Frontend hosted on Vercel
   - Postgres can be added later (this MVP still uses JSON store per-user)

IMPORTANT:
- Set frontend env: VITE_API_BASE to your Render backend URL
- Set backend env: CORS_ORIGINS to include your Vercel URL and localhost

Backend env vars (Render):
PORT=10000
NODE_ENV=production
JWT_SECRET=...
CORS_ORIGINS=https://YOUR-VERCEL-APP.vercel.app,http://localhost:5173

Start local:
- run START script (below)

