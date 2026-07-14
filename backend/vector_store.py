import hashlib
import math
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
CHROMA_DIR = Path(os.getenv("CHROMA_DIR", str(APP_DIR / "chroma_db")))
COLLECTION_NAME = "lecture_chunks"
EMBEDDING_DIM = 384


def load_local_env():
    env_path = APP_DIR / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value


load_local_env()


def clean_text(text):
    text = (text or "").replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def infer_concept_title(text):
    raw = str(text or "")
    patterns = [
        r"\*\*([^*]{2,60})\*\*",
        r"(?:^|\n|\.|\*)\s*([가-힣A-Za-z0-9()[\] /·+\-=]{2,50})\s*[:：]",
        r"#{1,6}\s*([^\n#*]{2,60})",
    ]

    for pattern in patterns:
        match = re.search(pattern, raw)
        if match:
            title = match.group(1)
            break
    else:
        title = raw[:45]

    title = re.sub(r"^[\s*\-#0-9.)]+", "", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title[:45]


def split_text_chunks(text, max_chars=700, min_chars=80):
    text = clean_text(text)
    if not text:
        return []

    paragraphs = [part.strip() for part in re.split(r"\n+|(?<=[.!?。])\s+", text) if part.strip()]
    chunks = []
    current = ""

    for paragraph in paragraphs:
        if len(current) + len(paragraph) > max_chars and current:
            chunks.append(current.strip())
            current = paragraph
        else:
            current = f"{current} {paragraph}".strip()

    if current:
        chunks.append(current.strip())

    final_chunks = []
    for chunk in chunks:
        if len(chunk) <= max_chars:
            final_chunks.append(chunk)
            continue
        for index in range(0, len(chunk), max_chars):
            piece = chunk[index : index + max_chars].strip()
            if piece:
                final_chunks.append(piece)

    return [chunk for chunk in final_chunks if len(chunk) >= min_chars] or final_chunks


class HashEmbeddingFunction:
    def name(self):
        return "hash_embedding"

    def __call__(self, input):
        return [hash_embedding(text) for text in input]

    def embed_query(self, input):
        return self(input)

    def embed_documents(self, input):
        return self(input)


def hash_embedding(text, dim=EMBEDDING_DIM):
    vector = [0.0] * dim
    tokens = re.findall(r"[\w가-힣]+", clean_text(text).lower())

    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "little") % dim
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign

    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


def get_embedding_function():
    model_name = os.getenv("EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
    if model_name.lower() == "hash":
        return HashEmbeddingFunction()

    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        return HashEmbeddingFunction()

    try:
        model = SentenceTransformer(model_name)
    except Exception:
        return HashEmbeddingFunction()

    class SentenceTransformerEmbeddingFunction:
        def name(self):
            return f"sentence_transformer_{model_name}"

        def __call__(self, input):
            return model.encode(input, normalize_embeddings=True).tolist()

        def embed_query(self, input):
            return self(input)

        def embed_documents(self, input):
            return self(input)

    return SentenceTransformerEmbeddingFunction()


def get_collection():
    try:
        import chromadb
    except ImportError as error:
        raise RuntimeError("chromadb가 설치되어 있지 않습니다. pip install -r requirements.txt 를 실행하세요.") from error

    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=get_embedding_function(),
        metadata={"hnsw:space": "cosine"},
    )


def supabase_request(path, method="GET", body=None):
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

    if not supabase_url or not key:
        raise RuntimeError("SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY 또는 SUPABASE_ANON_KEY가 필요합니다.")

    url = f"{supabase_url}/rest/v1/{path}"
    data = None
    headers = {
        "apikey": key,
        "authorization": f"Bearer {key}",
        "content-type": "application/json",
        "accept": "application/json",
    }

    if body is not None:
        import json

        data = json.dumps(body).encode("utf-8")

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read().decode("utf-8")
        if not raw:
            return None

        import json

        return json.loads(raw)


def fetch_material_pages(material_id):
    query = urllib.parse.urlencode(
        {
            "material_id": f"eq.{material_id}",
            "select": "id,course_id,material_id,page_number,slide_number,cleaned_text",
            "order": "page_number.asc,slide_number.asc,id.asc",
        }
    )
    return supabase_request(f"material_pages?{query}") or []


def mark_material_status(material_id, status):
    material_id = urllib.parse.quote(str(material_id), safe="")
    return supabase_request(f"materials?id=eq.{material_id}", method="PATCH", body={"status": status})


