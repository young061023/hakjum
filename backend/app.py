import tempfile
import math
import os
import re
from pathlib import Path

from flask import Flask, jsonify, request, render_template_string
from pydantic import BaseModel, Field, ValidationError
from pypdf import PdfReader

from generate_quality_questions_from_pdf import (
    extract_pdf_text,
    split_chunks,
    generate_one,
)
from vector_store import (
    search_material_chunks,
    vectorize_material,
    vectorize_pages,
    vectorize_text,
)


APP_DIR = Path(__file__).resolve().parent
ADAPTER_PATH = str(APP_DIR / "adapters_exam_v4")

app = Flask(__name__)


class GradeProjectionInput(BaseModel):
    course_id: str = ""
    course_name: str = "과목 없음"
    credit_units: float = Field(default=3, gt=0, le=6)
    current_grade: str = "미정"
    total_students: int = Field(default=100, ge=1)
    target_grade: str = "A0"
    target_percent: float = Field(default=30, gt=0, le=100)
    attendance_weight: float = Field(default=10, ge=0, le=100)
    assignment_weight: float = Field(default=20, ge=0, le=100)
    midterm_weight: float = Field(default=30, ge=0, le=100)
    final_weight: float = Field(default=40, gt=0, le=100)
    attendance_score: float = Field(default=100, ge=0, le=100)
    assignment_score: float = Field(default=80, ge=0, le=100)
    midterm_score: float = Field(default=70, ge=0, le=100)
    midterm_rank: int | None = Field(default=None, ge=1)
    midterm_mean: float | None = Field(default=None, ge=0, le=100)
    midterm_std: float | None = Field(default=None, gt=0)
    final_mean: float | None = Field(default=None, ge=0, le=100)
    final_std: float | None = Field(default=None, gt=0)

HTML = """
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>학점수호자 문제 생성</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f6f8;
      color: #202124;
    }
    .wrap {
      max-width: 900px;
      margin: 40px auto;
      padding: 0 20px;
    }
    .panel {
      background: white;
      border: 1px solid #e1e4e8;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.04);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
    }
    p {
      color: #5f6368;
      line-height: 1.5;
    }
    label {
      display: block;
      margin-top: 18px;
      font-weight: 700;
    }
    input, select, button {
      margin-top: 8px;
      width: 100%;
      box-sizing: border-box;
      padding: 12px;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      font-size: 15px;
      background: white;
    }
    button {
      background: #2563eb;
      color: white;
      border: 0;
      cursor: pointer;
      font-weight: 700;
    }
    button:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }
    .status {
      margin-top: 16px;
      font-weight: 700;
      color: #2563eb;
    }
    .results {
      margin-top: 24px;
      display: grid;
      gap: 16px;
    }
    .card {
      background: white;
      border: 1px solid #e1e4e8;
      border-radius: 10px;
      padding: 18px;
      white-space: pre-wrap;
      line-height: 1.55;
    }
    .meta {
      color: #6b7280;
      font-size: 13px;
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <h1>학점수호자 문제 생성</h1>
      <p>강의 PDF를 올리면 파인튜닝 모델(adapters_exam_v4)을 사용해서 시험 문제를 생성합니다.</p>

      <form id="form">
        <label>PDF 파일</label>
        <input type="file" name="pdf" accept="application/pdf" required>

        <label>문제 유형</label>
        <select name="question_type">
          <option value="객관식">객관식</option>
          <option value="단답형">단답형</option>
          <option value="서술형">서술형</option>
        </select>

        <label>문제 개수</label>
        <input type="number" name="count" min="1" max="10" value="3">

        <button id="submit" type="submit">문제 생성</button>
      </form>

      <div id="status" class="status"></div>
    </div>

    <div id="results" class="results"></div>
  </div>

  <script>
    const form = document.getElementById("form");
    const statusEl = document.getElementById("status");
    const resultsEl = document.getElementById("results");
    const submitBtn = document.getElementById("submit");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(form);
      resultsEl.innerHTML = "";
      statusEl.textContent = "문제 생성 중입니다. 로컬 모델이라 시간이 걸릴 수 있어요.";
      submitBtn.disabled = true;

      try {
        const response = await fetch("/generate", {
          method: "POST",
          body: formData
        });

        const data = await response.json();

        if (!data.ok) {
          statusEl.textContent = data.error || "문제 생성에 실패했습니다.";
          return;
        }

        statusEl.textContent = `생성 완료: ${data.count}개`;

        if (data.questions.length === 0 && data.drafts.length === 0) {
          resultsEl.innerHTML = '<div class="card">생성된 문제가 없습니다. 다른 PDF로 다시 시도해 주세요.</div>';
          return;
        }

        const goodHtml = data.questions.map((item) => `
          <div class="card">
            <div class="meta">문제 ${item.question_number} · chunk ${item.source_chunk}</div>
            ${escapeHtml(item.question)}
          </div>
        `).join("");

        const draftHtml = data.drafts.map((item) => `
          <div class="card">
            <div class="meta">검토 필요 초안 · chunk ${item.source_chunk}</div>
            ${escapeHtml(item.question)}
          </div>
        `).join("");

        resultsEl.innerHTML = goodHtml + draftHtml;
        return;

        resultsEl.innerHTML = data.questions.map((item) => `
          <div class="card">
            <div class="meta">문제 ${item.question_number} · chunk ${item.source_chunk}</div>
            ${escapeHtml(item.question)}
          </div>
        `).join("");
      } catch (error) {
        statusEl.textContent = "요청 중 오류가 발생했습니다.";
      } finally {
        submitBtn.disabled = false;
      }
    });

    function escapeHtml(text) {
      return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }
  </script>
</body>
</html>
"""


