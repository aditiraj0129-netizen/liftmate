# Liftmate — your lifting partner

AI gym coach web app (works on phone and laptop):

- **Live AI Coach** – camera watches you train, counts reps, catches form mistakes, speaks cues, senses when you are close to failure, and logs every set automatically.
- **New Session planner** – a 30-second check-in (food, energy, sleep, soreness, time) and the AI builds today's plan around your Mon–Sun week.
- **Machine Guide** – photograph any gym machine or its printed sticker; get simple English/Hindi setup steps, then train on it with the live coach. Each scan is shared with members of your gym.
- **AI Nutritionist** – log food by typing or voice, see calories and protein left, ask anything ("heavy lunch, gym in 2 hours?") in English, Hindi or Hinglish, and get a full weekly meal plan for veg / non-veg / egg / vegan / Jain diets.
- **Gym community** – pick your gym on the map, find people who train there, send connection requests.
- **Memory** – the coaches remember what you tell them (injuries, food dislikes, goals) and see your whole training week.

Everything runs on **free tiers** (₹0 to build and beta-test).

---

## Folder structure

```
liftmate/
├── api/                  FastAPI backend (Python)
│   ├── app/
│   │   ├── main.py       starts the server
│   │   ├── ai.py         every AI call (Gemini, Groq backup)
│   │   ├── logic.py      targets, recovery score, user brief for the AI
│   │   └── routers/      profile, gyms, exercises, sessions, coach, nutrition, machines
│   ├── scripts/seed_exercises.py   fills the exercise library (535 exercises)
│   ├── requirements.txt
│   └── .env              <- PUT YOUR BACKEND KEYS HERE
├── web/                  Next.js app (React + TypeScript + Tailwind)
│   ├── src/app/          all screens
│   ├── src/lib/pose/     rep counter + form rules (runs on the phone)
│   └── .env.local        <- PUT YOUR WEB KEYS HERE
└── supabase/schema.sql   the database (paste into Supabase once)
```

---

## Setup (about 15 minutes, one time)

You need: **Node.js 20+**, **Python 3.11+**, a free **Supabase** account and a free **Google AI Studio** account.

### 1. Create the database

1. Go to **supabase.com** → **New project** → name `liftmate`, region **Mumbai** (or nearest). Save the database password.
2. Open **SQL Editor** → **New query** → paste everything from `supabase/schema.sql` → **Run**. You should see "Success".
3. Open **Authentication → Sign In / Providers → Email** and turn **off** "Confirm email" (easier while testing; turn it back on before launch).

### 2. Get your keys

| Key | Where to find it | Goes in |
| --- | --- | --- |
| Project URL | Supabase → Project Settings → API (or "Data API") | both files |
| `anon` / publishable key | Supabase → Project Settings → API Keys | `web/.env.local` only |
| `service_role` / secret key | Supabase → Project Settings → API Keys | `api/.env` only — never share it |
| Gemini API key | aistudio.google.com/apikey → Create API key | `api/.env` |
| Groq key (optional backup AI) | console.groq.com/keys | `api/.env` |

### 3. Fill in the two env files

`api/.env`
```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-flash-latest
GROQ_API_KEY=
FRONTEND_URL=http://localhost:3000
```

`web/.env.local`
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

> **Already set up before the voice update?** Run `supabase/migration_002_voice_coach.sql` once in the Supabase SQL Editor, and run `pip install -r requirements.txt` again in `api`.

### 4. Start the backend (terminal 1)

macOS / Linux:
```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m scripts.seed_exercises      # only the first time: loads 535 exercises
uvicorn app.main:app --reload --port 8000
```

Windows (PowerShell):
```powershell
cd api
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m scripts.seed_exercises
uvicorn app.main:app --reload --port 8000
```

Check: open http://localhost:8000/health → `{"status":"ok","app":"liftmate","ai_configured":true}`.
All API endpoints are listed at http://localhost:8000/docs.

### 5. Start the web app (terminal 2)

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:3000**, create an account, fill your profile, pick your gym and press **New Session**.

### 6. Use it on your phone

The camera and microphone only work on `https://` or `localhost`. Easiest free options:

- **Same Wi-Fi testing:** in Chrome on your laptop open `chrome://inspect` → Port forwarding → forward `3000` and `8000` to your phone (USB), then open `localhost:3000` on the phone.
- **Deploy (recommended for real use):** web → Vercel or Cloudflare Pages (free), API → Render free web service. Set the same env values there, and set `FRONTEND_URL` (API) and `NEXT_PUBLIC_API_URL` (web) to the deployed addresses.

---

## How the Live Coach works

```
Camera ──> MediaPipe Pose (on the phone, ~25 frames/sec, video never leaves the device)
       ──> Rep counter state machine + form rules (src/lib/pose)
       ──> Instant spoken cues ("Push your knees out") – browser speech, free
       ──> At set end: summary ──> backend AI (Gemini) ──> spoken coaching + saved to Daily Activity
```