def vectorize_material(material_id, course_id=None):
    pages = fetch_material_pages(material_id)
    if not pages:
        raise RuntimeError("Supabase에서 material_pages.cleaned_text를 찾지 못했습니다.")

    collection = get_collection()
    ids = []
    documents = []
    metadatas = []

    for page in pages:
        page_course_id = course_id or page.get("course_id") or ""
        chunks = split_text_chunks(page.get("cleaned_text", ""))

        for chunk_index, chunk in enumerate(chunks):
            chunk_id = f"{page.get('material_id')}:{page.get('id')}:{chunk_index}"
            ids.append(chunk_id)
            documents.append(chunk)
            metadatas.append(
                {
                    "course_id": str(page_course_id),
                    "material_id": str(page.get("material_id")),
                    "page_id": str(page.get("id")),
                    "page_number": page.get("page_number") or 0,
                    "slide_number": page.get("slide_number") or 0,
                    "chunk_index": chunk_index,
                    "concept": infer_concept_title(chunk),
                }
            )

    if ids:
        collection.delete(where={"material_id": str(material_id)})
        collection.add(ids=ids, documents=documents, metadatas=metadatas)
        mark_material_status(material_id, "vectorized")

    return {"material_id": material_id, "chunk_count": len(ids), "status": "vectorized"}


def vectorize_pages(material_id, pages, course_id=None, course_name="", title="", source="uploaded_pdf"):
    collection = get_collection()
    ids = []
    documents = []
    metadatas = []

    for page in pages:
        page_number = page.get("page_number") or 0
        slide_number = page.get("slide_number") or 0
        chunks = split_text_chunks(page.get("text", ""))

        for chunk_index, chunk in enumerate(chunks):
            chunk_id = f"{material_id}:page:{page_number}:{slide_number}:{chunk_index}"
            ids.append(chunk_id)
            documents.append(chunk)
            metadatas.append(
                {
                    "course_id": str(course_id or ""),
                    "course_name": str(course_name or ""),
                    "material_id": str(material_id),
                    "title": str(title or ""),
                    "page_id": "",
                    "page_number": int(page_number or 0),
                    "slide_number": int(slide_number or 0),
                    "chunk_index": chunk_index,
                    "concept": infer_concept_title(chunk),
                    "source": str(source or "uploaded_pdf"),
                }
            )

    if not ids:
        raise RuntimeError("PDF에서 벡터화할 페이지 텍스트를 찾지 못했습니다.")

    collection.delete(where={"material_id": str(material_id)})
    collection.add(ids=ids, documents=documents, metadatas=metadatas)

    return {"material_id": material_id, "chunk_count": len(ids), "status": "vectorized"}


def vectorize_text(material_id, text, course_id=None, course_name="", title="", source="local_upload"):
    chunks = split_text_chunks(text)
    if not chunks:
        raise RuntimeError("벡터화할 교안 텍스트가 비어 있습니다.")

    collection = get_collection()
    ids = []
    documents = []
    metadatas = []

    for chunk_index, chunk in enumerate(chunks):
        chunk_id = f"{material_id}:local:{chunk_index}"
        ids.append(chunk_id)
        documents.append(chunk)
        metadatas.append(
            {
                "course_id": str(course_id or ""),
                "course_name": str(course_name or ""),
                "material_id": str(material_id),
                "title": str(title or ""),
                "page_id": "",
                "page_number": 0,
                "slide_number": 0,
                "chunk_index": chunk_index,
                "concept": infer_concept_title(chunk),
                "source": str(source or "local_upload"),
            }
        )

    collection.delete(where={"material_id": str(material_id)})
    collection.add(ids=ids, documents=documents, metadatas=metadatas)

    return {"material_id": material_id, "chunk_count": len(ids), "status": "vectorized"}


def search_material_chunks(query, course_id=None, material_id=None, limit=5):
    collection = get_collection()
    where = {}
    if course_id:
        where["course_id"] = str(course_id)
    if material_id:
        where["material_id"] = str(material_id)

    result = collection.query(
        query_texts=[query],
        n_results=limit,
        where=where or None,
        include=["documents", "metadatas", "distances"],
    )

    documents = result.get("documents", [[]])[0]
    metadatas = result.get("metadatas", [[]])[0]
    distances = result.get("distances", [[]])[0]

    chunks = []
    for document, metadata, distance in zip(documents, metadatas, distances):
        chunks.append({"text": document, "metadata": metadata, "distance": distance})

    return chunks
