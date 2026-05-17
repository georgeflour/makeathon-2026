"""
build_recharts_rag.py
=====================
One-time script. Clones recharts/recharts locally, ingests ONLY:
  - README.md                          (top-level overview)
  - storybook/stories/Examples/**      (real chart usage examples)
  - storybook/stories/API/**           (API reference / prop docs)

No source code, no tests, no generated files.

Run from backend/:
    python -m app.build_recharts_rag
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import tiktoken
from openai import AzureOpenAI
from supabase import create_client, Client

from app.config import settings

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
REPO_URL        = "https://github.com/recharts/recharts.git"
TABLE_NAME      = "recharts_docs"
EMBEDDING_MODEL = settings.AZURE_EMBEDDING_DEPLOYMENT_NAME or "text-embedding-3-small"
CHUNK_TOKENS    = 500
CHUNK_OVERLAP   = 80
BATCH_SIZE      = 20

# Exactly which paths to ingest (relative to repo root).
# Files matched here and no source code anywhere else.
INGEST_TARGETS: list[str] = [
    "README.md",                        # top-level overview
    "storybook/stories/Examples",       # real usage examples (.stories.tsx)
    "storybook/stories/API",            # API reference (.mdx + .stories.tsx)
]

# Only these extensions
ALLOWED_EXTENSIONS = {".md", ".mdx", ".ts", ".tsx", ".js", ".jsx"}

# Skip images, CSS, snapshots, test utilities
SKIP_RE = re.compile(
    r"(\.png$|\.jpg$|\.css$|\.snap$|assets/)",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
def _supabase() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


def _openai() -> AzureOpenAI:
    return AzureOpenAI(
        azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
        api_key=settings.AZURE_OPENAI_API_KEY,
        api_version="2024-02-15-preview",
    )


# ---------------------------------------------------------------------------
# Tokenizer + chunker
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
# Text cleaning
# ---------------------------------------------------------------------------
def _clean_md(text: str) -> str:
    """Strip YAML/MDX front-matter and collapse blank lines."""
    text = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.DOTALL)
    text = re.sub(r"^import\s+.*?;\n", "", text, flags=re.MULTILINE)  # MDX imports
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _clean_tsx(text: str) -> str:
    """Keep the full example but strip pure import lines to reduce noise."""
    text = re.sub(r"^import\s+.*?;\n", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _clean(file_path: str, raw: str) -> str:
    ext = Path(file_path).suffix.lower()
    if ext in {".md", ".mdx"}:
        return _clean_md(raw)
    return _clean_tsx(raw)


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------
def _embed_batch(client: AzureOpenAI, texts: list[str]) -> list[list[float]]:
    resp = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [r.embedding for r in resp.data]


# ---------------------------------------------------------------------------
# File collection
# ---------------------------------------------------------------------------
def _collect(repo: Path) -> list[Path]:
    files: list[Path] = []
    seen: set[str] = set()

    for target in INGEST_TARGETS:
        p = repo / target
        if not p.exists():
            print(f"  Skipping {target!r} — not found in repo")
            continue

        if p.is_file():
            candidates = [p]
        else:
            candidates = [f for f in p.rglob("*") if f.is_file()]

        for f in candidates:
            rel = str(f.relative_to(repo))
            if rel in seen:
                continue
            if f.suffix.lower() not in ALLOWED_EXTENSIONS:
                continue
            if SKIP_RE.search(rel):
                continue
            seen.add(rel)
            files.append(f)

    return files


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def build() -> None:
    print("=== Recharts RAG builder → Supabase pgvector ===")
    print("  Sources: README.md + storybook/stories/Examples + storybook/stories/API\n")

    sb  = _supabase()
    oai = _openai()

    # 1. Clone (shallow — we only need latest snapshot)
    tmp_dir = tempfile.mkdtemp(prefix="recharts_clone_")
    print(f"Cloning {REPO_URL} → {tmp_dir} ...")
    subprocess.run(
        ["git", "clone", "--depth=1", REPO_URL, tmp_dir],
        check=True,
        capture_output=True,
    )
    print("  Clone complete.\n")

    repo = Path(tmp_dir)

    # 2. Collect only the targeted files
    all_files = _collect(repo)
    print(f"  Files to ingest: {len(all_files)}\n")

    # 3. Wipe existing rows (idempotent rebuild)
    print(f"Clearing existing rows in '{TABLE_NAME}'...")
    sb.table(TABLE_NAME).delete().neq("id", 0).execute()

    # 4. Read, clean, chunk
    print("Chunking...")
    all_chunks: list[dict] = []
    for i, f in enumerate(all_files):
        rel = str(f.relative_to(repo))
        try:
            raw    = f.read_text(encoding="utf-8", errors="ignore")
            text   = _clean(rel, raw)
            if len(text) < 50:
                continue
            chunks = _chunk(text, source=rel)
            all_chunks.extend(chunks)
            print(f"  [{i+1}/{len(all_files)}] {rel} → {len(chunks)} chunks")
        except Exception as e:
            print(f"  Warning: skipped {rel}: {e}")

    print(f"\n  Total chunks: {len(all_chunks)}\n")

    # 5. Embed + insert in batches
    print("Embedding and inserting into Supabase...")
    for start in range(0, len(all_chunks), BATCH_SIZE):
        batch = all_chunks[start: start + BATCH_SIZE]
        texts = [c["content"] for c in batch]

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
                "embedding":   emb,
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
        time.sleep(0.15)

    # 6. Clean up clone
    shutil.rmtree(tmp_dir, ignore_errors=True)
    print(f"\n✅ Done! '{TABLE_NAME}' is ready in Supabase.\n")


if __name__ == "__main__":
    build()