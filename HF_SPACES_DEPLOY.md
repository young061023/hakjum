# Hugging Face Spaces Docker 배포

이 방식은 `backend/`를 Hugging Face Spaces의 Docker Space로 올려서 `/generate`, `/vectorize-upload`, `/search-material` 같은 API를 실행하는 방식입니다.

## 중요한 제한

- 현재 `backend/adapters_exam_v4`는 MLX LoRA 어댑터 형식입니다.
- Hugging Face Spaces는 Linux 환경이라 `mlx_lm.generate`를 그대로 쓸 수 없습니다.
- 그래서 Docker에서는 `transformers + peft` 백엔드로 실행합니다.
- PEFT 형식 어댑터를 따로 올린 경우 `HF_ADAPTER_ID`에 Hugging Face 모델/어댑터 repo id를 넣으면 됩니다.
- 아직 PEFT 어댑터가 없으면 기본 `Qwen/Qwen3-1.7B`로 문제 생성이 동작합니다.

## Space 만들기

1. Hugging Face에서 **New Space**를 누릅니다.
2. Space SDK는 **Docker**를 선택합니다.
3. Repository에 이 프로젝트의 `backend/` 내용이 들어가야 합니다.
   - 가장 쉬운 방법: 별도 Space repo를 만들고 `backend` 폴더 안의 파일들을 Space repo 루트에 복사합니다.
   - Space repo 루트에 `Dockerfile`, `app.py`, `vector_store.py`, `generate_quality_questions_from_pdf.py`, `requirements.txt`가 있어야 합니다.

## Space 환경변수

Space Settings → Variables and secrets에서 설정합니다.

```text
INFERENCE_BACKEND=transformers
HF_BASE_MODEL=Qwen/Qwen3-1.7B
EMBEDDING_MODEL=hash
CHROMA_DIR=/data/chroma_db
```

PEFT 어댑터를 Hugging Face에 따로 올렸다면 추가합니다.

```text
HF_ADAPTER_ID=your-username/your-peft-adapter
```

## 프론트엔드 연결

프론트엔드 배포 환경변수의 `BACKEND_URL`을 Space 주소로 넣습니다.

예시:

```text
BACKEND_URL=https://your-username-hakjum-api.hf.space
```

## Chroma 주의

무료 Space의 파일 저장은 재시작/재빌드 때 유지가 불안정할 수 있습니다. 발표용 테스트는 가능하지만, 실제 서비스처럼 계속 저장하려면 Supabase pgvector나 유료 persistent storage를 쓰는 편이 안정적입니다.