- **37 exercises** have live AI coaching across barbell, dumbbell, machine, cable, bodyweight and holds (squat, bench, deadlift, RDL, curls, presses, lat pulldown, rows, leg press, leg extension/curl, lunges, push-ups, pull-ups, dips, plank and more). The other ~500 exercises have guides and manual logging.
- **"How much more can you push?"** – the coach times the lifting part of every rep. When reps get 30–50% slower than your first reps, it tells you how many strong reps are left, then says when you are at your limit.
- **Camera tip:** side view for squats, deadlifts, rows, curls and leg machines; front view for overhead press and lateral raises. The coach tells you when you are out of frame.
- To add an exercise to the live coach: set its `engine` column in Supabase to one of `squat, pushup, curl, press_overhead, pulldown, leg_press, lunge, hinge, lateral_raise, bench, pushdown, row_bent, row_seated, leg_extension, leg_curl, plank`.

---

## Coach voice

- The coach uses realistic Microsoft neural voices made for India: **Neerja / Prabhat** (Indian English) and **Swara / Madhur** (Hindi). Pick female or male, English or हिंदी, on the Live Coach start screen.
- Hindi lines and AI replies are written in Devanagari so the Hindi voice pronounces them naturally.
- Default: the free `edge-tts` library, no key needed (good for building and beta). It is not an official Microsoft API, so before launching publicly add an official **Azure Speech** key (free 0.5M characters/month, same voices): set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in `api/.env`.
- Clips are cached in `api/.tts_cache`, so counts and cues play instantly. If the voice service is unreachable, the app falls back to the browser voice automatically.

## Live Coach flow

1. **Get into position** – the coach tells you exactly what to fix (step into view, step back because your feet aren't visible, turn sideways, stand tall to start). Counting starts automatically once you hold the right position for about a second. People in the background are ignored: the coach locks onto you.
2. **During the set** – counts every rep out loud, calls out **bad reps** (counted, but with the fix: "Seven. Chest up!"), half reps, shouts motivation when a rep is grinding ("Come on! Push!"), praises clean reps, warns near failure, and checks in if you pause too long.
3. **After the set** – clean vs bad rep count (you can correct the numbers), good points, what to improve, spoken AI feedback, and you can talk back to your coach by voice or text. Then a spoken rest timer, and "Next set" brings back the get-ready guide.

## Phases

| Phase | What | Status in this code |
| --- | --- | --- |
| 0 · Foundations | Login, profile, onboarding, gym search on OpenStreetMap, database, 535-exercise library | Done |
| 1 · Live Coach | MediaPipe pose, rep counting, form rules for 16 movement patterns, spoken cues, rest timer, auto-logging | Done |
| 2 · Voice + memory | AI coach replies by voice (English/Hindi), ask questions by mic mid-set, New Session AI planner, Mon–Sun week view, memory of facts you share | Done |
| 2b · Machine Guide | Scan machine/sticker, bilingual guide, "My Gym's Machines" shared list, train with AI on it | Done |
| 3 · Nutritionist | Food logging by text/voice, daily targets, live nutrition + recovery chat, weekly meal plan with grocery list | Done |
| 4 · Community | Find people at your gym, connection requests, privacy settings | Done (basic) |
| 5 · Next upgrades | Gemini Live native-audio streaming voice, fine-tuned YOLO-Pose for the big three, semantic memory search (pgvector), IFCT food database, plate photo logging, streaks/badges, plateau detector, offline mode, coach (trainer) dashboard, WhatsApp reminders | Planned |

---

## Free-tier limits to know

- **Gemini free tier:** enough for building and a small beta. It does **not allow commercial use** and Google may use prompts to improve models. Before charging users, enable billing in Google AI Studio (pay-per-use, no monthly fee). Only `api/app/ai.py` talks to the AI, so switching is easy.
- **Render free:** the API sleeps after ~15 min idle; the first request after that takes ~30 s.
- **Supabase free:** 500 MB database; the project pauses after 1 week without activity (just resume it in the dashboard).
- **OpenStreetMap search:** about 1 search per second; fine for gym picking.

## Safety

Liftmate gives general fitness and nutrition guidance, not medical advice. The AI is instructed never to encourage training through pain and to send users to a doctor or physiotherapist for red-flag symptoms. Minimum age 16.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Can't reach the Liftmate server" | Backend not running, or `NEXT_PUBLIC_API_URL` is wrong. Restart `npm run dev` after editing `.env.local`. |
| "Supabase keys are missing" | Fill `web/.env.local`, then restart `npm run dev`. |
| "AI is busy right now" | Gemini free limit reached or wrong key. Wait a minute, check `GEMINI_API_KEY`, or add a Groq key as backup. |
| Exercises list empty | Run `python -m scripts.seed_exercises` inside `api` with the venv active. |
| Camera doesn't start on phone | Use `https://` (deployed) or `localhost`; allow camera permission. |
| Voice input button missing | Speech recognition works in Chrome/Edge. Safari can speak but may not listen. |
| Signup says "check your email" | Turn off "Confirm email" in Supabase Authentication settings (step 1.3). |
