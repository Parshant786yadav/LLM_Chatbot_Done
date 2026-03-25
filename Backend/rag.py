# rag.py — lightweight embeddings via HTTP (no torch, no sentence-transformers)
# Uses Hugging Face Inference API (free tier) OR falls back to a simple TF-IDF-style
# bag-of-words embedding so the app always works even without an HF token.

import os
import json
import math
import hashlib
import urllib.request
import urllib.error
import numpy as np

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
HF_API_TOKEN = os.getenv("HF_API_TOKEN", "")          # optional but recommended
HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2"    # 384-dim, fast, free
HF_API_URL = f"https://api-inference.huggingface.co/pipeline/feature-extraction/{HF_MODEL}"
EMBEDDING_DIM = 384   # must match model above


# ---------------------------------------------------------------------------
# Text splitting
# ---------------------------------------------------------------------------
def split_text(text: str, chunk_size: int = 150) -> list[str]:
    words = text.split()
    return [" ".join(words[i:i + chunk_size]) for i in range(0, len(words), chunk_size)]


# ---------------------------------------------------------------------------
# Fallback: deterministic bag-of-words embedding (no external calls)
# Always produces EMBEDDING_DIM-dimensional unit vectors.
# ---------------------------------------------------------------------------
def _bow_embedding(text: str) -> list[float]:
    vec = [0.0] * EMBEDDING_DIM
    for word in text.lower().split():
        idx = int(hashlib.md5(word.encode()).hexdigest(), 16) % EMBEDDING_DIM
        vec[idx] += 1.0
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


# ---------------------------------------------------------------------------
# HuggingFace Inference API call
# ---------------------------------------------------------------------------
def _hf_embed(texts: list[str]) -> list[list[float]] | None:
    """Call HF Inference API. Returns list of embeddings or None on failure."""
    try:
        payload = json.dumps({"inputs": texts, "options": {"wait_for_model": True}}).encode()
        headers = {"Content-Type": "application/json"}
        if HF_API_TOKEN:
            headers["Authorization"] = f"Bearer {HF_API_TOKEN}"
        req = urllib.request.Request(HF_API_URL, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
        if isinstance(result, dict) and "error" in result:
            print(f"[RAG] HF API returned dict error: {result['error']}", flush=True)
            return None
        # result is either [[float, ...], ...] or [[[float,...]], ...]
        # Flatten one extra nesting level if present (pipeline/feature-extraction wraps each token)
        embeddings = []
        for item in result:
            if isinstance(item[0], list):
                # Mean pool token embeddings
                arr = [sum(row[i] for row in item) / len(item) for i in range(len(item[0]))]
                embeddings.append(arr)
            else:
                embeddings.append(item)
        return embeddings
    except Exception as e:
        err_msg = ""
        if hasattr(e, "read"):
            try:
                err_msg = e.read().decode()
            except:
                pass
        print(f"[RAG] HF API Error: {e} | {err_msg}", flush=True)
        return None


# ---------------------------------------------------------------------------
# Public API (same interface as before)
# ---------------------------------------------------------------------------
def create_embedding(text: str) -> list[float]:
    """Single text → embedding list."""
    result = _hf_embed([text])
    if result and len(result) > 0:
        return result[0]
    return _bow_embedding(text)


def create_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Batch texts → list of embedding lists."""
    if not texts:
        return []
    # HF free tier has a limit; batch in chunks of 32
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), 16):
        batch = texts[i:i + 16]
        result = _hf_embed(batch)
        if result and len(result) == len(batch):
            all_embeddings.extend(result)
        else:
            # Fallback per-itemm
            all_embeddings.extend(_bow_embedding(t) for t in batch)
    return all_embeddings


def cosine_similarity(a: list[float], b: list[float]) -> float:
    an = np.array(a, dtype=float)
    bn = np.array(b, dtype=float)
    denom = np.linalg.norm(an) * np.linalg.norm(bn)
    return float(np.dot(an, bn) / denom) if denom else 0.0