# Render 배포 체크리스트

## 1. Backend 서비스

- Name: `hakjum-api`
- Root Directory: `backend`
- Runtime: Python
- Build Command:

```bash
pip install -r requirements.txt
```

- Start Command:

```bash
gunicorn app:app --bind 0.0.0.0:$PORT
```

- Environment Variables:

```text
GEMINI_API_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
EMBEDDING_MODEL=hash
CHROMA_DIR=/var/data/chroma_db
```

- Persistent Disk:

```text
Mount Path: /var/data
```

## 2. Frontend 서비스

- Name: `hakjum-web`
- Root Directory: repository root
- Runtime: Node
- Build Command:

```bash
npm install
```

- Start Command:

```bash
node server.js
```

- Environment Variables:

```text
BACKEND_URL=https://hakjum-api.onrender.com
GEMINI_API_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

`BACKEND_URL`은 실제 Render backend 서비스 주소로 바꿔야 합니다.

## 주의

- `.env`, `.env.local`, `backend/.env`, `backend/chroma_db/`는 GitHub에 올리지 않습니다.
- 현재 파인튜닝 추론이 Mac 전용 `mlx_lm`에 의존하면 Render Linux에서 그대로 실행되지 않을 수 있습니다.
- Chroma DB 데이터 유지를 위해 backend 서비스에 Persistent Disk를 연결합니다.
