import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

try:
    import sympy as sp
except ImportError:
    sp = None


MLX_MODEL = os.getenv("MLX_MODEL", "Qwen/Qwen3-1.7B-MLX-4bit")
HF_BASE_MODEL = os.getenv("HF_BASE_MODEL", "Qwen/Qwen3-1.7B")
BAD_CHARS = ["ど", "几", "來", "�"]
_TRANSFORMERS_RUNTIME = None


def clean_source_text(text):
    text = text.replace("\u00a0", " ")
    text = re.sub(r"ⓒ.*", " ", text)
    text = re.sub(r"Saebyeol.?s PowerPoint", " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_pdf_text(pdf_path):
    if PdfReader is None:
        raise SystemExit("pypdf가 없습니다. 먼저 실행하세요: pip install pypdf")

    reader = PdfReader(pdf_path)
    parts = []

    for page in reader.pages:
        text = page.extract_text() or ""
        text = clean_source_text(text)
        if text:
            parts.append(text)

    return "\n".join(parts)


def split_chunks(text, max_chars=900):
    text = clean_source_text(text)

    raw_parts = re.split(r"(?<=[.!?。])\s+", text)
    chunks = []
    current = ""

    for part in raw_parts:
        part = part.strip()
        if not part:
            continue

        if len(current) + len(part) > max_chars and current:
            chunks.append(current.strip())
            current = part
        else:
            current = (current + " " + part).strip()

    if current:
        chunks.append(current.strip())

    final_chunks = []
    for chunk in chunks:
        if len(chunk) <= max_chars:
            final_chunks.append(chunk)
        else:
            for i in range(0, len(chunk), max_chars):
                piece = chunk[i:i + max_chars].strip()
                if piece:
                    final_chunks.append(piece)

    return final_chunks


def build_prompt(chunk, question_type):
    if question_type == "객관식":
        return f"""
너는 대학 강의자료 기반 시험문제 출제자다.
아래 강의 내용만 근거로 객관식 문제 1개를 만들어라.

반드시 지킬 규칙:
- 한국어로만 작성한다.
- 문제 문장을 반드시 작성한다.
- 보기 1, 2, 3, 4를 반드시 작성한다.
- 정답은 반드시 "정답: N번" 형식으로 작성한다.
- 해설은 1~2문장으로 짧게 작성한다.
- 강의 내용에 없는 내용을 만들지 않는다.
- 영어, 일본어, 중국어를 쓰지 않는다.
- <think>를 출력하지 않는다.
- 원문을 길게 복사하지 않는다.
- 띄어쓰기를 자연스럽게 고쳐서 작성한다.
- 붙어 있는 한국어 단어는 사람이 읽기 쉽게 띄어 쓴다.
- 파일명, 페이지 번호, 제목 조각은 문제 문장에 넣지 않는다.

출력 형식:
문제: ...
보기:
1. ...
2. ...
3. ...
4. ...
정답: N번
해설: ...

강의 내용:
{chunk}
""".strip()

    if question_type == "단답형":
        return f"""
너는 대학 강의자료 기반 시험문제 출제자다.
아래 강의 내용만 근거로 단답형 문제 1개를 만들어라.

반드시 지킬 규칙:
- 한국어로만 작성한다.
- 문제 문장을 반드시 작성한다.
- 정답은 짧게 작성한다.
- 해설은 1~2문장으로 짧게 작성한다.
- 강의 내용에 없는 내용을 만들지 않는다.
- <think>를 출력하지 않는다.
- 원문을 길게 복사하지 않는다.

출력 형식:
문제: ...
정답: ...
해설: ...

강의 내용:
{chunk}
""".strip()

    return f"""
너는 대학 강의자료 기반 시험문제 출제자다.
아래 강의 내용만 근거로 서술형 문제 1개를 만들어라.

반드시 지킬 규칙:
- 한국어로만 작성한다.
- 문제 문장을 반드시 작성한다.
- 정답은 채점 기준처럼 작성한다.
- 해설은 1~2문장으로 짧게 작성한다.
- 강의 내용에 없는 내용을 만들지 않는다.
- <think>를 출력하지 않는다.
- 원문을 길게 복사하지 않는다.

출력 형식:
문제: ...
정답: ...
해설: ...

강의 내용:
{chunk}
""".strip()


def choose_inference_backend():
    backend = os.getenv("INFERENCE_BACKEND", "auto").strip().lower()
    if backend in {"mlx", "transformers"}:
        return backend
    if sys.platform == "darwin":
        return "mlx"
    return "transformers"


def run_model(prompt, max_tokens, adapter_path=None):
    backend = choose_inference_backend()
    if backend == "transformers":
        return run_transformers_model(prompt, max_tokens, adapter_path)
    return run_mlx_model(prompt, max_tokens, adapter_path)


def run_mlx_model(prompt, max_tokens, adapter_path=None):
    mlx_generate = os.getenv("MLX_LM_GENERATE") or str(Path(sys.executable).with_name("mlx_lm.generate"))
    cmd = [
        mlx_generate,
        "--model",
        MLX_MODEL,
        "--prompt",
        prompt,
        "--max-tokens",
        str(max_tokens),
    ]

    if adapter_path:
        cmd.extend(["--adapter-path", adapter_path])

    result = subprocess.run(cmd, capture_output=True, text=True)
    text = result.stdout

    if "==========" in text:
        parts = text.split("==========")
        if len(parts) >= 3:
            text = parts[1]

    return clean_generated_text(text)


def is_peft_adapter_path(adapter_path):
    if not adapter_path:
        return False

    path = Path(adapter_path)
    if not path.exists():
        return False

    config_path = path / "adapter_config.json"
    if not config_path.exists():
        return False

    config_text = config_path.read_text(encoding="utf-8", errors="ignore")
    return "peft_type" in config_text or "base_model_name_or_path" in config_text


def load_transformers_runtime(adapter_path=None):
    global _TRANSFORMERS_RUNTIME
    if _TRANSFORMERS_RUNTIME is not None:
        return _TRANSFORMERS_RUNTIME

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(HF_BASE_MODEL, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        HF_BASE_MODEL,
        torch_dtype="auto",
        low_cpu_mem_usage=True,
        trust_remote_code=True,
    )

    peft_adapter = os.getenv("HF_ADAPTER_ID")
    if not peft_adapter and is_peft_adapter_path(adapter_path):
        peft_adapter = adapter_path

    if peft_adapter:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, peft_adapter)

    model.eval()
    _TRANSFORMERS_RUNTIME = tokenizer, model
    return _TRANSFORMERS_RUNTIME


