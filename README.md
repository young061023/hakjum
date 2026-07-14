# 학점수호자 문제 생성 웹

회색 톤의 기본형 웹 UI입니다. 강의자료를 업로드하면 `http://127.0.0.1:8000` 로컬 파인튜닝 API를 호출하고, 생성 결과를 Supabase `generated_questions` 테이블에 저장할 수 있습니다.

## 실행

Gemini 요약과 Supabase 로그인을 사용하려면 `.env.local` 파일을 만들고 키를 넣습니다.
`.env.local.example`은 복사용 예시 파일이라 서버가 실행 때 읽지 않습니다.

```bash
GEMINI_API_KEY=your_gemini_api_key_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

```bash
npm start
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다.

## Supabase 설정

1. Supabase SQL editor에서 `supabase.sql` 내용을 실행합니다.
2. `.env.local`에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`를 넣습니다.
3. Supabase Auth에서 Email provider를 켭니다.
4. 웹의 `로그인` 페이지에서 가입/로그인하면 과목, 교안 요약, 일정, 문제 생성 기록이 사용자별로 저장됩니다.

## Chroma DB 역할

Chroma DB는 로그인/서비스 데이터 저장용이 아니라 교안 chunk와 embedding을 저장해 문제 생성 시 관련 교안 내용을 검색하는 용도입니다. 사용자 계정, 과목, 일정, 요약본, 생성 기록은 Supabase에 저장합니다. 현재 프론트는 5173 서버를 거쳐 8000 모델 서버에 문제 생성을 요청하므로, Chroma 연결은 8000 백엔드에서 구성하는 방식이 가장 자연스럽습니다.

5173 프론트 서버는 아래 Chroma 관련 API도 8000 백엔드로 프록시합니다.

- `POST /vectorize-material`: Supabase `material_pages.cleaned_text`를 Chroma DB에 저장
- `POST /search-material`: Chroma DB에서 관련 교안 chunk 검색
- `POST /generate` + `material_id`: Chroma 검색 결과를 사용해 문제 생성

## 로컬 모델 API

프론트는 아래 엔드포인트를 순서대로 시도합니다.

- `/generate`
- `/generate-questions`
- `/api/generate`
- `/api/generate-questions`
- `/questions/generate`

파일 필드는 `file`, `pdf`, `material` 이름으로 함께 전송하고, 문제 유형/개수/난이도/과목명/요청사항도 `FormData`로 보냅니다.
