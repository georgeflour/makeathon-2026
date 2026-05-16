"""
build_vegalite_rag.py
=====================
One-time script. Run once to populate the Supabase `vegalite_docs` table
with Vega-Lite documentation chunks and their embeddings.

Prerequisites (run in Supabase SQL editor first):
    create extension if not exists vector;

    create table vegalite_docs (
        id          bigserial primary key,
        source      text not null,
        chunk_index int  not null,
        content     text not null,
        embedding   vector(1536)
    );

    create index vegalite_docs_embedding_idx
        on vegalite_docs
        using ivfflat (embedding vector_cosine_ops)
        with (lists = 50);

Run from backend/:
    python -m app.build_vegalite_rag

Add to requirements.txt:
    tiktoken
    supabase
    openai   (already there via langchain-openai)
"""

from __future__ import annotations

import os
import re
import time

import requests
import tiktoken
from openai import AzureOpenAI
from supabase import create_client, Client

from app.config import settings

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
GITHUB_API_ROOT = "https://api.github.com/repos/vega/vega-lite/contents/site/docs"
RAW_BASE        = "https://raw.githubusercontent.com/vega/vega-lite/main/site/docs"
TABLE_NAME      = "vegalite_docs"
EMBEDDING_MODEL = "text-embedding-3-small"   # your Azure deployment name
CHUNK_TOKENS    = 500
CHUNK_OVERLAP   = 80
BATCH_SIZE      = 20   # rows per Supabase insert (stay well under payload limit)

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
def _supabase() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


def _openai() -> AzureOpenAI:
    return AzureOpenAI(
        azure_endpoint = settings.AZURE_OPENAI_ENDPOINT,
        api_key        = settings.AZURE_OPENAI_API_KEY,
        api_version    = "2024-02-15-preview",
    )


# ---------------------------------------------------------------------------
# Tokenizer
# ---------------------------------------------------------------------------
_enc = tiktoken.get_encoding("cl100k_base")


def _chunk(text: str, source: str) -> list[dict]:
    tokens = _enc.encode(text)
    chunks, start, idx = [], 0, 0
    while start < len(tokens):
        end = min(start + CHUNK_TOKENS, len(tokens))
        chunks.append({
            "source":      source,
            "chunk_index": idx,
            "content":     _enc.decode(tokens[start:end]),
        })
        idx   += 1
        start += CHUNK_TOKENS - CHUNK_OVERLAP
    return chunks


# ---------------------------------------------------------------------------
# GitHub helpers
# ---------------------------------------------------------------------------
def _gh_headers() -> dict:
    token = os.getenv("GITHUB_TOKEN", "")
    return {"Authorization": f"token {token}"} if token else {}


def _collect_md_paths() -> list[str]:
    """Recursively collect all .md paths relative to site/docs."""
    md_paths, stack = [], [""]
    while stack:
        suffix = stack.pop()
        url    = f"https://api.github.com/repos/vega/vega-lite/contents/site/docs{suffix}"
        resp   = requests.get(url, headers=_gh_headers(), timeout=30)
        resp.raise_for_status()
        for item in resp.json():
            rel = item["path"].replace("site/docs", "")
            if item["type"] == "dir":
                stack.append(rel)
            elif item["name"].endswith(".md"):
                md_paths.append(rel)
    return md_paths


def _fetch_raw(rel_path: str) -> str:
    resp = requests.get(RAW_BASE + rel_path, timeout=30)
    resp.raise_for_status()
    return resp.text


def _clean(text: str) -> str:
    text = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.DOTALL)  # YAML front matter
    text = re.sub(r"\{%.*?%\}", "", text, flags=re.DOTALL)          # liquid tags
    text = re.sub(r"\{\{.*?\}\}", "", text, flags=re.DOTALL)        # liquid output
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------
def _embed_batch(client: AzureOpenAI, texts: list[str]) -> list[list[float]]:
    resp = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [r.embedding for r in resp.data]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def build():
    print("=== Vega-Lite RAG builder → Supabase pgvector ===\n")

    sb  = _supabase()
    oai = _openai()

    # Wipe existing rows so rebuilding is idempotent
    print(f"Clearing existing rows in '{TABLE_NAME}'...")
    sb.table(TABLE_NAME).delete().neq("id", 0).execute()

    # 1. Collect markdown files
    print("Scanning vega/vega-lite site/docs...")
    md_paths = _collect_md_paths()
    print(f"  Found {len(md_paths)} .md files.\n")

    # 2. Download, clean, chunk
    print("Downloading and chunking...")
    all_chunks: list[dict] = []
    for i, rel in enumerate(md_paths):
        try:
            text   = _clean(_fetch_raw(rel))
            if len(text) < 50:
                continue
            chunks = _chunk(text, source=rel)
            all_chunks.extend(chunks)
            print(f"  [{i+1}/{len(md_paths)}] {rel} → {len(chunks)} chunks")
            time.sleep(0.1)
        except Exception as e:
            print(f"  Warning: skipped {rel}: {e}")

    print(f"\n  Total chunks: {len(all_chunks)}\n")

    # 3. Embed + insert in batches
    print("Embedding and inserting into Supabase...")
    for start in range(0, len(all_chunks), BATCH_SIZE):
        batch  = all_chunks[start : start + BATCH_SIZE]
        texts  = [c["content"] for c in batch]

        try:
            embeddings = _embed_batch(oai, texts)
        except Exception as e:
            print(f"  Embedding error at batch {start}: {e} — skipping batch")
            continue

        rows = [
            {
                "source":      c["source"],
                "chunk_index": c["chunk_index"],
                "content":     c["content"],
                "embedding":   emb,          # list[float] — Supabase accepts this
            }
            for c, emb in zip(batch, embeddings)
        ]

        try:
            sb.table(TABLE_NAME).insert(rows).execute()
        except Exception as e:
            print(f"  Insert error at batch {start}: {e} — skipping batch")
            continue

        done = min(start + BATCH_SIZE, len(all_chunks))
        print(f"  Inserted {done}/{len(all_chunks)} chunks...")
        time.sleep(0.2)   # avoid hammering the embedding API

    # 4. Build the IVFFlat index (needs data to exist first)
    print("\nBuilding IVFFlat index...")
    try:
        sb.rpc("create_vegalite_index", {}).execute()
    except Exception:
        pass   # index may already exist — that's fine

    print(f"\n✅ Done! '{TABLE_NAME}' is ready in Supabase.\n")


if __name__ == "__main__":
    build()