def run_transformers_model(prompt, max_tokens, adapter_path=None):
    import torch

    tokenizer, model = load_transformers_runtime(adapter_path)
    if getattr(tokenizer, "chat_template", None):
        prompt_text = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            tokenize=False,
            add_generation_prompt=True,
        )
    else:
        prompt_text = prompt

    inputs = tokenizer(prompt_text, return_tensors="pt")
    model_device = next(model.parameters()).device
    inputs = {key: value.to(model_device) for key, value in inputs.items()}

    with torch.inference_mode():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            do_sample=True,
            temperature=float(os.getenv("GENERATION_TEMPERATURE", "0.3")),
            top_p=float(os.getenv("GENERATION_TOP_P", "0.9")),
            repetition_penalty=float(os.getenv("GENERATION_REPETITION_PENALTY", "1.05")),
            pad_token_id=tokenizer.eos_token_id,
        )

    generated_ids = output_ids[0][inputs["input_ids"].shape[-1]:]
    text = tokenizer.decode(generated_ids, skip_special_tokens=True)
    return clean_generated_text(text)


def clean_generated_text(text):
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = text.replace("</think>", "")
    text = text.replace("<think>", "")
    text = text.replace("**", "")
    text = text.replace("！", "!")
    text = text.strip()

    lines = []

    for line in text.splitlines():
        line = line.strip()

        if not line:
            lines.append("")
            continue

        if line.startswith("Prompt:"):
            continue
        if line.startswith("Generation:"):
            continue
        if line.startswith("Peak memory:"):
            continue
        if line.startswith("Fetching "):
            continue
        if line.startswith("Download complete"):
            continue
        if line.startswith("Reconstruction complete"):
            continue
        if set(line) <= {"!", " "}:
            continue

        lines.append(line)

    text = "\n".join(lines).strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.replace("풀--", "푸세요")
    return repair_math_answer(text)


