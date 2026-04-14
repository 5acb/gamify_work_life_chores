#!/usr/bin/env python3
"""
kb.py — Knowledge Base CLI (run via: uv run python3 kb.py <command>)
Hybrid vector (Qdrant 3072-dim) + full-text (PostgreSQL FTS) + graph.

Commands:
  search "query" [--n 8] [--type TYPE]
  add "content" --source SOURCE [--type TYPE] [--tags "t1,t2"]
  add --file PATH --source SOURCE [--type TYPE]
  context "task description" [--n 10]
  ingest PATH [--source NAME] [--type TYPE]
  graph-link FROM RELATION TO [--source SOURCE]
  graph-query ENTITY
  stats
"""
import argparse, hashlib, json, os, re, sys, textwrap, uuid
from datetime import datetime, timezone

from google import genai as _genai
import psycopg2, psycopg2.extras
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, Filter, FieldCondition, MatchValue, VectorParams, Distance, QueryRequest

# ── Config ────────────────────────────────────────────────────
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
PG_DSN         = os.environ.get("KB_PG_DSN",
    "postgresql://mem0:5e89be247371fda3304ac07c342102ecec9c3b6c8ba1702b@localhost:5432/mem0")
QDRANT_URL     = os.environ.get("KB_QDRANT_URL", "http://localhost:6333")
COLLECTION     = "knowledge_base"
MEM0_URL       = os.environ.get("MEM0_URL", "http://localhost:8000")
MEM0_KEY       = os.environ.get("MEM0_API_KEY",
    "62f0355c1351d58cd5e514f084719a509365e9e92464e24a26462eb74847b5d5")
CHUNK_SIZE     = 800
EMBED_DIM      = 3072

_gclient = None
def gclient():
    global _gclient
    if _gclient is None:
        _gclient = _genai.Client(api_key=GEMINI_API_KEY)
    return _gclient

def get_qdrant():
    return QdrantClient(url=QDRANT_URL, timeout=15)

def get_pg():
    return psycopg2.connect(PG_DSN)

# ── Embedding ─────────────────────────────────────────────────
def embed(text: str) -> list[float]:
    r = gclient().models.embed_content(
        model="gemini-embedding-001",
        contents=text[:8000],
    )
    return list(r.embeddings[0].values)

# ── Chunking ──────────────────────────────────────────────────
def chunk_text(text: str) -> list[str]:
    parts = re.split(r'\n(?=#{1,3} )|\n\n', text.strip())
    chunks, buf = [], ""
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if len(buf) + len(part) < CHUNK_SIZE:
            buf = (buf + "\n\n" + part).strip()
        else:
            if buf:
                chunks.append(buf)
            if len(part) > CHUNK_SIZE:
                sents = re.split(r'(?<=[.!?])\s+', part)
                sbuf = ""
                for s in sents:
                    if len(sbuf) + len(s) < CHUNK_SIZE:
                        sbuf = (sbuf + " " + s).strip()
                    else:
                        if sbuf:
                            chunks.append(sbuf)
                        sbuf = s
                if sbuf:
                    chunks.append(sbuf)
            else:
                buf = part
    if buf:
        chunks.append(buf)
    return [c for c in chunks if len(c.strip()) > 40]