def is_good_question(text):
    if not text:
        return False
    if "[검토 필요]" in text:
        return False
    if "문제:" not in text:
        return False
    if "정답:" not in text:
        return False
    if "해설:" not in text:
        return False

    bad_chars = ["ど", "几", "來", "�", "ты", "ты의"]
    for ch in bad_chars:
        if ch in text:
            return False

    return True


GRADE_CUTOFFS = {
    "A+": 95,
    "A0": 90,
    "B+": 85,
    "B0": 80,
    "C+": 75,
    "C0": 70,
    "D+": 65,
    "D0": 60,
}


def normal_cdf(value, mean, std):
    if mean is None or std is None or std <= 0:
        return None
    z = (value - mean) / (std * math.sqrt(2))
    return 0.5 * (1 + math.erf(z))


def grade_from_total(total):
    for grade, cutoff in GRADE_CUTOFFS.items():
        if total >= cutoff:
            return grade
    return "F"


def calculate_grade_projection(payload):
    data = GradeProjectionInput(**payload)
    weight_sum = (
        data.attendance_weight
        + data.assignment_weight
        + data.midterm_weight
        + data.final_weight
    )
    if abs(weight_sum - 100) > 0.01:
        raise ValueError("성적 반영 비율의 합은 100%여야 합니다.")

    target_rank = max(1, math.ceil(data.total_students * data.target_percent / 100))
    target_total = GRADE_CUTOFFS.get(data.target_grade, 90)
    secured_score = (
        data.attendance_score * data.attendance_weight / 100
        + data.assignment_score * data.assignment_weight / 100
        + data.midterm_score * data.midterm_weight / 100
    )
    required_final = (target_total - secured_score) / (data.final_weight / 100)
    required_final_clamped = max(0, min(100, required_final))
    current_estimated_grade = grade_from_total(secured_score)

    rank_percentile = None
    if data.midterm_rank:
        rank_percentile = max(0, min(100, (1 - (data.midterm_rank - 1) / data.total_students) * 100))

    midterm_percentile = normal_cdf(data.midterm_score, data.midterm_mean, data.midterm_std)
    final_needed_percentile = normal_cdf(required_final_clamped, data.final_mean, data.final_std)

    scenarios = []
    for final_score in [60, 70, 80, 90, 100]:
        total = secured_score + final_score * data.final_weight / 100
        percentile = normal_cdf(final_score, data.final_mean, data.final_std)
        scenarios.append(
            {
                "final_score": final_score,
                "expected_total": round(total, 2),
                "expected_grade": grade_from_total(total),
                "estimated_percentile": round(percentile * 100, 1) if percentile is not None else None,
            }
        )

    if required_final > 100:
        possibility = "낮음"
        possibility_score = round(max(5, 40 - (required_final - 100) * 4), 1)
    elif required_final >= 90:
        possibility = "도전"
        possibility_score = round(max(35, 100 - (required_final - 70) * 1.4), 1)
    elif required_final >= 75:
        possibility = "가능"
        possibility_score = round(max(60, 100 - (required_final - 60) * 0.9), 1)
    else:
        possibility = "높음"
        possibility_score = round(min(98, 100 - required_final * 0.25), 1)

    graph_points = [
        {
            "label": "현재 확보",
            "score": round(secured_score, 2),
            "grade": current_estimated_grade,
        },
        *[
            {
                "label": f"기말 {scenario['final_score']}",
                "score": scenario["expected_total"],
                "grade": scenario["expected_grade"],
            }
            for scenario in scenarios
        ],
    ]

    if required_final > 100:
        direction = "목표 학점 기준으로는 기말 만점만으로도 부족할 수 있어 과제/출석 보완과 목표 조정이 필요합니다."
    elif required_final >= 90:
        direction = "기말 고득점이 필요합니다. 교안 핵심 개념 복습과 주관식 답안 연습 비중을 높이세요."
    elif required_final >= 75:
        direction = "충분히 노려볼 수 있습니다. 오답 피드백과 예상 문제 반복으로 안정권을 만드세요."
    else:
        direction = "현재 확보 점수가 좋아 목표권에 가깝습니다. 실수 방지와 약점 보완 중심으로 유지하세요."

    return {
        "course_id": data.course_id,
        "course_name": data.course_name,
        "credit_units": data.credit_units,
        "current_grade": data.current_grade,
        "current_estimated_grade": current_estimated_grade,
        "target_grade": data.target_grade,
        "target_percent": data.target_percent,
        "target_rank": target_rank,
        "target_rank_text": f"{data.total_students}명 중 {target_rank}등 이내",
        "secured_score": round(secured_score, 2),
        "target_total": target_total,
        "required_final_score": round(required_final, 2),
        "required_final_score_clamped": round(required_final_clamped, 2),
        "possibility": possibility,
        "possibility_score": possibility_score,
        "rank_percentile": round(rank_percentile, 1) if rank_percentile is not None else None,
        "midterm_percentile": round(midterm_percentile * 100, 1) if midterm_percentile is not None else None,
        "final_needed_percentile": round(final_needed_percentile * 100, 1) if final_needed_percentile is not None else None,
        "scenarios": scenarios,
        "graph_points": graph_points,
        "direction": direction,
        "input": data.model_dump(),
    }