def repair_math_answer(text):
    text = text.replace("풀--", "푸세요")
    math_result = solve_limit_problem(text) or solve_linear_equation_problem(text)
    if math_result is None:
        return text

    answer, explanation = math_result
    answer_text = str(answer)

    if re.search(r"정답\s*[:：]", text):
        text = re.sub(
            r"정답\s*[:：]\s*([^\n]+)",
            f"정답: {answer_text}",
            text,
            count=1,
        )
    else:
        text = f"{text}\n정답: {answer_text}"

    if re.search(r"해설\s*[:：]", text):
        text = re.sub(
            r"해설\s*[:：]\s*[\s\S]*$",
            f"해설: {explanation}",
            text,
            count=1,
        )
    else:
        text = f"{text}\n해설: {explanation}"

    return text


def solve_limit_problem(text):
    if sp is None:
        return None

    compact = text.replace("−", "-").replace("→", "->")
    if "lim" not in compact.lower() and "한계" not in compact and "극한" not in compact and "x ->" not in compact:
        return None

    expr_match = re.search(
        r"(?:f\s*\(\s*x\s*\)\s*=\s*)?((?:\([^=\n]+?\)|[^\n]+?)\s*/\s*(?:\([^=\n]+?\)|[^\n]+?))(?=\n|,|$)",
        compact,
    )
    point_match = re.search(r"x\s*(?:->|→|to|→)\s*([-+]?\d+(?:\.\d+)?)", compact)

    if not expr_match or not point_match:
        return None

    raw_expr = expr_match.group(1).strip()
    raw_expr = raw_expr.replace("^", "**")
    raw_expr = re.sub(r"(?<=\d)(?=x)", "*", raw_expr)
    raw_expr = re.sub(r"\)\s*\(", ")*(", raw_expr)

    x = sp.symbols("x")
    try:
        expr = sp.sympify(raw_expr, locals={"x": x})
        point = sp.Rational(point_match.group(1))
        answer = sp.limit(expr, x, point)
    except Exception:
        return None

    if answer in (sp.oo, -sp.oo, sp.zoo, sp.nan):
        answer_text = str(answer)
    else:
        answer_text = sp.simplify(answer)

    simplified = sp.factor(expr)
    explanation = f"분자와 분모를 약분하거나 식을 정리하면 {sp.sstr(simplified)}이고, x={point}을 대입하면 {answer_text}입니다."
    return answer_text, explanation


def solve_linear_equation_problem(text):
    if sp is None:
        return None

    compact = text.replace("−", "-").replace("：", ":")
    equation_match = re.search(
        r"((?:[-+]?\s*\d*\.?\d*\s*\*?\s*x|x)\s*(?:[-+]\s*\d+\.?\d*)?\s*=\s*[-+]?\s*\d+\.?\d*)",
        compact,
    )
    if not equation_match:
        return None

    raw_equation = equation_match.group(1)
    left, right = raw_equation.split("=", 1)
    left = normalize_math_expr(left)
    right = normalize_math_expr(right)
    x = sp.symbols("x")

    try:
        solution = sp.solve(sp.Eq(sp.sympify(left, locals={"x": x}), sp.sympify(right, locals={"x": x})), x)
    except Exception:
        return None

    if len(solution) != 1:
        return None

    answer = sp.simplify(solution[0])
    answer_text = f"x = {sp.sstr(answer)}"
    explanation = build_linear_explanation(raw_equation, answer)
    return answer_text, explanation


