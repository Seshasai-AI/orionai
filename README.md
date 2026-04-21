# 🌌 OrionAI — Production AI Chatbot

> FastAPI + Groq LLM + Tavily web search · Deploy to Render in one push

---

## 📁 Project Structure

```
orionai-prod/
├── backend/
│   └── main.py              ← FastAPI server (all routes + AI logic)
├── frontend/
│   ├── index.html           ← Chat UI
│   └── static/
│       ├── css/style.css
│       └── js/app.js
├── requirements.txt         ← Pinned Python deps (Render safe)
├── render.yaml              ← Render one-click deploy config
├── Procfile                 ← Gunicorn start command
├── runtime.txt              ← Python 3.11 pin
├── .env.example             ← Copy → .env for local dev
└── .gitignore
```

---

## 🚀 Local Setup

### 1. Go to project folder
```bash
cd orionai-prod
```

### 2. Create virtual environment
```bash
python -m venv venv

# Activate — Mac/Linux:
source venv/bin/activate

# Activate — Windows PowerShell:
venv\Scripts\activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

### 4. Create .env file
```bash
# Windows:
copy .env.example .env

# Mac/Linux:
cp .env.example .env
```

Open `.env` and add your real keys:
```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
TAVILY_API_KEY=tvly-xxxxxxxxxxxxxxxxxxxx
```

### 5. Run the server
```bash
uvicorn backend.main:app --reload --port 8000
```

Open **http://localhost:8000** ✅

---

## ☁️ Render Deployment (Step by Step)

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "OrionAI v3 production"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/orionai.git
git push -u origin main
```

> Make sure `.env` is NOT pushed — it's in `.gitignore`

---

### Step 2 — Create Render account

Go to **https://render.com** → Sign up with GitHub

---

### Step 3 — Create Web Service

1. Dashboard → **New +** → **Web Service**
2. Connect your GitHub repo `orionai`
3. Render auto-detects `render.yaml`

---

### Step 4 — Verify these exact settings

| Setting | Value |
|---|---|
| **Runtime** | Python |
| **Build Command** | `pip install --upgrade pip && pip install -r requirements.txt` |
| **Start Command** | `gunicorn backend.main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT --timeout 120` |
| **Python Version** | 3.11.0 (set by runtime.txt) |
| **Health Check Path** | `/health` |

---

### Step 5 — Set Environment Variables

In Render dashboard → your service → **Environment** tab → **Add Environment Variable**:

| Key | Value |
|---|---|
| `GROQ_API_KEY` | your Groq key (starts with `gsk_`) |
| `TAVILY_API_KEY` | your Tavily key (starts with `tvly-`) |

> These are set here, NOT in the code or GitHub

---

### Step 6 — Deploy

Click **Create Web Service**. Wait 2–3 minutes.

Your live URL: **https://orionai-xxxx.onrender.com** 🎉

---

## 🔧 Common Render Errors & Fixes

### ❌ `ModuleNotFoundError`
**Cause:** Wrong build command or pip not upgraded  
**Fix:** Build command must be: `pip install --upgrade pip && pip install -r requirements.txt`

### ❌ `Address already in use` / port errors
**Cause:** Start command uses hardcoded port  
**Fix:** Always use `$PORT` in start command — never hardcode `8000`

### ❌ `Application failed to start`
**Cause:** GROQ_API_KEY missing  
**Fix:** Check Render → Environment tab — make sure keys are set

### ❌ `Build failed — Python version`
**Cause:** Render using wrong Python  
**Fix:** `runtime.txt` contains `python-3.11.0` — this pins the version

### ❌ Static files 404
**Cause:** Wrong working directory  
**Fix:** `main.py` uses `os.path.abspath` to resolve paths — already fixed

### ❌ Timeout on first request
**Cause:** Free tier cold start (normal)  
**Fix:** First request after 15min sleep takes ~30s. This is normal on free tier.

---

## 🌐 API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Serves chat UI |
| GET | `/health` | Health check (Render uses this) |
| POST | `/api/chat` | Non-streaming chat |
| POST | `/api/chat/stream` | SSE streaming chat |
| GET | `/api/models` | Available models |

---

## 🔑 Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `GROQ_API_KEY` | ✅ Yes | — | Groq API key |
| `TAVILY_API_KEY` | Optional | — | Tavily web search key |
| `AI_MODEL` | No | `llama-3.3-70b-versatile` | Groq model |
| `MAX_TOKENS` | No | `1024` | Max response tokens |
| `PORT` | Auto | `8000` | Set by Render automatically |

---

## 📋 Deployment Checklist

- [ ] `requirements.txt` has exact pinned versions
- [ ] `runtime.txt` contains `python-3.11.0`
- [ ] `render.yaml` start command uses `$PORT`
- [ ] `.env` is in `.gitignore` — NOT pushed to GitHub
- [ ] `GROQ_API_KEY` set in Render Environment tab
- [ ] `TAVILY_API_KEY` set in Render Environment tab
- [ ] Build succeeds — no red errors in Render logs
- [ ] `/health` returns `{"status": "ok", "groq_ready": true}`
- [ ] Chat works on live URL

---

## 🛠️ Tech Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.11, FastAPI, Uvicorn, Gunicorn |
| Frontend | HTML5, CSS3, Vanilla JS |
| AI | Groq — Llama 3.3 70B |
| Web Search | Tavily REST API (via httpx — no SDK) |
| Deploy | Render / Railway |