# ── Core: add ─────────────────────────────────────────────────
def add_to_kb(content: str, source: str, doc_type: str = "note",
              tags: list[str] = None) -> dict:
    tags = tags or []
    chunks = chunk_text(content) if len(content) > CHUNK_SIZE else [content]
    qdrant = get_qdrant()
    pg = get_pg(); cur = pg.cursor()
    added = 0
    for i, text in enumerate(chunks):
        raw = hashlib.sha256(f"{source}:{i}:{text[:80]}".encode()).digest()
        doc_id = str(uuid.UUID(bytes=raw[:16]))
        vec = embed(text)
        qdrant.upsert(collection_name=COLLECTION, points=[PointStruct(
            id=doc_id, vector=vec, payload={
                "source": source, "doc_type": doc_type,
                "chunk_seq": i, "tags": tags,
                "text": text[:1200],
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )])
        cur.execute("""
            INSERT INTO kb_docs (id, source, doc_type, chunk_seq, content, tags)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE
              SET content=EXCLUDED.content, tags=EXCLUDED.tags
        """, (doc_id, source, doc_type, i, text, tags))
        added += 1
    pg.commit(); pg.close()
    return {"added": added, "source": source, "doc_type": doc_type}

# ── Core: search ──────────────────────────────────────────────
def search_kb(query: str, n: int = 8, doc_type: str = None) -> list[dict]:
    vec = embed(query)
    qdrant = get_qdrant()
    qfilter = None
    if doc_type:
        qfilter = Filter(must=[FieldCondition(key="doc_type", match=MatchValue(value=doc_type))])
    qr = qdrant.query_points(
        collection_name=COLLECTION, query=vec,
        limit=n, query_filter=qfilter, with_payload=True,
    )
    seen, results = set(), []
    for r in qr.points:
        seen.add(str(r.id))
        results.append({
            "id": str(r.id), "score": round(r.score, 3),
            "source": r.payload.get("source", ""),
            "doc_type": r.payload.get("doc_type", ""),
            "text": r.payload.get("text", ""),
            "method": "vector",
        })
    # Supplement with PostgreSQL FTS
    try:
        pg = get_pg()
        cur = pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        params = [query, query]
        type_clause = ""
        if doc_type:
            type_clause = "AND doc_type = %s"
            params.append(doc_type)
        params.append(n)
        cur.execute(f"""
            SELECT id, source, doc_type, content AS text,
                   ts_rank(tsv, plainto_tsquery('english', %s)) AS score
            FROM kb_docs
            WHERE tsv @@ plainto_tsquery('english', %s)
            {type_clause}
            ORDER BY score DESC LIMIT %s
        """, params)
        for row in cur.fetchall():
            if row["id"] not in seen:
                results.append({
                    "id": row["id"], "score": float(row["score"]),
                    "source": row["source"], "doc_type": row["doc_type"],
                    "text": row["text"][:800], "method": "fts",
                })
        pg.close()
    except Exception:
        pass
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:int(n * 1.5)]

