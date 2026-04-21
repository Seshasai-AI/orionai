"""
OrionAI — Production Backend
=============================
FastAPI + Groq LLM + Tavily web search
Render/Railway/VPS deployment ready

Version: 3.0.0
"""

import os
import time
import logging
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
import httpx
from dotenv import load_dotenv

# ── Load .env (ignored on Render — env vars set in dashboard) ──────────────
load_dotenv()

# ── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

# ── Read config from environment ────────────────────────────────────────────
GROQ_API_KEY   = os.environ.get("GROQ_API_KEY", "")
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
DEFAULT_MODEL  = os.environ.get("AI_MODEL", "llama-3.3-70b-versatile")
MAX_TOKENS     = int(os.environ.get("MAX_TOKENS", "1024"))
PORT           = int(os.environ.get("PORT", "8000"))  # Render sets PORT automatically

GROQ_API_URL   = "https://api.groq.com/openai/v1/chat/completions"
TAVILY_API_URL = "https://api.tavily.com/search"

SYSTEM_PROMPT = os.environ.get(
    "SYSTEM_PROMPT",
    "You are OrionAI, a sharp and friendly AI assistant. "
    "Answer clearly and concisely. "
    "When web search data is provided, use ONLY that data. "
    "Give ONE clean answer. Never print raw URLs or source labels."
)

# ── Sports / search keyword lists ───────────────────────────────────────────
SPORTS_KW = [
    "ipl","cricket","match","winner","score","wicket","runs","innings",
    "t20","odi","test match","football","fifa","premier league","nba",
    "goal","result","final","semifinal","world cup","century","hat-trick",
]
SEARCH_KW = [
    "today","latest","current","now","recent","news","price","weather",
    "update","live","happened","stock","rate","2024","2025","2026",
    "who is","what is the","how much","when did","release","launch",
    "announced","trending",
]

def classify(query: str) -> str:
    q = query.lower()
    if any(k in q for k in SPORTS_KW): return "sports"
    if any(k in q for k in SEARCH_KW): return "search"
    return "none"

# ── Tavily search (pure httpx — no SDK dependency issues) ───────────────────

async def tavily_search(query: str, is_sports: bool = False) -> str:
    """
    Call Tavily REST API directly with httpx.
    Using the REST API avoids tavily-python SDK version conflicts on Render.
    """
    if not TAVILY_API_KEY:
        return ""
    try:
        search_query = f"{query} result scorecard" if is_sports else query
        payload = {
            "api_key":      TAVILY_API_KEY,
            "query":        search_query,
            "search_depth": "advanced",
            "max_results":  5,
            "include_answer": True,
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(TAVILY_API_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()

        parts = []

        # Tavily's own verified answer — most reliable
        direct = (data.get("answer") or "").strip()
        if direct:
            parts.append(f"VERIFIED ANSWER:\n{direct}")

        results = data.get("results", [])
        if is_sports:
            # For sports: only the single most detailed source
            candidates = [r for r in results if r.get("content")]
            if candidates:
                best = max(candidates, key=lambda r: len(r.get("content", "")))
                parts.append(f"DETAIL:\n{best['content'][:600]}")
        else:
            # For general: top 3 sources
            for r in results[:3]:
                content = (r.get("content") or "").strip()
                title   = (r.get("title")   or "").strip()
                if content:
                    parts.append(f"{title}:\n{content[:400]}")

        logger.info("🌐 Tavily [%s] — %d parts for: %s",
                    "sports" if is_sports else "general", len(parts), query[:50])
        return "\n\n".join(parts)

    except Exception as e:
        logger.warning("Tavily search failed: %s", e)
        return ""

# ── Pydantic models ─────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str    = Field(..., description="user or assistant")
    content: str = Field(..., description="Message text")

class ChatRequest(BaseModel):
    messages: List[Message]
    stream: bool = False

class ChatResponse(BaseModel):
    reply: str
    model: str
    usage: Optional[dict] = None

# ── Lifespan ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 OrionAI starting on port %d", PORT)
    logger.info("✅ GROQ_API_KEY: %s", "set" if GROQ_API_KEY else "MISSING ⚠️")
    logger.info("✅ TAVILY_API_KEY: %s", "set" if TAVILY_API_KEY else "not set (web search off)")
    logger.info("✅ Model: %s", DEFAULT_MODEL)
    yield
    logger.info("👋 OrionAI stopped")

# ── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="OrionAI",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files (frontend) ─────────────────────────────────────────────────
# Path works both locally and on Render
BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR  = os.path.join(BASE_DIR, "..", "frontend", "static")
FRONTEND_DIR= os.path.join(BASE_DIR, "..", "frontend")

if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=os.path.abspath(STATIC_DIR)), name="static")
    logger.info("📁 Static files mounted from: %s", os.path.abspath(STATIC_DIR))
else:
    logger.warning("⚠️ Static directory not found: %s", STATIC_DIR)

# ── Groq call ───────────────────────────────────────────────────────────────

async def call_groq(messages: List[dict], stream: bool = False):
    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY is not set. Add it in Render → Environment."
        )

    # Classify and search
    last_msg    = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    query_type  = classify(last_msg)
    system      = SYSTEM_PROMPT

    if query_type != "none" and last_msg:
        web_ctx = await tavily_search(last_msg, is_sports=(query_type == "sports"))
        if web_ctx:
            system += (
                "\n\n=== LIVE SEARCH DATA ===\n"
                f"{web_ctx}\n"
                "=== END DATA ===\n"
                "Use ONLY the above. One clean answer. No URLs. No source labels."
            )

    payload = {
        "model":       DEFAULT_MODEL,
        "messages":    [{"role": "system", "content": system}] + messages,
        "max_tokens":  MAX_TOKENS,
        "temperature": 0.3,
        "stream":      stream,
    }
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type":  "application/json",
    }

    client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
    try:
        response = await client.post(GROQ_API_URL, json=payload, headers=headers)
        response.raise_for_status()
        return response, client
    except httpx.HTTPStatusError as e:
        await client.aclose()
        logger.error("Groq HTTP %s: %s", e.response.status_code, e.response.text)
        raise HTTPException(status_code=e.response.status_code,
                            detail=f"Groq error: {e.response.text}")
    except httpx.RequestError as e:
        await client.aclose()
        logger.error("Groq network error: %s", e)
        raise HTTPException(status_code=503, detail="AI service unreachable.")

# ── Routes ──────────────────────────────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def root():
    """Serve the frontend."""
    index = os.path.join(os.path.abspath(FRONTEND_DIR), "index.html")
    if os.path.exists(index):
        return FileResponse(index)
    return JSONResponse({"status": "OrionAI API running", "docs": "/docs"})


@app.get("/health")
async def health():
    """Render uses this for health checks."""
    return {
        "status":             "ok",
        "version":            "3.0.0",
        "model":              DEFAULT_MODEL,
        "groq_ready":         bool(GROQ_API_KEY),
        "web_search_ready":   bool(TAVILY_API_KEY),
        "timestamp":          time.time(),
    }


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Non-streaming chat."""
    msgs = [{"role": m.role, "content": m.content} for m in req.messages]
    response, client = await call_groq(msgs, stream=False)
    await client.aclose()
    data  = response.json()
    reply = data["choices"][0]["message"]["content"]
    return ChatResponse(reply=reply, model=DEFAULT_MODEL, usage=data.get("usage"))


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    """SSE streaming chat — tokens forwarded as they arrive."""
    msgs = [{"role": m.role, "content": m.content} for m in req.messages]

    async def generator():
        response, client = await call_groq(msgs, stream=True)
        try:
            async for line in response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                chunk = line[len("data:"):].strip()
                if chunk == "[DONE]":
                    yield "data: [DONE]\n\n"
                    break
                yield f"data: {chunk}\n\n"
        finally:
            await client.aclose()

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/models")
async def models():
    return {
        "current": DEFAULT_MODEL,
        "available": [
            {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B"},
            {"id": "llama-3.1-8b-instant",    "name": "Llama 3.1 8B (Fast)"},
            {"id": "mixtral-8x7b-32768",       "name": "Mixtral 8x7B"},
            {"id": "gemma2-9b-it",             "name": "Gemma 2 9B"},
        ],
    }


# ── Exception handler ────────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled error: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Check server logs."}
    )