def generate_questions_for_uploaded_pdf(
    pdf_path,
    question_type="객관식",
    count=5,
    max_tokens=260,
):
    text = extract_pdf_text(pdf_path)
    chunks = split_chunks(text)
    sources = [{"source": "uploaded_pdf", "chunk_index": index} for index in range(len(chunks))]

    return generate_questions_from_chunks(
        chunks=chunks,
        sources=sources,
        question_type=question_type,
        count=count,
        max_tokens=max_tokens,
    )



def clean_chunk_for_fallback(chunk):
    text = str(chunk or "")
    text = re.sub(r"#{1,6}\s*", " ", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\[[pP]\.?\s*\d+\]", " ", text)
    text = re.sub(r"요약\s*기반|개념|출처", " ", text)
    text = re.sub(r"[·•*]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_math_chunk(chunk):
    text = str(chunk or "")
    return bool(re.search(r"극한|연속|미분|도함수|미분계수|평균변화율|조임정리|샌드위치|함수|방정식|부정형|로피탈|삼각함수|sin|cos|tan|lim|f\s*\(|x\^|x\d|\\frac", text, flags=re.I))


def is_conceptual_math_question(text):
    problem_match = re.search(r"문제:\s*([\s\S]*?)(?=\n\s*(?:정답|답|해설)\s*[:：]|$)", str(text or ""))
    problem = problem_match.group(1).strip() if problem_match else str(text or "")
    asks_concept = re.search(r"설명|서술|정의|의미|핵심\s*내용|조건은|무엇인가|무엇인지", problem)
    asks_calculation = re.search(r"계산|구하|풀|값|해|미분하|극한값|연속이\s*되도록|=|x\^|f\s*\(|lim|sin|cos|tan|\\frac", problem, flags=re.I)
    return bool(asks_concept and not asks_calculation)


def fallback_math_question_from_chunk(chunk, question_type="서술형", number=1):
    clean = clean_chunk_for_fallback(chunk)
    cases = []

    if re.search(r"조임정리|샌드위치", clean):
        cases.append((
            "조임정리(샌드위치 정리)를 이용하여 lim x->0 x^2 sin(1/x)의 값을 계산하시오.",
            "0",
            "-x^2 <= x^2 sin(1/x) <= x^2이고 양끝 함수의 극한이 0이므로 조임정리에 의해 극한값은 0입니다.",
        ))
    if re.search(r"평균변화율", clean):
        cases.append((
            "함수 f(x)=x^2+1의 구간 [1, 3]에서 평균변화율을 계산하시오.",
            "4",
            "평균변화율은 (f(3)-f(1))/(3-1)=(10-2)/2=4입니다.",
        ))
    if re.search(r"미분계수|도함수|미분", clean):
        cases.append((
            "함수 f(x)=x^3-2x의 x=2에서의 도함수 값을 계산하시오.",
            "10",
            "f'(x)=3x^2-2이므로 f'(2)=12-2=10입니다.",
        ))
    if re.search(r"연속", clean):
        cases.append((
            "함수 f(x)=x^2 (x≠2), f(2)=a가 x=2에서 연속이 되도록 하는 a의 값을 구하시오.",
            "4",
            "x가 2에 가까워질 때 x^2의 극한은 4이므로 연속이 되려면 a=4입니다.",
        ))
    if re.search(r"극한|부정형|로피탈|lim", clean, flags=re.I):
        cases.append((
            "lim x->1 (x^2-1)/(x-1)의 값을 계산하시오.",
            "2",
            "x^2-1=(x-1)(x+1)이므로 x≠1에서 식은 x+1이고, x->1일 때 값은 2입니다.",
        ))

    cases.append((
        "방정식 2x+3=7을 풀어 x의 값을 구하시오.",
        "x = 2",
        "양변에서 3을 빼면 2x=4이고, 양변을 2로 나누면 x=2입니다.",
    ))
    problem, answer, explanation = cases[(max(0, number - 1)) % len(cases)]

    if question_type == "객관식":
        option2 = "1" if answer == "0" else "0"
        option3 = "2" if answer == "4" else "4"
        return "\n".join([
            f"문제: {problem}",
            "보기:",
            f"1. {answer}",
            f"2. {option2}",
            f"3. {option3}",
            "4. 계산할 수 없다",
            "정답: 1번",
            f"해설: {explanation}",
        ])

    return "\n".join([
        f"문제: {problem}",
        f"정답: {answer}",
        f"해설: {explanation}",
    ])


def fallback_question_from_chunk(chunk, question_type="서술형", number=1):
    if is_math_chunk(chunk):
        return fallback_math_question_from_chunk(chunk, question_type=question_type, number=number)

    clean = clean_chunk_for_fallback(chunk)
    sentences = [part.strip() for part in re.split(r"(?<=[.!?。])\s+", clean) if len(part.strip()) >= 12]
    basis = (sentences[0] if sentences else clean[:180]).strip() or "교안의 핵심 개념을 정리한다."
    concept = re.sub(r"[^0-9A-Za-z가-힣 /()\-]", " ", basis).strip()[:36] or "핵심 개념"

    if question_type == "객관식":
        return "\n".join([
            f"문제: 다음 중 교안 내용 '{concept}'에 대한 설명으로 가장 적절한 것은?",
            "보기:",
            f"1. {basis[:120]}",
            "2. 교안 내용과 관계없는 설명이다.",
            "3. 제시된 개념과 반대되는 설명이다.",
            "4. 문제에서 확인할 수 없는 설명이다.",
            "정답: 1번",
            f"해설: 교안의 해당 부분은 '{basis[:120]}' 내용을 중심으로 설명한다.",
        ])

    return "\n".join([
        f"문제: 교안 내용을 바탕으로 '{concept}'의 핵심 내용을 설명하시오.",
        f"정답: {basis[:180]}",
        f"해설: 교안의 해당 부분을 근거로 핵심 개념을 요약하면 {basis[:160]}입니다.",
    ])

def generate_questions_from_chunks(
    chunks,
    sources=None,
    question_type="객관식",
    count=5,
    max_tokens=260,
):
    if not chunks:
        return [], []

    sources = sources or [{"chunk_index": index} for index in range(len(chunks))]
    good_results = []
    seen_questions = set()
    draft_results = []
    attempts = 0
    target_count = max(1, min(int(count or 1), 3))
    max_attempts = max(target_count * 2, target_count + 2)

    while len(good_results) < target_count and attempts < max_attempts:
        source_index = attempts % len(chunks)
        chunk = chunks[source_index]
        source = sources[source_index] if source_index < len(sources) else {"chunk_index": source_index}

        question, errors = generate_one(
            chunk=chunk,
            question_type=question_type,
            max_tokens=max_tokens,
            adapter_path=ADAPTER_PATH,
            retries=1,
        )

        item = {
            "question_number": len(good_results) + 1,
            "source_chunk": source_index,
            "source": source,
            "question": question,
        }

        first_line = question.splitlines()[0].strip() if question else ""

        if is_math_chunk(chunk) and is_conceptual_math_question(question):
            item["question"] = fallback_question_from_chunk(chunk, question_type=question_type, number=attempts + 1)
            good_results.append(item)
            draft_results.append({**item, "question": question})
        elif is_good_question(question) and first_line not in seen_questions:
            seen_questions.add(first_line)
            good_results.append(item)
        else:
            item["question"] = fallback_question_from_chunk(chunk, question_type=question_type, number=attempts + 1)
            good_results.append(item)
            draft_results.append({**item, "question": question})

        attempts += 1

    return good_results, draft_results

@app.route("/", methods=["GET"])
def index():
    return render_template_string(HTML)


@app.route("/generate", methods=["POST"])
def generate():
    question_type = request.form.get("question_type", "객관식")
    count = int(request.form.get("count", "5"))
    material_id = request.form.get("material_id", "").strip()
    course_id = request.form.get("course_id", "").strip()
    search_query = (
        request.form.get("query")
        or request.form.get("instruction")
        or request.form.get("prompt")
        or question_type
    ).strip()

    if question_type == "주관식":
        question_type = "서술형"

    if question_type not in ["객관식", "단답형", "서술형"]:
        return jsonify({"ok": False, "error": "question_type은 객관식, 단답형, 주관식, 서술형 중 하나여야 합니다."}), 400

    if material_id:
        try:
            retrieved = search_material_chunks(
                query=search_query,
                course_id=course_id or None,
                material_id=material_id,
                limit=max(count * 2, 5),
            )
        except Exception as error:
            return jsonify({"ok": False, "error": str(error)}), 500

        chunks = [item["text"] for item in retrieved]
        sources = [item["metadata"] | {"distance": item["distance"]} for item in retrieved]
        questions, drafts = generate_questions_from_chunks(
            chunks=chunks,
            sources=sources,
            question_type=question_type,
            count=count,
        )
    elif "pdf" in request.files:
        pdf = request.files["pdf"]
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = Path(tmpdir) / "upload.pdf"
            pdf.save(pdf_path)

            questions, drafts = generate_questions_for_uploaded_pdf(
                pdf_path=pdf_path,
                question_type=question_type,
                count=count,
            )
    else:
        return jsonify({"ok": False, "error": "pdf 파일 또는 material_id가 필요합니다."}), 400

    return jsonify(
        {
            "ok": True,
            "question_type": question_type,
            "count": len(questions),
            "questions": questions,
            "drafts": drafts,
        }
    )


@app.route("/vectorize-material", methods=["POST"])
def vectorize_material_route():
    data = request.get_json(silent=True) or request.form
    material_id = str(data.get("material_id", "")).strip()
    course_id = str(data.get("course_id", "")).strip()

    if not material_id:
        return jsonify({"ok": False, "error": "material_id가 필요합니다."}), 400

    try:
        result = vectorize_material(material_id=material_id, course_id=course_id or None)
    except Exception as error:
        return jsonify({"ok": False, "error": str(error)}), 500

    return jsonify({"ok": True, **result})


@app.route("/vectorize-text", methods=["POST"])
def vectorize_text_route():
    data = request.get_json(silent=True) or {}
    material_id = str(data.get("material_id", "")).strip()
    course_id = str(data.get("course_id", "")).strip()
    course_name = str(data.get("course_name", "")).strip()
    title = str(data.get("title", "")).strip()
    text = str(data.get("text", "")).strip()

    if not material_id:
        return jsonify({"ok": False, "error": "material_id가 필요합니다."}), 400
    if not text:
        return jsonify({"ok": False, "error": "벡터화할 text가 필요합니다."}), 400

    try:
        result = vectorize_text(
            material_id=material_id,
            course_id=course_id or None,
            course_name=course_name,
            title=title,
            text=text,
        )
    except Exception as error:
        return jsonify({"ok": False, "error": str(error)}), 500

    return jsonify({"ok": True, **result})


@app.route("/vectorize-upload", methods=["POST"])
def vectorize_upload_route():
    material_id = str(request.form.get("material_id", "")).strip()
    course_id = str(request.form.get("course_id", "")).strip()
    course_name = str(request.form.get("course_name", "")).strip()
    title = str(request.form.get("title", "")).strip()
    file = request.files.get("file")

    if not material_id:
        return jsonify({"ok": False, "error": "material_id가 필요합니다."}), 400
    if not file:
        return jsonify({"ok": False, "error": "벡터화할 교안 파일이 필요합니다."}), 400

    filename = file.filename or title or "uploaded.pdf"
    if not filename.lower().endswith(".pdf"):
        return jsonify({"ok": False, "error": "현재 페이지 번호 추출은 PDF 파일만 지원합니다."}), 400

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = Path(tmpdir) / "upload.pdf"
            file.save(pdf_path)
            reader = PdfReader(str(pdf_path))
            pages = []
            for index, page in enumerate(reader.pages, start=1):
                text = page.extract_text() or ""
                if text.strip():
                    pages.append({"page_number": index, "text": text})

        result = vectorize_pages(
            material_id=material_id,
            course_id=course_id or None,
            course_name=course_name,
            title=title or filename,
            pages=pages,
        )
    except Exception as error:
        return jsonify({"ok": False, "error": str(error)}), 500

    return jsonify({"ok": True, **result})


@app.route("/search-material", methods=["POST"])
def search_material_route():
    data = request.get_json(silent=True) or request.form
    query = str(data.get("query", "")).strip()
    course_id = str(data.get("course_id", "")).strip()
    material_id = str(data.get("material_id", "")).strip()
    limit = int(data.get("limit", 5))

    if not query:
        return jsonify({"ok": False, "error": "query가 필요합니다."}), 400

    try:
        chunks = search_material_chunks(
            query=query,
            course_id=course_id or None,
            material_id=material_id or None,
            limit=limit,
        )
    except Exception as error:
        return jsonify({"ok": False, "error": str(error)}), 500

    return jsonify({"ok": True, "chunks": chunks})


@app.route("/grade-projection", methods=["POST"])
def grade_projection_route():
    payload = request.get_json(silent=True) or {}

    try:
        result = calculate_grade_projection(payload)
    except ValidationError as error:
        return jsonify({"ok": False, "error": error.errors()}), 400
    except Exception as error:
        return jsonify({"ok": False, "error": str(error)}), 400

    return jsonify({"ok": True, "result": result})


if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )
