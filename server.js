const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
const publicHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const backendUrl = new URL(process.env.BACKEND_URL || "http://127.0.0.1:8000");

loadLocalEnv();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${publicHost}:${port}`);

  if (
    ["/generate", "/vectorize-material", "/vectorize-text", "/vectorize-upload", "/search-material", "/grade-projection"].includes(url.pathname) &&
    request.method === "POST"
  ) {
    proxyToModelServer(request, response);
    return;
  }

  if (url.pathname === "/summarize-material" && request.method === "POST") {
    summarizeWithGemini(request, response);
    return;
  }

  if (url.pathname === "/grade-answer" && request.method === "POST") {
    gradeAnswerWithGemini(request, response);
    return;
  }

  if (url.pathname === "/client-config" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
        supabaseAnonKey:
          process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""
      })
    );
    return;
  }

  const requestPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.join(root, requestPath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    const ext = path.extname(filePath);
    const headers = {
      "content-type": contentTypes[ext] || "application/octet-stream"
    };

    if ([".html", ".js", ".css"].includes(ext)) {
      headers["cache-control"] = "no-store, max-age=0";
    }

    response.writeHead(200, headers);
    response.end(content);
  });
});

server.listen(port, host, () => {
  console.log(`학점수호자 웹사이트: http://${publicHost}:${port}`);
  console.log(`백엔드 API: ${backendUrl.origin}`);
});

function proxyToModelServer(clientRequest, clientResponse) {
  const targetUrl = new URL(
    new URL(clientRequest.url, `http://${publicHost}:${port}`).pathname,
    backendUrl
  );
  const transport = targetUrl.protocol === "https:" ? https : http;
  const headers = { ...clientRequest.headers, host: targetUrl.host };
  delete headers["content-length"];

  const proxyRequest = transport.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: "POST",
      headers
    },
    (proxyResponse) => {
      const chunks = [];
      proxyResponse.on("data", (chunk) => chunks.push(chunk));
      proxyResponse.on("end", () => {
        const raw = Buffer.concat(chunks);
        const headers = { ...proxyResponse.headers };
        delete headers["content-length"];

        if (!raw.length) {
          clientResponse.writeHead(proxyResponse.statusCode && proxyResponse.statusCode >= 400 ? proxyResponse.statusCode : 502, {
            "content-type": "application/json; charset=utf-8"
          });
          clientResponse.end(
            JSON.stringify({
              ok: false,
              error: `${targetUrl.pathname} 서버 응답이 비어 있습니다. 8000 백엔드와 터널 주소를 다시 확인하세요.`
            })
          );
          return;
        }

        clientResponse.writeHead(proxyResponse.statusCode || 500, headers);
        clientResponse.end(raw);
      });
    }
  );

  proxyRequest.setTimeout(120000, () => {
    proxyRequest.destroy(new Error("백엔드 서버 응답 시간이 너무 깁니다."));
  });

  proxyRequest.on("error", (error) => {
    if (clientResponse.writableEnded) return;
    clientResponse.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    clientResponse.end(
      JSON.stringify({
        ok: false,
        error: `${backendUrl.origin} 백엔드 서버에 연결할 수 없습니다. ${error.message}`
      })
    );
  });

  clientRequest.pipe(proxyRequest);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 30 * 1024 * 1024) {
        reject(new Error("요청 파일이 너무 큽니다."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("JSON 요청을 읽을 수 없습니다."));
      }
    });
    request.on("error", reject);
  });
}

async function summarizeWithGemini(request, response) {
  try {
    const body = await readJsonBody(request);
    const apiKey = process.env.GEMINI_API_KEY || body.apiKey || request.headers["x-gemini-api-key"];

    if (!apiKey) {
      response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "서버에 GEMINI_API_KEY가 설정되어 있지 않습니다." }));
      return;
    }

    if (!body.base64 || !body.mimeType) {
      response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "교안 파일이 필요합니다." }));
      return;
    }

    const prompt = [
      "다음 교안을 한국어로 요점정리해줘.",
      "시험 대비용으로 핵심 개념, 중요 용어, 출제 가능 포인트, 짧은 복습 질문을 구분해서 정리해줘.",
      "원문에서 페이지나 슬라이드 번호를 확인할 수 있으면 각 개념 앞에 [p.번호] 또는 [slide 번호]를 유지해줘.",
      body.instruction ? `추가 요청: ${body.instruction}` : "",
      body.courseName ? `과목명: ${body.courseName}` : "",
      body.fileName ? `파일명: ${body.fileName}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: body.mimeType,
                data: body.base64
              }
            }
          ]
        }
      ]
    };
    const modelNames = await getGeminiModelCandidates(apiKey);
    const { geminiResponse, data, modelName } = await callGeminiWithFallback(
      apiKey,
      modelNames,
      requestBody
    );
    const text =
      data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";

    response.writeHead(geminiResponse.ok ? 200 : 502, {
      "content-type": "application/json; charset=utf-8"
    });
    response.end(
      JSON.stringify({
        ok: geminiResponse.ok,
        model: modelName,
        summary: text,
        error: geminiResponse.ok ? null : data.error?.message || "Gemini 요약에 실패했습니다."
      })
    );
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: error.message }));
  }
}

async function gradeAnswerWithGemini(request, response) {
  try {
    const body = await readJsonBody(request);
    const apiKey = process.env.GEMINI_API_KEY || request.headers["x-gemini-api-key"];

    if (!apiKey) {
      response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "서버에 GEMINI_API_KEY가 설정되어 있지 않습니다." }));
      return;
    }

    if (!body.question || (!body.studentAnswer && !body.studentAnswerImage?.base64)) {
      response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "문제와 학생 답안 텍스트 또는 이미지가 필요합니다." }));
      return;
    }

    const prompt = [
      "너는 대학 주관식 답안 채점자다. 아래 문제와 기준을 보고 학생 답안을 공정하게 채점해라.",
      "학생 답안 이미지가 함께 제공되면 이미지 속 손글씨나 텍스트를 먼저 읽고 채점해라.",
      "반드시 JSON만 출력해라. 마크다운 코드블록을 쓰지 마라.",
      "JSON 스키마: {\"score\": number, \"grade\": string, \"recognized_answer\": string, \"strengths\": string[], \"missing_keywords\": string[], \"feedback\": string, \"revised_answer\": string}",
      "score는 0~100점이다. feedback은 한국어 2~4문장으로 구체적으로 작성한다.",
      "",
      `문제: ${body.question}`,
      `모범답안: ${body.modelAnswer || "-"}`,
      `채점 기준: ${body.rubric || "-"}`,
      `필수 키워드: ${Array.isArray(body.keywords) ? body.keywords.join(", ") : body.keywords || "-"}`,
      `학생 답안 텍스트: ${body.studentAnswer || "(이미지로 제출됨)"}`
    ].join("\n");

    const parts = [{ text: prompt }];
    if (body.studentAnswerImage?.base64 && body.studentAnswerImage?.mimeType) {
      parts.push({
        inlineData: {
          mimeType: body.studentAnswerImage.mimeType,
          data: body.studentAnswerImage.base64
        }
      });
    }

    const requestBody = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    };
    const modelNames = await getGeminiModelCandidates(apiKey);
    const { geminiResponse, data, modelName } = await callGeminiWithFallback(
      apiKey,
      modelNames,
      requestBody
    );
    const raw =
      data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";

    response.writeHead(geminiResponse.ok ? 200 : 502, {
      "content-type": "application/json; charset=utf-8"
    });
    response.end(
      JSON.stringify({
        ok: geminiResponse.ok,
        model: modelName,
        grading: geminiResponse.ok ? parseGeminiJson(raw) : null,
        raw,
        error: geminiResponse.ok ? null : data.error?.message || "Gemini 채점에 실패했습니다."
      })
    );
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: error.message }));
  }
}

function parseGeminiJson(text) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      score: null,
      grade: "검토 필요",
      strengths: [],
      missing_keywords: [],
      feedback: cleaned || "채점 결과를 JSON으로 해석하지 못했습니다.",
      revised_answer: ""
    };
  }
}

async function getGeminiModelCandidates(apiKey) {
  const fallback = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models : [];
    const generated = models
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map((model) => model.name?.replace(/^models\//, ""))
      .filter(Boolean);
    const flash = generated.filter((name) => name.includes("flash"));
    const ordered = [...flash, ...generated, ...fallback];
    return [...new Set(ordered)];
  } catch {
    return fallback;
  }
}

async function callGeminiWithFallback(apiKey, modelNames, requestBody) {
  let last = null;

  for (const modelName of modelNames) {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody)
      }
    );
    const data = await geminiResponse.json();
    last = { geminiResponse, data, modelName };

    if (geminiResponse.ok) return last;
  }

  return last;
}

function loadLocalEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