# ── Core: context load ────────────────────────────────────────
def load_context(task: str, n: int = 10) -> str:
    import urllib.request
    kb_hits = search_kb(task, n=n)
    mem0_hits = []
    try:
        req_data = json.dumps({"query": task, "limit": 5, "user_id": "anas"}).encode()
        req = urllib.request.Request(
            f"{MEM0_URL}/search", data=req_data,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {MEM0_KEY}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            items = data.get("memories") or (data if isinstance(data, list) else [])
            for m in items:
                if isinstance(m, dict):
                    mem0_hits.append(m.get("memory") or m.get("content") or "")
    except Exception:
        pass

    lines = [f"# Context: {task}\n", "## Knowledge Base\n"]
    for i, h in enumerate(kb_hits[:n], 1):
        lines.append(f"### [{i}] {h['source']} ({h['doc_type']}, {h['method']}, {h['score']:.2f})")
        lines.append(h["text"][:600])
        lines.append("")
    if mem0_hits:
        lines.append("## Memories (Mem0)\n")
        for m in mem0_hits:
            if m:
                lines.append(f"- {m[:300]}")
    return "\n".join(lines)

# ── Graph ─────────────────────────────────────────────────────
def graph_link(from_name: str, relation: str, to_name: str, source: str = "") -> str:
    pg = get_pg(); cur = pg.cursor()
    for name in [from_name, to_name]:
        cur.execute(
            "INSERT INTO kb_entities (name) VALUES (%s) ON CONFLICT (name, entity_type) DO NOTHING",
            (name,),
        )
    cur.execute("""
        INSERT INTO kb_relations (from_name, relation, to_name, source)
        VALUES (%s, %s, %s, %s) ON CONFLICT (from_name, relation, to_name) DO NOTHING
    """, (from_name, relation, to_name, source))
    pg.commit(); pg.close()
    return f"Linked: {from_name} --[{relation}]--> {to_name}"

def graph_query(entity: str) -> str:
    pg = get_pg(); cur = pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT from_name, relation, to_name, source FROM kb_relations
        WHERE from_name ILIKE %s OR to_name ILIKE %s
        ORDER BY created_at DESC LIMIT 50
    """, (f"%{entity}%", f"%{entity}%"))
    rows = cur.fetchall(); pg.close()
    if not rows:
        return f"No graph relations for: {entity}"
    lines = [f"Graph relations for '{entity}':\n"]
    for r in rows:
        suffix = f"  (src: {r['source']})" if r["source"] else ""
        lines.append(f"  {r['from_name']} --[{r['relation']}]--> {r['to_name']}{suffix}")
    return "\n".join(lines)

# ── Ingest ────────────────────────────────────────────────────
def ingest_file(path: str, source: str = None, doc_type: str = "context") -> str:
    with open(path, encoding="utf-8", errors="ignore") as f:
        content = f.read()
    src = source or os.path.basename(path)
    r = add_to_kb(content, source=src, doc_type=doc_type)
    return f"Ingested {r['added']} chunks  source={src}  type={doc_type}"

# ── Stats ─────────────────────────────────────────────────────
def stats() -> str:
    qdrant = get_qdrant()
    info = qdrant.get_collection(COLLECTION)
    pg = get_pg(); cur = pg.cursor()
    cur.execute("SELECT doc_type, COUNT(*) FROM kb_docs GROUP BY doc_type ORDER BY count DESC")
    rows = cur.fetchall()
    cur.execute("SELECT COUNT(*) FROM kb_entities")
    ents = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM kb_relations")
    rels = cur.fetchone()[0]
    pg.close()
    lines = [
        f"Qdrant '{COLLECTION}': {info.points_count} vectors ({EMBED_DIM}-dim)",
        "PostgreSQL kb_docs:",
    ]
    for row in rows:
        lines.append(f"  {row[0]}: {row[1]} chunks")
    if not rows:
        lines.append("  (empty)")
    lines.append(f"Graph: {ents} entities, {rels} relations")
    return "\n".join(lines)

# ── CLI ───────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(description="Knowledge Base CLI")
    p.add_argument("command",
        choices=["search", "add", "context", "ingest",
                 "graph-link", "graph-query", "stats"])
    p.add_argument("args", nargs="*")
    p.add_argument("--n", type=int, default=8)
    p.add_argument("--source", default="")
    p.add_argument("--type", dest="doc_type", default="note")
    p.add_argument("--tags", default="")
    p.add_argument("--file", default="")
    a = p.parse_args()

    try:
        cmd = a.command
        if cmd == "search":
            hits = search_kb(" ".join(a.args), n=a.n,
                             doc_type=a.doc_type if a.doc_type != "note" else None)
            if not hits:
                print("No results.")
                return
            for h in hits:
                print(f"\n[{h['method'].upper()} {h['score']:.3f}] {h['source']} ({h['doc_type']})")
                print(textwrap.fill(h["text"][:500], 100,
                                    initial_indent="  ", subsequent_indent="  "))

        elif cmd == "add":
            if a.file:
                with open(a.file, encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            else:
                content = " ".join(a.args)
            tags = [t.strip() for t in a.tags.split(",") if t.strip()]
            r = add_to_kb(content, source=a.source or "manual",
                          doc_type=a.doc_type, tags=tags)
            print(f"Added {r['added']} chunk(s)  source={r['source']}")

        elif cmd == "context":
            print(load_context(" ".join(a.args), n=a.n))

        elif cmd == "ingest":
            path = a.args[0] if a.args else ""
            print(ingest_file(path, source=a.source or None, doc_type=a.doc_type))

        elif cmd == "graph-link":
            if len(a.args) >= 3:
                print(graph_link(a.args[0], a.args[1], a.args[2], source=a.source))
            else:
                print("Usage: graph-link FROM RELATION TO [--source SRC]")

        elif cmd == "graph-query":
            print(graph_query(" ".join(a.args)))

        elif cmd == "stats":
            print(stats())

    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        raise

if __name__ == "__main__":
    main()