def normalize_math_expr(expr):
    expr = expr.strip().replace("^", "**")
    expr = re.sub(r"(?<=\d)\s*x", "*x", expr)
    expr = re.sub(r"\s+", "", expr)
    return expr


def build_linear_explanation(raw_equation, answer):
    clean = re.sub(r"\s+", " ", raw_equation.strip())
    return f"{clean}을 x에 대해 풀면 x = {sp.sstr(answer)}입니다."


def validate_question(text, question_type):
    errors = []

    if not text.strip():
        errors.append("출력 없음")
        return errors

    if any(ch in text for ch in BAD_CHARS):
        errors.append("이상 문자 포함")

    if "<think>" in text or "</think>" in text:
        errors.append("think 태그 포함")

    if "문제:" not in text:
        errors.append("문제 없음")

    if "정답:" not in text:
        errors.append("정답 없음")

    if "해설:" not in text:
        errors.append("해설 없음")

    problem_match = re.search(r"문제:\s*(.+)", text)
    if not problem_match or len(problem_match.group(1).strip()) < 8:
        errors.append("문제 문장 부족")

    if len(text) > 1200:
        errors.append("출력 너무 김")

    if question_type == "객관식":
        if "보기:" not in text:
            errors.append("보기 없음")

        for n in range(1, 5):
            if not re.search(rf"(^|\n){n}\.\s*\S+", text):
                errors.append(f"보기 {n} 없음")

        if not re.search(r"정답:\s*[1-4]번", text):
            errors.append("정답 형식 오류")

    return errors


def generate_one(chunk, question_type, max_tokens, adapter_path, retries):
    prompt = build_prompt(chunk, question_type)

    best_text = ""
    best_errors = ["생성 전"]

    for _ in range(retries):
        text = run_model(prompt, max_tokens, adapter_path)
        errors = validate_question(text, question_type)

        if len(errors) < len(best_errors):
            best_text = text
            best_errors = errors

        if not errors:
            return text, []

    if best_text:
        return "[검토 필요] " + ", ".join(best_errors) + "\n\n" + best_text, best_errors

    return "[검토 필요] 모델이 문제를 생성하지 못했습니다.", ["출력 없음"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--question-type", default="객관식", choices=["객관식", "단답형", "서술형"])
    parser.add_argument("--total", type=int, default=3)
    parser.add_argument("--start-chunk", type=int, default=0)
    parser.add_argument("--max-tokens", type=int, default=500)
    parser.add_argument("--adapter-path", default=None)
    parser.add_argument("--out", required=True)
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()

    text = extract_pdf_text(args.pdf)
    chunks = split_chunks(text)

    if not chunks:
        raise SystemExit("PDF에서 텍스트를 읽지 못했습니다.")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"PDF: {args.pdf}")
    print(f"chunks: {len(chunks)}")
    print(f"question_type: {args.question_type}")
    print(f"total: {args.total}")
    print(f"adapter: {args.adapter_path or 'none'}")
    print(f"out: {args.out}")
    print("=" * 40)

    results = []

    for i in range(args.total):
        chunk_index = (args.start_chunk + i) % len(chunks)
        chunk = chunks[chunk_index]

        print(f"Generating {i + 1}/{args.total}... chunk {chunk_index}")

        question, errors = generate_one(
            chunk=chunk,
            question_type=args.question_type,
            max_tokens=args.max_tokens,
            adapter_path=args.adapter_path,
            retries=args.retries,
        )

        block = f"[문제 {i + 1}]\n출처 chunk: {chunk_index}\n\n{question}"
        results.append(block)

        print(block)
        print("-" * 40)

    out_path.write_text("\n\n".join(results), encoding="utf-8")
    print(f"saved: {args.out}")


if __name__ == "__main__":
    main()
