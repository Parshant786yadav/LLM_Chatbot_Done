# rag.py

from sentence_transformers import SentenceTransformer
import numpy as np
import json

# Lazy-load model so app starts fast and first embedding request loads it once
_model = None

def _get_model():
    global _model
    if _model is None:
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model

def split_text(text, chunk_size=400):
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size):
        chunks.append(" ".join(words[i:i+chunk_size]))
    return chunks

def create_embedding(text):
    """Single text -> embedding list (for chat query)."""
    model = _get_model()
    embedding = model.encode(text)
    return embedding.tolist()

def create_embeddings_batch(texts):
    """Encode many texts in one call (much faster than many create_embedding calls). Returns list of embedding lists."""
    if not texts:
        return []
    model = _get_model()
    embeddings = model.encode(texts, show_progress_bar=False)
    return [embeddings[i].tolist() for i in range(len(texts))]

def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))