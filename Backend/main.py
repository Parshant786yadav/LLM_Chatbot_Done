from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from typing import Optional, List
import os
import secrets
import bcrypt
import io
import re
import time
from dotenv import load_dotenv
from groq import Groq
from fastapi import UploadFile, File, Form
from pypdf import PdfReader
from rag import split_text, create_embedding, create_embeddings_batch
from authlib.integrations.starlette_client import OAuth
from authlib.integrations.base_client.errors import OAuthError
from starlette.config import Config
from fastapi import Request
from fastapi.responses import RedirectResponse
from starlette.middleware.sessions import SessionMiddleware
from starlette.staticfiles import StaticFiles
import urllib.parse
# import smtplib
import random
# from email.mime.text import MIMEText
# from email.mime.multipart import MIMEMultipart
# from email.utils import formataddr
import asyncio
import json
from rag import cosine_similarity

from database import get_supabase
import db_ops
from schema_ensure import (
    try_ensure_user_api_keys_table,
    is_missing_user_api_keys_table_error,
    detail_table_missing_help,
)


from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates




# Paths relative to this file so they work regardless of CWD
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_STATIC_DIR = os.path.join(_BACKEND_DIR, "static")
_TEMPLATES_DIR = os.path.join(_BACKEND_DIR, "templates")
# Frontend directory (sibling of Backend) – served at / so one server is enough
FRONTEND_DIR = os.path.join(_BACKEND_DIR, "..", "Frontend")

# Image support: OCR for text extraction (EasyOCR – no Tesseract required)
_easyocr_reader = None

def _get_easyocr_reader():
    """Lazy-load EasyOCR reader once (loads model on first image upload)."""
    return None

_IMAGE_OCR_AVAILABLE = False
np = None

# Do not override real deployment env vars (e.g. Render) with a local .env file.
load_dotenv(override=False)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "document_storage")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Supabase Storage bucket for PDFs/images (so files work when deployed)
STORAGE_BUCKET = "documents"

def _ensure_storage_bucket():
    """Create the documents bucket in Supabase Storage if it does not exist."""
    try:
        sb = get_supabase()
        buckets = sb.storage.list_buckets()
        for b in buckets or []:
            bid = getattr(b, "id", None) or (b.get("id") if isinstance(b, dict) else None)
            if bid == STORAGE_BUCKET:
                return
        sb.storage.create_bucket(STORAGE_BUCKET, options={"public": False})
    except Exception:
        pass  # e.g. permission or already exists; upload will retry create on 404

def _is_local_file_path(file_path: Optional[str]) -> bool:
    """True if file_path is a path to a local file that exists."""
    if not file_path or not isinstance(file_path, str):
        return False
    return os.path.isfile(file_path)

def _upload_to_storage(storage_path: str, content: bytes, content_type: str) -> None:
    """Upload file bytes to Supabase Storage. storage_path is e.g. '6/3_report.pdf'."""
    sb = get_supabase()
    opts = {"content-type": content_type}
    try:
        sb.storage.from_(STORAGE_BUCKET).upload(storage_path, content, file_options=opts)
    except Exception as e:
        if "Bucket not found" in str(e) or "404" in str(e):
            _ensure_storage_bucket()
            sb.storage.from_(STORAGE_BUCKET).upload(storage_path, content, file_options=opts)
        else:
            raise

def _download_from_storage(storage_path: str) -> bytes:
    """Download file bytes from Supabase Storage."""
    sb = get_supabase()
    return sb.storage.from_(STORAGE_BUCKET).download(storage_path)

def _delete_from_storage(storage_path: str) -> None:
    """Remove file from Supabase Storage."""
    try:
        sb = get_supabase()
        sb.storage.from_(STORAGE_BUCKET).remove([storage_path])
    except Exception:
        pass

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None


# Message Cache for fast chat history loading
class MessageCache:
    """
    In-memory cache for message responses with TTL.
    Thread-safe with asyncio locks.
    """
    
    def __init__(self, ttl_seconds: int = 60):
        self._cache: dict[tuple[int, int], dict] = {}
        self._timestamps: dict[tuple[int, int], float] = {}
        self._lock = asyncio.Lock()
        self._ttl = ttl_seconds
    
    async def get(self, user_id: int, chat_id: int) -> Optional[dict]:
        """Retrieve cached response if not expired."""
        async with self._lock:
            key = (user_id, chat_id)
            if key not in self._cache:
                return None
            
            # Check if expired
            if time.time() - self._timestamps[key] > self._ttl:
                del self._cache[key]
                del self._timestamps[key]
                return None
            
            return self._cache[key]
    
    async def set(self, user_id: int, chat_id: int, data: dict) -> None:
        """Store response with current timestamp."""
        async with self._lock:
            key = (user_id, chat_id)
            self._cache[key] = data
            self._timestamps[key] = time.time()
    
    async def invalidate(self, user_id: int, chat_id: int) -> None:
        """Remove cache entry (called when new message added or chat claimed)."""
        async with self._lock:
            key = (user_id, chat_id)
            if key in self._cache:
                del self._cache[key]
            if key in self._timestamps:
                del self._timestamps[key]
    
    async def cleanup_expired(self) -> None:
        """Remove expired entries (background task)."""
        async with self._lock:
            now = time.time()
            expired_keys = [
                key for key, ts in self._timestamps.items()
                if now - ts > self._ttl
            ]
            for key in expired_keys:
                if key in self._cache:
                    del self._cache[key]
                if key in self._timestamps:
                    del self._timestamps[key]


# Global message cache instance
_message_cache = MessageCache(ttl_seconds=60)


app = FastAPI(title="Enterprise AI Assistant Backend")

# Static files (CSS, JS) – use absolute path so it works regardless of CWD
app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")
# Templates for HTML
templates = Jinja2Templates(directory=_TEMPLATES_DIR)


# @app.get("/", response_class=HTMLResponse)
# def home(request: Request):
#     return templates.TemplateResponse("index.html", {"request": request})
@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
def home(request: Request):
    if request.method == "HEAD":
        return Response(status_code=200)
    return templates.TemplateResponse(request=request, name="index.html")


@app.on_event("startup")
async def startup():
    _ensure_storage_bucket()
    # Log effective Resend sender so Render logs confirm env (not sandbox) is loaded.
    try:
        print(f"[Resend] OTP from address at startup: {_resolve_resend_from()}", flush=True)
    except Exception as e:
        print(f"[Resend] Could not resolve sender at startup: {e}", flush=True)
    try:
        if try_ensure_user_api_keys_table():
            print("[API_KEYS] user_api_keys table is available.", flush=True)
        else:
            print(
                "[API_KEYS] user_api_keys not available yet. "
                "Run supabase_migration_user_api_keys.sql or set SUPABASE_DB_URL / DATABASE_URL for auto-create.",
                flush=True,
            )
    except Exception as e:
        print(f"[API_KEYS] Startup ensure failed (non-fatal): {e}", flush=True)
    # Start background cache cleanup task
    asyncio.create_task(_cache_cleanup_task())


async def _cache_cleanup_task():
    """Background task to clean up expired cache entries every 60 seconds."""
    while True:
        await asyncio.sleep(60)
        try:
            await _message_cache.cleanup_expired()
            print("[CACHE] Cleanup completed", flush=True)
        except Exception as e:
            print(f"[ERROR] Cache cleanup failed: {str(e)}", flush=True)



app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET_KEY", "change-me-in-production-use-env"),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    mode: Optional[str] = "personal"  # "personal" or "company" – must be "company" for same-domain doc access
    email: Optional[str] = None
    chat: Optional[str] = None
    message: str


class RenameChatRequest(BaseModel):
    email: str
    old_name: str
    new_name: str


class CreateChatRequest(BaseModel):
    email: str
    name: str
    mode: str  # "personal" or "company" for user display_id when creating user


class ClaimChatRequest(BaseModel):
    guest_chat_name: str  # chat name used for anonymous session (e.g. UUID)
    email: str  # real user email after login


class CompanySettingsUpdate(BaseModel):
    email: str
    show_doc_count_to_employees: bool


class AddAdminRequest(BaseModel):
    email: str  # current admin (caller)
    new_admin_email: str  # email to add as admin


class RemoveAdminRequest(BaseModel):
    email: str  # current admin (caller)
    remove_admin_email: str  # email to remove from admins


class SendOtpRequest(BaseModel):
    email: str


class VerifyOtpRequest(BaseModel):
    email: str
    otp: str
    mode: Optional[str] = "personal"  # "personal" or "company"


class CreateUserApiKeyRequest(BaseModel):
    email: str
    scope: str  # "chat" | "global"
    chat_name: Optional[str] = None  # required when scope == "chat"
    label: Optional[str] = None


class RevokeUserApiKeyRequest(BaseModel):
    email: str
    key_id: int


class ExternalChatMessage(BaseModel):
    role: str
    content: str


class ExternalChatRequest(BaseModel):
    message: str
    history: Optional[List[ExternalChatMessage]] = None


# In-memory OTP store: { email_lower: { "otp": "123456", "expires_at": unix_ts } }
_otp_store: dict = {}
OTP_EXPIRE_SECONDS = 600  # 10 minutes
SECRET_TEST_OTP = "882644"  # Secret OTP for testing; accepts login without email OTP

_RESEND_SANDBOX_FROM = "DocuMind <onboarding@resend.dev>"


def _resolve_resend_from() -> str:
    """
    Build the Resend 'from' field. Resend only allows arbitrary recipients when
    'from' uses a verified domain — not onboarding@resend.dev.

    Prefer RESEND_FROM_ADDRESS=noreply@yourdomain.com (avoids angle-bracket issues
    in hosting dashboards). Otherwise use RESEND_FROM_EMAIL or RESEND_FROM.
    """
    name = (os.getenv("RESEND_FROM_NAME") or "DocuMind").strip() or "DocuMind"
    addr_only = (os.getenv("RESEND_FROM_ADDRESS") or "").strip()
    if addr_only and "@" in addr_only:
        return f"{name} <{addr_only}>"

    raw = (os.getenv("RESEND_FROM_EMAIL") or os.getenv("RESEND_FROM") or "").strip()
    if not raw:
        return _RESEND_SANDBOX_FROM

    raw = raw.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace("\u2019", "'")
    raw = raw.replace("\uff1c", "<").replace("\uff1e", ">")
    raw = raw.strip()

    # Bare email only (no display name)
    if re.match(r"^[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}$", raw):
        return f"{name} <{raw}>"

    return raw


def _send_otp_email(to_email: str, otp: str) -> None:
    """Send OTP via Resend API (works on Render - no SMTP needed)."""
    import urllib.request, urllib.error, json as _json
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    if not api_key:
        raise ValueError("RESEND_API_KEY must be set in environment")
    from_email = _resolve_resend_from()
    if "onboarding@resend.dev" in from_email or "@resend.dev" in from_email:
        print(
            "[OTP] WARNING: Using Resend sandbox sender. Set RESEND_FROM_ADDRESS=noreply@yourdomain.com "
            "or RESEND_FROM_EMAIL on a verified domain to mail arbitrary recipients.",
            flush=True,
        )
    print(f"[OTP] Sending from: {from_email}", flush=True)
    payload = _json.dumps({
        "from": from_email,
        "to": [to_email],
        "subject": "OTP From DocuMind",
        "html": f"""
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
            <h2>Your One-Time Password from DocuMind</h2>
            <p>Your OTP is:</p>
            <h1 style="color:#2563eb;letter-spacing:4px;">{otp}</h1>
            <p>It expires in <strong>10 minutes</strong>.</p>
            <p>If you didn't request this, please ignore this email.</p>
            <p>DocuMind Team</p>
        </div>"""
    }).encode()
    # Resend returns 403 error code 1010 if User-Agent is missing (common with urllib on some hosts).
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "DocuMind/1.0 (+https://resend.com/docs)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[OTP] Resend error {e.code}: {body}", flush=True)
        raise ValueError(f"Resend API error: {body}")


def _otp_cleanup_expired():
    """Remove expired OTPs from store."""
    now = time.time()
    to_remove = [k for k, v in _otp_store.items() if v["expires_at"] < now]
    for k in to_remove:
        del _otp_store[k]


@app.post("/auth/send-otp")
def send_otp(body: SendOtpRequest):
    """Send a 6-digit OTP to the given email. Uses Gmail SMTP (set GMAIL_OTP_EMAIL and GMAIL_OTP_APP_PASSWORD in .env)."""
    email = (body.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")
    _otp_cleanup_expired()
    otp = "".join(str(random.randint(0, 9)) for _ in range(6))
    _otp_store[email] = {"otp": otp, "expires_at": time.time() + OTP_EXPIRE_SECONDS}
    try:
        _send_otp_email(email, otp)
    except Exception as e:
        if email in _otp_store:
            del _otp_store[email]
        raise HTTPException(status_code=500, detail="Failed to send OTP: " + str(e))
    return {"ok": True, "message": "OTP sent to your email"}


@app.post("/auth/verify-otp")
def verify_otp(body: VerifyOtpRequest):
    """Verify OTP for the given email. On success, returns ok (user can log in with that email)."""
    email = (body.email or "").strip().lower()
    otp = (body.otp or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")
    if not otp:
        raise HTTPException(status_code=400, detail="OTP required")
    _otp_cleanup_expired()
    # Accept secret test OTP or real email OTP
    if otp == SECRET_TEST_OTP:
        if email in _otp_store:
            del _otp_store[email]
    else:
        stored = _otp_store.get(email)
        if not stored:
            raise HTTPException(status_code=400, detail="OTP expired or not found. Please request a new one.")
        if stored["otp"] != otp:
            raise HTTPException(status_code=400, detail="Invalid OTP")
        del _otp_store[email]
    # Ensure user exists (same as after Google login)
    user = db_ops.get_user_by_email(email)
    if not user:
        display_id = db_ops.get_next_display_id((body.mode or "personal").strip().lower())
        company = None
        if (body.mode or "").strip().lower() == "company":
            domain = _extract_domain(email)
            if domain:
                company = db_ops.get_or_create_company(domain)
        company_id = company["id"] if company else None
        db_ops.create_user(email, display_id, "company" if company else "personal", company_id)
    return {"ok": True}


def _extract_domain(email: str) -> Optional[str]:
    """Extract domain from email (e.g. hr@company.com -> company.com). Returns None if no @."""
    if not email or "@" not in email:
        return None
    return email.strip().split("@")[-1].lower()


def _is_hr_email(email: str) -> bool:
    """True if email is HR (hr@companyname) – only HR can upload company documents."""
    return bool(email and str(email).strip().lower().startswith("hr@"))


SUPER_ADMIN_EMAIL = "parshant786yadav@gmail.com"


def _is_admin(email: str) -> bool:
    """True if email is in admins table (can see Database)."""
    return db_ops.is_admin(email)


def _is_super_admin(email: str) -> bool:
    """True if email is the super admin (only one who can add/remove admins)."""
    return (email or "").strip().lower() == SUPER_ADMIN_EMAIL


def _get_or_create_company(domain: str):
    """Get or create Company by domain. Returns Company dict or None."""
    if not domain:
        return None
    return db_ops.get_or_create_company(domain)


def _is_quota_error(e: Exception) -> bool:
    err = str(e).upper()
    return "429" in err or "RATE_LIMIT" in err or "RESOURCE_EXHAUSTED" in err or "QUOTA" in err


def _call_groq_with_history(groq_client: Groq, model: str, history_user_contents: list[str], final_prompt: str) -> str:
    """Call Groq chat with conversation history. Returns reply text or raises."""
    messages = [{"role": "user", "content": c} for c in history_user_contents]
    messages.append({"role": "user", "content": final_prompt})
    response = groq_client.chat.completions.create(
        model=model,
        messages=messages,
    )
    if response.choices and len(response.choices) > 0 and response.choices[0].message:
        return response.choices[0].message.content or "No reply"
    return "No reply"


# Max conversation turns to send to the LLM (user+assistant pairs) so the chat "remembers" most of the thread
_MAX_CHAT_HISTORY_TURNS = 25  # last 25 exchanges (50 messages)

def _call_groq_with_system(
    groq_client: Groq,
    model: str,
    system_instruction: str,
    history_messages: list[dict],
    final_prompt: str,
) -> str:
    """Call Groq with system role + full conversation history (user + assistant)."""
    messages = [{"role": "system", "content": system_instruction}]
    for m in history_messages:
        role = m.get("role", "user")
        if role == "model":
            role = "assistant"
        if role in ("user", "assistant") and m.get("content"):
            messages.append({"role": role, "content": m["content"]})
    messages.append({"role": "user", "content": final_prompt})
    response = groq_client.chat.completions.create(
        model=model,
        messages=messages,
    )
    if response.choices and len(response.choices) > 0 and response.choices[0].message:
        return response.choices[0].message.content or "No reply"
    return "No reply"


# Primary and fallback models (Groq-hosted LLaMA / Mixtral)
CHAT_MODEL_PRIMARY = "llama-3.3-70b-versatile"
CHAT_MODEL_FALLBACK = "llama-3.1-8b-instant"


def _identity_reply(message: str) -> Optional[str]:
    """Short answers for name / creator questions (before calling the LLM)."""
    t = (message or "").strip().lower()
    if not t:
        return None
    creator_phrases = (
        "who made you",
        "who made u",
        "who created you",
        "who created u",
        "who built you",
        "who developed you",
        "who programmed you",
        "who is your creator",
        "your creator",
        "who owns you",
    )
    name_phrases = (
        "your name",
        "what is your name",
        "what's your name",
        "whats your name",
        "who are you",
        "what should i call you",
        "do you have a name",
        "what are you called",
    )
    asks_creator = any(p in t for p in creator_phrases)
    asks_name = any(p in t for p in name_phrases)
    if asks_creator and asks_name:
        return "I'm DocuMind, and Parshant created me."
    if asks_creator:
        return "Parshant"
    if asks_name:
        return "DocuMind"
    if t in ("name?", "name", "who are you?", "what's ur name", "whats ur name"):
        return "DocuMind"
    return None


_API_KEY_PATTERN = re.compile(r"^dm_([a-f0-9]{16})_([a-f0-9]{32})$", re.IGNORECASE)


def _generate_user_api_key_tuple() -> tuple[str, str, str]:
    """Returns (lookup_id, plaintext_full_key, bcrypt_hash_utf8)."""
    lookup_id = secrets.token_hex(8)
    secret = secrets.token_hex(16)
    full_key = f"dm_{lookup_id}_{secret}"
    h = bcrypt.hashpw(full_key.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    return lookup_id, full_key, h


def _parse_bearer_api_key(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not isinstance(authorization, str):
        return None
    s = authorization.strip()
    if s.lower().startswith("bearer "):
        return s[7:].strip() or None
    return s or None


def _resolve_user_api_key_row(raw_key: str) -> Optional[dict]:
    m = _API_KEY_PATTERN.match((raw_key or "").strip())
    if not m:
        return None
    lookup_id = m.group(1).lower()
    secret_hex = m.group(2).lower()
    full_key = f"dm_{lookup_id}_{secret_hex}"
    row = db_ops.get_user_api_key_by_lookup_id(lookup_id)
    if not row:
        return None
    try:
        ok = bcrypt.checkpw(full_key.encode("utf-8"), (row.get("key_hash") or "").encode("utf-8"))
    except Exception:
        return None
    if not ok:
        return None
    return row


def _user_allowed_api_keys(user: dict) -> bool:
    """API keys are for personal workspaces only (not company mode)."""
    if not user:
        return False
    if (user.get("user_type") or "").strip().lower() == "company":
        return False
    if user.get("company_id") is not None:
        return False
    return True


def _normalize_api_history(history: Optional[List[ExternalChatMessage]]) -> list[dict]:
    out: list[dict] = []
    if not history:
        return out
    for m in history[:120]:
        role = (m.role or "").strip().lower()
        content = (m.content or "").strip()
        if not content or len(content) > 32000:
            continue
        if role == "model":
            role = "assistant"
        if role not in ("user", "assistant"):
            continue
        out.append({"role": role, "content": content})
    return out[-(_MAX_CHAT_HISTORY_TURNS * 2) :]


def _rag_user_contents_for_query(
    history_messages: list[dict],
    current_message: str,
    full_history_user_contents: Optional[list] = None,
) -> list[str]:
    """User message strings for embedding query (last 10), including current message."""
    if full_history_user_contents is not None:
        parts = [str(p) for p in full_history_user_contents if p is not None and str(p).strip()]
        if not parts and (current_message or "").strip():
            parts = [(current_message or "").strip()]
        return parts[-10:] if parts else []
    users = [m.get("content") for m in history_messages if m.get("role") == "user" and m.get("content")]
    msg = (current_message or "").strip()
    if msg and (not users or users[-1] != msg):
        users = users + [msg]
    return users[-10:] if users else ([msg] if msg else [])


def _docmind_reply_from_rag(
    chunks: list,
    message: str,
    history_messages: list[dict],
    rag_user_contents: list[str],
) -> dict:
    """Build RAG context from chunks and return {\"reply\": str}. Uses global Groq client."""
    if not client:
        return {"reply": "GROQ_API_KEY not found in .env"}

    rag_query_parts = rag_user_contents[-10:] if rag_user_contents else [(message or "").strip()]
    rag_query = " ".join(str(p) for p in rag_query_parts if p).strip() or (message or "").strip()

    context = ""
    if chunks:
        query_embedding = create_embedding(rag_query)
        scored_chunks = []
        for ch in chunks:
            emb = ch.get("embedding")
            if not emb:
                continue
            chunk_embedding = json.loads(emb) if isinstance(emb, str) else emb
            score = cosine_similarity(query_embedding, chunk_embedding)
            scored_chunks.append((score, ch.get("content") or ""))
        scored_chunks.sort(key=lambda x: x[0], reverse=True)
        print(f"[CHAT] Total chunks: {len(chunks)}, Top scores: {[round(s,3) for s,_ in scored_chunks[:5]]}", flush=True)
        top_chunks = [c[1] for c in scored_chunks[:5] if c[0] > 0.05]
        print(f"[CHAT] Context chunks used: {len(top_chunks)}", flush=True)
        context = "\n\n".join(top_chunks) if top_chunks else ""

    system_instruction = (
        "You are DocuMind, a friendly, helpful AI assistant. Talk naturally like a human—warm, conversational, and engaging. "
        "If the user asks your name or what to call you, say your name is DocuMind. "
        "If they ask who made you, who created you, or who built you, say Parshant. "
        "For greetings (e.g. hello, hi, how are you), small talk, or general questions, respond in a natural way. "
        "When the user has provided 'Relevant context from documents' below, use that context to answer questions about the documents when relevant; "
        "otherwise answer from your knowledge or chat normally. Never say you don't know for simple greetings or chitchat."
    )
    final_prompt = (
        f"""Relevant context from the user's uploaded documents:

{context}

---

User: {message}"""
        if context.strip()
        else message
    )

    reply = None
    last_error = None
    for model in (CHAT_MODEL_PRIMARY, CHAT_MODEL_FALLBACK):
        try:
            reply = _call_groq_with_system(client, model, system_instruction, history_messages, final_prompt)
            break
        except Exception as e:
            last_error = e
            if _is_quota_error(e):
                continue
            raise

    if reply is None and last_error and _is_quota_error(last_error):
        return {"reply": "Rate limit reached. Please try again in a few minutes or check https://console.groq.com/docs/rate-limits"}
    if reply is None:
        raise last_error or RuntimeError("No reply from model")
    return {"reply": reply}


def _chat_sync(req: ChatRequest):
    """Sync chat logic so we can run it in a thread and not block the event loop."""
    try:
        email = req.email or "guest"
        mode = (req.mode or "personal").strip().lower()
        user = db_ops.get_user_by_email(email)
        if not user:
            display_id = db_ops.get_next_display_id(req.mode or "personal")
            company = None
            if mode == "company":
                domain = _extract_domain(email)
                if domain:
                    company = _get_or_create_company(domain)
            company_id = company["id"] if company else None
            user = db_ops.create_user(email, display_id, "company" if company else "personal", company_id)
        elif mode == "company" and user.get("company_id") is None:
            domain = _extract_domain(email)
            if domain:
                company = _get_or_create_company(domain)
                if company:
                    get_supabase().table("users").update({"user_type": "company", "company_id": company["id"]}).eq("id", user["id"]).execute()
                    user = db_ops.get_user_by_email(email)

        chat_name = req.chat or "default"
        chat = db_ops.get_chat_by_user_and_name(user["id"], chat_name)
        if not chat:
            chat = db_ops.create_chat(user["id"], chat_name, user.get("display_id") or "")

        db_ops.add_message(chat["id"], "user", req.message, user.get("display_id"))

        identity = _identity_reply(req.message)
        if identity is not None:
            db_ops.add_message(chat["id"], "model", identity, user.get("display_id"))
            return {"reply": identity}

        history = db_ops.get_messages_for_chat(chat["id"])
        history_excluding_current = history[:-1] if len(history) > 1 else []
        history_tail = history_excluding_current[-(_MAX_CHAT_HISTORY_TURNS * 2):]
        history_messages = [{"role": m.get("role", "user"), "content": m.get("content") or ""} for m in history_tail]
        history_user_contents = [m.get("content") for m in history if m.get("role") == "user"]

        if user.get("company_id") is not None:
            chunks = db_ops.get_document_chunks_company(user["company_id"])
        else:
            chunks = db_ops.get_document_chunks_personal(user["id"], chat["id"])

        rag_users = _rag_user_contents_for_query(history_messages, req.message, history_user_contents)
        result = _docmind_reply_from_rag(chunks, req.message, history_messages, rag_users)
        db_ops.add_message(chat["id"], "model", result["reply"], user.get("display_id"))
        return {"reply": result["reply"]}

    except Exception as e:
        if _is_quota_error(e):
            return {"reply": "Groq rate limit exceeded. Please try again in a few minutes or check https://console.groq.com/docs/rate-limits"}
        err_str = str(e)
        if "PGRST205" in err_str or "could not find the table" in err_str.lower() or "schema cache" in err_str.lower():
            return {"reply": "Database not set up. In Supabase Dashboard → SQL Editor, run the SQL from Backend/supabase_schema.sql to create the required tables (users, chats, messages, etc.)."}
        return {"reply": f"Error: {err_str}"}

@app.post("/chat")
async def chat(req: ChatRequest):
    if not GROQ_API_KEY or not client:
        return {"reply": "GROQ_API_KEY not found in .env"}
    
    # Get user and chat info for cache invalidation
    email = req.email or "guest"
    user = db_ops.get_user_by_email(email)
    if user:
        chat_name = req.chat or "default"
        chat = db_ops.get_chat_by_user_and_name(user["id"], chat_name)
        if chat:
            # Invalidate cache before processing (new messages will be added)
            await _message_cache.invalidate(user["id"], chat["id"])
    
    return await asyncio.to_thread(_chat_sync, req)


class UnauthorizedApiKeyError(Exception):
    """Invalid or revoked API key (used by /api/v1/chat)."""


def _external_api_chat_sync(raw_key: str, body: ExternalChatRequest) -> dict:
    try_ensure_user_api_keys_table()
    row = _resolve_user_api_key_row(raw_key)
    if not row:
        raise UnauthorizedApiKeyError()

    user = db_ops.get_user_by_id(int(row["user_id"]))
    if not user or not _user_allowed_api_keys(user):
        raise UnauthorizedApiKeyError()

    scope = (row.get("scope") or "").strip().lower()
    if scope == "chat":
        cid = row.get("chat_id")
        if cid is None:
            raise UnauthorizedApiKeyError()
        chat = db_ops.get_chat_by_id(int(cid))
        if not chat or int(chat["user_id"]) != int(user["id"]):
            raise UnauthorizedApiKeyError()
        chunks = db_ops.get_document_chunks_chat_scoped(int(user["id"]), int(cid))
    elif scope == "global":
        chunks = db_ops.get_document_chunks_global_scoped(int(user["id"]))
    else:
        raise UnauthorizedApiKeyError()

    msg = (body.message or "").strip()
    if not msg:
        return {"reply": "message is required", "error": "bad_request"}
    if len(msg) > 32000:
        return {"reply": "message too long", "error": "bad_request"}

    history_messages = _normalize_api_history(body.history)
    identity = _identity_reply(msg)
    if identity is not None:
        return {"reply": identity}

    rag_users = _rag_user_contents_for_query(history_messages, msg, None)
    result = _docmind_reply_from_rag(chunks, msg, history_messages, rag_users)
    return {"reply": result["reply"]}


@app.post("/api-keys/create")
def create_user_api_key(body: CreateUserApiKeyRequest):
    email = (body.email or "").strip().lower()
    user = db_ops.get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not _user_allowed_api_keys(user):
        raise HTTPException(status_code=403, detail="API keys are only available for personal accounts.")
    scope = (body.scope or "").strip().lower()
    if scope not in ("chat", "global"):
        raise HTTPException(status_code=400, detail="scope must be 'chat' or 'global'")

    chat_id: Optional[int] = None
    if scope == "chat":
        cname = (body.chat_name or "").strip()
        if not cname:
            raise HTTPException(status_code=400, detail="chat_name is required for chat-scoped keys")
        chat = db_ops.get_chat_by_user_and_name(user["id"], cname)
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found")
        chat_id = int(chat["id"])

    label = (body.label or "").strip() or None
    try_ensure_user_api_keys_table()
    lookup_id, full_key, key_hash = _generate_user_api_key_tuple()
    try:
        ins = db_ops.insert_user_api_key(int(user["id"]), scope, chat_id, lookup_id, key_hash, label)
    except Exception as e:
        err_str = str(e)
        if is_missing_user_api_keys_table_error(err_str):
            try_ensure_user_api_keys_table(reset=True)
            try:
                ins = db_ops.insert_user_api_key(int(user["id"]), scope, chat_id, lookup_id, key_hash, label)
            except Exception as e2:
                raise HTTPException(status_code=503, detail=detail_table_missing_help()) from e2
        else:
            raise

    return {
        "api_key": full_key,
        "key_id": ins["id"],
        "scope": scope,
        "chat_id": chat_id,
        "message": "Save this key now; it will not be shown again.",
    }


@app.get("/api-keys/list")
def list_user_api_keys_endpoint(email: str):
    user = db_ops.get_user_by_email((email or "").strip().lower())
    if not user or not _user_allowed_api_keys(user):
        return {"keys": []}
    try_ensure_user_api_keys_table()
    try:
        keys = db_ops.list_user_api_keys(user["id"])
    except Exception as e:
        err_str = str(e)
        if is_missing_user_api_keys_table_error(err_str):
            try_ensure_user_api_keys_table(reset=True)
            try:
                keys = db_ops.list_user_api_keys(user["id"])
            except Exception:
                return {"keys": [], "warning": detail_table_missing_help()}
        else:
            raise
    out = []
    for k in keys:
        lid = (k.get("lookup_id") or "") or ""
        masked = (lid[:4] + "…" + lid[-4:]) if len(lid) >= 8 else "••••"
        out.append(
            {
                "id": k["id"],
                "scope": k["scope"],
                "chat_id": k.get("chat_id"),
                "label": k.get("label"),
                "created_at": k.get("created_at"),
                "key_hint": masked,
            }
        )
    return {"keys": out}


@app.post("/api-keys/revoke")
def revoke_user_api_key_endpoint(body: RevokeUserApiKeyRequest):
    email = (body.email or "").strip().lower()
    user = db_ops.get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not _user_allowed_api_keys(user):
        raise HTTPException(status_code=403, detail="Not allowed")
    try_ensure_user_api_keys_table()
    if not db_ops.revoke_user_api_key(user["id"], int(body.key_id)):
        raise HTTPException(status_code=404, detail="Key not found or already revoked")
    return {"ok": True}


@app.post("/api/v1/chat")
async def external_api_chat(request: Request, body: ExternalChatRequest):
    raw = _parse_bearer_api_key(request.headers.get("Authorization"))
    if not raw:
        raise HTTPException(status_code=401, detail="Missing Authorization: Bearer <api_key>")
    if not GROQ_API_KEY or not client:
        return {"reply": "GROQ_API_KEY not found in .env"}

    try:
        return await asyncio.to_thread(_external_api_chat_sync, raw, body)
    except UnauthorizedApiKeyError:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key") from None
    except HTTPException:
        raise
    except Exception as e:
        if _is_quota_error(e):
            return {"reply": "Groq rate limit exceeded. Please try again in a few minutes or check https://console.groq.com/docs/rate-limits"}
        err_str = str(e)
        if is_missing_user_api_keys_table_error(err_str):
            return {"reply": detail_table_missing_help()}
        return {"reply": f"Error: {err_str}"}


def _sanitize_filename(name: str) -> str:
    """Keep filename safe for storage."""
    return re.sub(r'[^\w\s\-\.]', '_', name).strip() or "document"


# PDF and image types for upload
_ALLOWED_PDF = {"application/pdf"}
_ALLOWED_IMAGE = set() # Image upload disabled to save memory
_ALLOWED_CONTENT_TYPES = _ALLOWED_PDF | _ALLOWED_IMAGE

# If a PDF page has fewer characters than this from pypdf, render the page and run OCR (scanned / photo PDFs).
_PDF_OCR_MIN_CHARS_PER_PAGE = int(os.getenv("PDF_OCR_MIN_CHARS_PER_PAGE", "42"))
# Cap OCR passes per upload so huge scans do not time out (remaining pages keep vector text only).
_PDF_OCR_MAX_PAGES = int(os.getenv("PDF_OCR_MAX_PAGES", "60"))


def _ocr_pdf_page_fitz(pdf_bytes: bytes, page_index: int) -> str:
    """Render one PDF page to a bitmap and OCR it (PyMuPDF + EasyOCR). Empty string if libraries missing or on error."""
    return ""


def _ocr_placeholder(text: str) -> bool:
    """True if OCR returned the fallback 'Image document: …' with almost no real text."""
    t = (text or "").strip()
    if not t.startswith("Image document:"):
        return False
    return len(t) < 80


def _extract_text_from_pdf(content: bytes, filename: str) -> str:
    """
    Extract text from PDF: digital text via pypdf, plus OCR on pages with little/no text (scanned pages, photos).
    """
    reader = PdfReader(io.BytesIO(content))
    pages = reader.pages
    if not pages:
        return ""

    ocr_used = 0
    parts: list[str] = []
    for i, page in enumerate(pages):
        vec = (page.extract_text() or "").strip()
        if len(vec) < _PDF_OCR_MIN_CHARS_PER_PAGE and ocr_used < _PDF_OCR_MAX_PAGES:
            ocr_used += 1
            ocr = _ocr_pdf_page_fitz(content, i).strip()
            if ocr and not _ocr_placeholder(ocr):
                vec = (vec + "\n" + ocr).strip() if vec else ocr
            elif not vec and ocr:
                vec = ocr
        parts.append(vec)

    return "\n\n".join(p for p in parts if p)


import base64

def _extract_text_from_image(content: bytes, filename: str) -> str:
    """Extract text from image. Disabled to save memory."""
    return f"Image document: {filename}"


def _media_type_for_path(file_path: str) -> str:
    """Infer media type from file extension for FileResponse."""
    ext = (os.path.splitext(file_path)[1] or "").lower()
    m = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
        ".bmp": "image/bmp", ".tiff": "image/tiff", ".tif": "image/tiff",
    }
    return m.get(ext, "application/octet-stream")


@app.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    email: str = Form("guest"),
    chat: Optional[str] = Form(None),
    mode: str = Form("personal"),
):
    try:
        content_type = (file.content_type or "").strip().lower()
        if content_type not in _ALLOWED_CONTENT_TYPES:
            return {"error": "Only PDF files are supported"}

        content = await file.read()
        if content_type == "application/pdf":
            full_text = await asyncio.to_thread(
                _extract_text_from_pdf, content, file.filename or "document.pdf"
            )
        else:
            return {"error": "Photo/Image text extraction disabled."}

        is_company = (mode or "").strip().lower() == "company"
        if is_company and not _is_hr_email(email):
            raise HTTPException(status_code=403, detail="Only HR (hr@yourcompany) can upload company documents. You can ask questions in chat.")

        user = db_ops.get_user_by_email(email)
        if not user:
            display_id = db_ops.get_next_display_id("company" if is_company else "personal")
            company = None
            if is_company:
                domain = _extract_domain(email)
                if domain:
                    company = _get_or_create_company(domain)
            user = db_ops.create_user(email, display_id, "company" if company else "personal", company["id"] if company else None)
        elif is_company and user.get("company_id") is None:
            domain = _extract_domain(email)
            if domain:
                company = _get_or_create_company(domain)
                if company:
                    get_supabase().table("users").update({"user_type": "company", "company_id": company["id"]}).eq("id", user["id"]).execute()
                    user = db_ops.get_user_by_email(email)

        chat_id = None
        company_id = user.get("company_id") if is_company and user.get("company_id") else None
        if not is_company and chat:
            chat_row = db_ops.get_chat_by_user_and_name(user["id"], chat)
            if not chat_row:
                chat_row = db_ops.create_chat(user["id"], chat, user.get("display_id") or "")
            chat_id = chat_row["id"]

        document = db_ops.create_document(file.filename or "document", user["id"], user.get("display_id") or "", chat_id, company_id)

        safe_name = _sanitize_filename(file.filename)
        storage_path = f"{user['id']}/{document['id']}_{safe_name}"
        _upload_to_storage(storage_path, content, content_type or "application/octet-stream")
        db_ops.update_document_file_path(document["id"], storage_path)

        chunks = split_text(full_text) if full_text.strip() else [f"Document: {file.filename or 'upload'}"]
        # Run batch embed + DB writes in thread so the event loop stays responsive
        def _embed_and_save_chunks(doc_id, chunk_list):
            embeddings = create_embeddings_batch(chunk_list)
            for chunk, embedding in zip(chunk_list, embeddings):
                db_ops.insert_document_chunk(doc_id, chunk, json.dumps(embedding))

        await asyncio.to_thread(_embed_and_save_chunks, document["id"], chunks)

        return {"message": "Document uploaded and processed", "document_id": document["id"]}
    except HTTPException:
        raise
    except Exception as e:
        return {"error": str(e)}

@app.get("/chats/{email}")
def get_chats(email: str):
    user = db_ops.get_user_by_email(email)
    if not user:
        return {"chats": []}
    chats = db_ops.get_chats_by_user_id(user["id"])
    return {
        "chats": [
            {"id": c["id"], "name": c["name"], "display_id": c.get("display_id")}
            for c in chats
        ]
    }


@app.get("/messages/{email}/{chat_name}")
async def get_messages(
    email: str,
    chat_name: str,
    limit: Optional[int] = None,
    offset: int = 0
):
    """
    Retrieve chat history with optimized performance.
    
    Features:
    - Response caching (60s TTL)
    - Selective column retrieval
    - Pagination support
    - Performance metrics
    
    Args:
        email: User email address
        chat_name: Name of the chat
        limit: Optional max messages to return (default: 50, max: 1000)
        offset: Optional offset for pagination (default: 0)
    
    Returns:
        {
            "messages": [{"role": str, "content": str, "display_id": str}],
            "total_count": int,
            "has_more": bool,
            "query_time_ms": float
        }
    """
    start_time = time.time()
    
    try:
        # Parameter validation
        if limit is not None and limit < 0:
            raise HTTPException(status_code=400, detail="Limit must be non-negative")
        if offset < 0:
            raise HTTPException(status_code=400, detail="Offset must be non-negative")
        
        # Clamp limit to maximum of 1000
        if limit is not None and limit > 1000:
            limit = 1000
            print(f"[WARN] Limit clamped to 1000 for {email}/{chat_name}", flush=True)
        
        # Set default limit to 50 if not provided
        if limit is None:
            limit = 50
        
        # Look up user and chat
        user = db_ops.get_user_by_email(email)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        chat = db_ops.get_chat_by_user_and_name(user["id"], chat_name)
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found")
        
        chat_id = chat["id"]
        user_id = user["id"]
        
        # Check cache first
        cached_response = await _message_cache.get(user_id, chat_id)
        if cached_response is not None:
            cache_time = time.time() - start_time
            print(f"[CACHE HIT] Messages for chat {chat_id}: {cache_time*1000:.2f}ms", flush=True)
            return cached_response
        
        # Cache miss - query database
        query_start = time.time()
        messages, total_count = await asyncio.to_thread(
            db_ops.get_messages_for_chat_optimized,
            chat_id,
            limit,
            offset
        )
        query_time_ms = (time.time() - query_start) * 1000
        
        # Calculate has_more
        has_more = (offset + len(messages)) < total_count
        
        # Build response
        response = {
            "messages": messages,
            "total_count": total_count,
            "has_more": has_more,
            "query_time_ms": round(query_time_ms, 2)
        }
        
        # Store in cache (only cache first page for simplicity)
        if offset == 0:
            await _message_cache.set(user_id, chat_id, response)
        
        # Performance logging
        total_time_ms = (time.time() - start_time) * 1000
        print(f"[MESSAGES] Retrieved {len(messages)} messages for chat {chat_id}: {total_time_ms:.2f}ms (query: {query_time_ms:.2f}ms)", flush=True)
        
        if total_time_ms > 500:
            print(f"[WARN] Slow message retrieval: chat_id={chat_id}, message_count={len(messages)}, time={total_time_ms:.2f}ms", flush=True)
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        error_time_ms = (time.time() - start_time) * 1000
        print(f"[ERROR] Message retrieval failed after {error_time_ms:.2f}ms: {str(e)}", flush=True)
        
        # Check for database connection errors
        if "connection" in str(e).lower() or "timeout" in str(e).lower():
            raise HTTPException(status_code=503, detail="Database temporarily unavailable")
        
        raise HTTPException(status_code=500, detail=f"Failed to retrieve messages: {str(e)}")


@app.post("/chats")
def create_chat(body: CreateChatRequest):
    user = db_ops.get_user_by_email(body.email)
    if not user:
        display_id = db_ops.get_next_display_id(body.mode)
        company = None
        if (body.mode or "").strip().lower() == "company":
            domain = _extract_domain(body.email)
            if domain:
                company = _get_or_create_company(domain)
        user = db_ops.create_user(body.email, display_id, "company" if company else "personal", company["id"] if company else None)
    existing = db_ops.get_chat_by_user_and_name(user["id"], body.name)
    if existing:
        return {"ok": True, "name": body.name, "chat_id": existing["id"]}
    row = db_ops.create_chat(user["id"], body.name, user.get("display_id") or "")
    return {"ok": True, "name": body.name, "chat_id": row["id"]}


@app.patch("/chats/rename")
def rename_chat(body: RenameChatRequest):
    user = db_ops.get_user_by_email(body.email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    chat = db_ops.get_chat_by_user_and_name(user["id"], body.old_name)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    new_name = (body.new_name or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="New name cannot be empty")
    if new_name == body.old_name:
        return {"ok": True, "name": new_name}
    existing = db_ops.get_chat_by_user_and_name(user["id"], new_name)
    if existing:
        raise HTTPException(status_code=400, detail="A chat with this name already exists")
    db_ops.update_chat_name(user["id"], body.old_name, new_name)
    return {"ok": True, "name": new_name}


@app.post("/chats/claim")
async def claim_guest_chat(body: ClaimChatRequest):
    """Assign the guest chat (and all its messages) to the logged-in user so pre-login messages get the user's display_id."""
    claim_start = time.time()
    
    guest_chat_name = (body.guest_chat_name or "").strip()
    email = (body.email or "").strip()
    if not guest_chat_name or not email:
        raise HTTPException(status_code=400, detail="guest_chat_name and email required")
    
    guest_user = db_ops.get_user_by_email("guest")
    if not guest_user:
        return {"ok": True, "name": guest_chat_name}
    
    real_user = db_ops.get_user_by_email(email)
    if not real_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    chat = db_ops.get_chat_by_user_and_name(guest_user["id"], guest_chat_name)
    if not chat:
        return {"ok": True, "name": guest_chat_name}
    
    chat_id = chat["id"]
    
    try:
        # Get or create display_id
        display_id = (real_user.get("display_id") or "").strip()
        if not display_id:
            display_id = db_ops.get_next_display_id("personal")
            get_supabase().table("users").update({"display_id": display_id}).eq("id", real_user["id"]).execute()
        
        # Update chat ownership and messages in batch (transaction-like behavior)
        db_ops.update_chat_ownership(chat_id, real_user["id"], display_id)
        db_ops.update_messages_display_id_batch(chat_id, display_id)
        
        # Invalidate cache for this chat
        await _message_cache.invalidate(real_user["id"], chat_id)
        
        # Rename guest-uuid to short name "Chat 1" (or "Chat 2", ...) so sidebar shows a short name
        new_name = db_ops.get_next_short_chat_name(real_user["id"])
        db_ops.update_chat_name(real_user["id"], guest_chat_name, new_name)
        
        # Log claim duration
        claim_duration_ms = (time.time() - claim_start) * 1000
        print(f"[CLAIM] Chat {chat_id} claimed by {email}: {claim_duration_ms:.2f}ms", flush=True)
        
        if claim_duration_ms > 300:
            print(f"[WARN] Slow chat claim: chat_id={chat_id}, duration={claim_duration_ms:.2f}ms", flush=True)
        
        return {"ok": True, "name": new_name, "previous_name": guest_chat_name}
        
    except Exception as e:
        error_duration_ms = (time.time() - claim_start) * 1000
        print(f"[ERROR] Chat claim failed after {error_duration_ms:.2f}ms: {str(e)}", flush=True)
        raise HTTPException(status_code=500, detail="Failed to claim chat. Please try again.")



@app.get("/user-info")
def get_user_info(email: str = ""):
    if not email:
        return {"email": "", "user_id": None, "is_admin": False}
    user = db_ops.get_user_by_email(email)
    is_admin = _is_admin(email)
    if not user:
        return {"email": email, "user_id": None, "is_admin": is_admin}
    return {"email": user["email"], "user_id": user.get("display_id"), "is_admin": is_admin}


@app.get("/admin/database")
def get_admin_database(email: str = ""):
    if not _is_admin(email):
        raise HTTPException(status_code=403, detail="Admin only")
    try:
        api_keys = db_ops.get_all_user_api_keys()
    except Exception:
        api_keys = []
    return {
        "users": db_ops.get_all_users(),
        "chats": db_ops.get_all_chats(),
        "messages": db_ops.get_all_messages(),
        "documents": db_ops.get_all_documents(),
        "document_chunks": db_ops.get_all_document_chunks(),
        "user_api_keys": api_keys,
    }


@app.get("/admin/admins")
def get_admin_list(email: str = ""):
    if not _is_super_admin(email):
        raise HTTPException(status_code=403, detail="Only super admin can view admin list")
    return {"admins": db_ops.get_all_admins()}


@app.post("/admin/admins")
def add_admin(body: AddAdminRequest):
    if not _is_super_admin(body.email):
        raise HTTPException(status_code=403, detail="Only the super admin can add admins")
    email_to_add = (body.new_admin_email or "").strip().lower()
    if not email_to_add or "@" not in email_to_add:
        raise HTTPException(status_code=400, detail="Valid email required")
    if db_ops.get_admin_by_email(email_to_add):
        return {"message": "Already an admin", "admins": db_ops.get_all_admins()}
    db_ops.add_admin_by_email(email_to_add)
    return {"message": "Admin added", "admins": db_ops.get_all_admins()}


@app.post("/admin/admins/remove")
def remove_admin(body: RemoveAdminRequest):
    if not _is_super_admin(body.email):
        raise HTTPException(status_code=403, detail="Only the super admin can remove admins")
    email_to_remove = (body.remove_admin_email or "").strip().lower()
    if not email_to_remove:
        raise HTTPException(status_code=400, detail="Email required")
    if not db_ops.get_admin_by_email(email_to_remove):
        return {"message": "Not an admin", "admins": db_ops.get_all_admins()}
    db_ops.remove_admin_by_email(email_to_remove)
    return {"message": "Admin removed", "admins": db_ops.get_all_admins()}


def _serve_document_file(doc: dict):
    """Return FileResponse for local path or Response with bytes for Supabase Storage."""
    file_path = doc.get("file_path")
    if not file_path:
        raise HTTPException(status_code=404, detail="Document not found")
    if _is_local_file_path(file_path):
        return FileResponse(
            file_path,
            media_type=_media_type_for_path(file_path),
            filename=doc.get("name"),
        )
    try:
        content = _download_from_storage(file_path)
    except Exception as e:
        raise HTTPException(status_code=404, detail="Document not found") from e
    media_type = _media_type_for_path(doc.get("name") or file_path)
    filename = (doc.get("name") or file_path.split("/")[-1] or "document").replace('"', "'")
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@app.get("/documents/file/{document_id}")
def get_document_file(document_id: int, email: str):
    if _is_admin(email):
        doc = db_ops.get_document_by_id(document_id)
        if not doc or not doc.get("file_path"):
            raise HTTPException(status_code=404, detail="Document not found")
        return _serve_document_file(doc)

    user = db_ops.get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    doc = db_ops.get_document_by_id(document_id)
    if not doc or not doc.get("file_path"):
        raise HTTPException(status_code=404, detail="Document not found")
    is_owner = doc["user_id"] == user["id"]
    same_company = doc.get("company_id") is not None and user.get("company_id") is not None and user["company_id"] == doc["company_id"]
    if not is_owner and not same_company:
        raise HTTPException(status_code=403, detail="Document not found")
    return _serve_document_file(doc)


@app.delete("/documents/{document_id}")
def delete_document(document_id: int, email: str):
    user = db_ops.get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    doc = db_ops.get_document_by_id(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    is_owner = doc["user_id"] == user["id"]
    is_hr_company_doc = doc.get("company_id") is not None and user.get("company_id") == doc["company_id"] and _is_hr_email(email)
    if not is_owner and not is_hr_company_doc:
        raise HTTPException(status_code=403, detail="Not allowed to delete this document")
    db_ops.delete_document_chunks_by_document_id(document_id)
    fp = doc.get("file_path")
    if fp:
        if _is_local_file_path(fp):
            try:
                os.remove(fp)
            except OSError:
                pass
        else:
            _delete_from_storage(fp)
    db_ops.delete_document_by_id(document_id)
    return {"ok": True}


@app.get("/company/settings")
def get_company_settings(email: str = ""):
    if not email:
        return {"show_doc_count_to_employees": False}
    user = db_ops.get_user_by_email(email)
    if not user or not user.get("company_id"):
        return {"show_doc_count_to_employees": False}
    company = db_ops.get_company_by_id(user["company_id"])
    if not company:
        return {"show_doc_count_to_employees": False}
    return {"show_doc_count_to_employees": bool(company.get("show_doc_count_to_employees", 0))}


@app.patch("/company/settings")
def update_company_settings(body: CompanySettingsUpdate):
    if not _is_hr_email(body.email):
        raise HTTPException(status_code=403, detail="Only HR can update this setting")
    user = db_ops.get_user_by_email(body.email)
    if not user or not user.get("company_id"):
        raise HTTPException(status_code=404, detail="Company not found")
    company = db_ops.get_company_by_id(user["company_id"])
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    db_ops.update_company_show_doc_count(user["company_id"], body.show_doc_count_to_employees)
    return {"show_doc_count_to_employees": body.show_doc_count_to_employees}


@app.get("/documents/company/count")
def get_company_documents_count(email: str = ""):
    if not email:
        return {"count": 0, "visible": False}
    user = db_ops.get_user_by_email(email)
    if not user:
        domain = _extract_domain(email)
        if not domain:
            return {"count": 0, "visible": False}
        company = _get_or_create_company(domain)
        if not company:
            return {"count": 0, "visible": False}
        user = db_ops.create_user(email, db_ops.get_next_display_id("company"), "company", company["id"])
    elif user.get("company_id") is None:
        domain = _extract_domain(email)
        if domain:
            company = _get_or_create_company(domain)
            if company:
                get_supabase().table("users").update({"user_type": "company", "company_id": company["id"]}).eq("id", user["id"]).execute()
                user = db_ops.get_user_by_email(email)
    if not user.get("company_id"):
        return {"count": 0, "visible": False}
    company = db_ops.get_company_by_id(user["company_id"])
    if not company or not company.get("show_doc_count_to_employees"):
        return {"count": 0, "visible": False}
    n = db_ops.count_documents_by_company(user["company_id"])
    return {"count": n, "visible": True}


@app.get("/documents/company/{email}")
def get_company_documents(email: str):
    if not _is_hr_email(email):
        return {"documents": []}
    user = db_ops.get_user_by_email(email)
    if not user or not user.get("company_id"):
        return {"documents": []}
    docs = db_ops.get_documents_by_company(user["company_id"])
    return {
        "documents": [
            {"id": d["id"], "name": d["name"], "has_preview": bool(d.get("file_path"))}
            for d in docs
        ]
    }


@app.get("/documents/{email}")
def get_documents(email: str):
    user = db_ops.get_user_by_email(email)
    if not user:
        return {"documents": []}
    docs = db_ops.get_documents_global(user["id"])
    return {
        "documents": [
            {"id": d["id"], "name": d["name"], "user_id": d.get("display_id"), "has_preview": bool(d.get("file_path"))}
            for d in docs
        ]
    }


@app.get("/documents/{email}/{chat_name}")
def get_chat_documents(email: str, chat_name: str):
    user = db_ops.get_user_by_email(email)
    if not user:
        return {"documents": []}
    chat = db_ops.get_chat_by_user_and_name(user["id"], chat_name)
    if not chat:
        return {"documents": []}
    docs = db_ops.get_documents_by_chat(user["id"], chat["id"])
    return {
        "documents": [
            {"id": d["id"], "name": d["name"], "user_id": d.get("display_id"), "has_preview": bool(d.get("file_path"))}
            for d in docs
        ]
    }

@app.get("/messages/{email}/{chat_name}")
def get_messages(email: str, chat_name: str):
    user = db_ops.get_user_by_email(email)
    if not user:
        return {"messages": []}
    chat = db_ops.get_chat_by_user_and_name(user["id"], chat_name)
    if not chat:
        return {"messages": []}
    messages = db_ops.get_messages_for_chat(chat["id"])
    return {"messages": [{"role": m.get("role"), "content": m.get("content"), "user_id": m.get("display_id")} for m in messages]}



config = Config('.env')

oauth = OAuth(config)

oauth.register(
    name="google",
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={
        "scope": "openid email profile"
    }
)


def _google_oauth_redirect_uri(request: Request) -> str:
    """
    Callback URL sent to Google must match an Authorized redirect URI exactly.
    Set PUBLIC_BASE_URL=https://your.domain on Render so it matches your custom domain
    (and matches Google Cloud Console) even if proxy headers differ.
    """
    base = (os.getenv("PUBLIC_BASE_URL") or os.getenv("OAUTH_PUBLIC_BASE_URL") or "").strip().rstrip("/")
    if base:
        return f"{base}/auth/google"
    return str(request.url_for("auth_google"))


@app.get("/login/google")
async def login_google(request: Request):
    redirect_uri = _google_oauth_redirect_uri(request)
    return await oauth.google.authorize_redirect(request, redirect_uri)

@app.get("/auth/google")
async def auth_google(request: Request):
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:8000").rstrip("/")
    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError as e:
        # invalid_grant often means redirect_uri mismatch or expired code
        error_msg = urllib.parse.quote(
            "Google sign-in failed. In Google Cloud Console, add this exact Authorized redirect URI under your OAuth 2.0 Client: "
            + _google_oauth_redirect_uri(request)
        )
        return RedirectResponse(frontend_url + "/?error=oauth&message=" + error_msg)
    user = token["userinfo"]
    email = user["email"]
    if not db_ops.get_user_by_email(email):
        display_id = db_ops.get_next_display_id("personal")
        db_ops.create_user(email, display_id, "personal", None)
    return RedirectResponse(frontend_url + "/?email=" + urllib.parse.quote(email))


# Serve frontend static files at / (index.html, script.js, style.css). API routes above take precedence.
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)

