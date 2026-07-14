// Initialize Lucide Icons
document.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();
  initApp();
});

// App State Management
const STATE = {
  activeTab: "dashboard",
  incorrectCount: 1, // Start with 1 solved and 1 unsolved
  planProgress: 75,
  simulatedFinalScore: 88,
  quizResultCount: 0,
  uploadedFiles: [
    { name: "자료구조_5주차_연결리스트.pptx", size: "12.4 MB", slides: 24, date: "2026-07-12" },
    { name: "자료구조_6주차_스택큐.pptx", size: "8.7 MB", slides: 18, date: "2026-07-13" }
  ],
  incorrectList: [
    {
      id: "array-list",
      type: "용어 누락",
      subject: "자료구조",
      date: "2026-07-14",
      question: "배열과 연결 리스트의 구조적 차이점을 비교해 설명하시오.",
      userAnswer: "배열은 메모리 연속 공간을 차지하며 크기가 고정되어 데이터의 삽입/삭제 시 시간이 많이 걸립니다. 연결 리스트는 연속적이지 않고 노드들이 연결되어 O(1) 시간에 삽입 삭제가 됩니다.",
      feedback: "'동적 메모리 할당', '포인터' 개념 누락",
      score: 7,
      maxScore: 10,
      slide: 14,
      solved: false
    }
  ]
};

// Slide Content Mock Database for deep links
const SLIDE_DB = {
  14: {
    title: "연결 리스트의 구조 (Structure of Linked List)",
    subject: "자료구조 - 5주차. 연결 리스트 (Linked List)",
    bullets: [
      "<strong>노드 (Node)</strong> 중심의 메모리 구성 방식: data + pointer",
      "<strong>데이터 필드 (Data Field)</strong>: 실제 저장하고자 하는 데이터 값 (정수, 문자열 등)",
      "<strong>포인터 필드 (Pointer/Link Field)</strong>: 다음 노드의 메모리 주소를 가리키는 링크 필드",
      "<strong>동적 메모리 할당 (Dynamic Memory Allocation)</strong>:",
      "&nbsp;&nbsp;• 배열과 달리 실행 시간(Runtime)에 필요한 만큼 메모리를 malloc() 등으로 할당",
      "&nbsp;&nbsp;• 불연속적인 메모리 공간에 노드들을 분산 배치하고 링크로 연결"
    ]
  },
  15: {
    title: "단일 연결 리스트 노드 삽입 (Insertion)",
    subject: "자료구조 - 5주차. 연결 리스트 (Linked List)",
    bullets: [
      "연결 리스트의 특정 위치에 노드를 삽입할 때의 포인터 제어 단계:",
      "<strong>단계 1: 새 노드 생성</strong> 및 데이터 입력",
      "<strong>단계 2: 링크 연결 선행</strong>",
      "&nbsp;&nbsp;• 새 노드의 link 필드를 이전 노드가 가리키던 노드로 설정 (<code>new_node->link = prev_node->link;</code>)",
      "<strong>단계 3: 이전 노드 링크 갱신</strong>",
      "&nbsp;&nbsp;• 이전 노드의 link 필드가 새 노드를 가리키도록 설정 (<code>prev_node->link = new_node;</code>)",
      "<span class='text-danger'>★주의:</span> 순서가 바뀌면(3번 후 2번) 뒤쪽 노드들의 주소를 소실하여 메모리 누수 발생"
    ]
  },
  18: {
    title: "배열 vs 연결 리스트 비교 (Array vs Linked List)",
    subject: "자료구조 - 5주차. 연결 리스트 (Linked List)",
    bullets: [
      "<strong>메모리 할당 방식:</strong>",
      "&nbsp;&nbsp;• 배열: 컴파일 타임에 <strong>정적 연속 공간</strong> 할당",
      "&nbsp;&nbsp;• 연결 리스트: 런타임에 <strong>동적 분산 공간</strong> 할당",
      "<strong>삽입/삭제 시간복잡도:</strong>",
      "&nbsp;&nbsp;• 배열: 데이터 이동이 수반되므로 <strong>O(N)</strong>",
      "&nbsp;&nbsp;• 연결 리스트: 포인터 조작만 하므로 <strong>O(1)</strong> (단, 탐색 제외)",
      "<strong>임의 접근 (Random Access):</strong>",
      "&nbsp;&nbsp;• 배열: 인덱스를 통한 <strong>O(1)</strong> 직접 접근 가능",
      "&nbsp;&nbsp;• 연결 리스트: 순차 탐색이 필요하므로 <strong>O(N)</strong> 접근"
    ]
  }
};

function initApp() {
  initTabNavigation();
  initGradeSimulator();
  initPlanner();
  initFileParser();
  initQuizGrader();
  initIncorrectNotes();
  initModal();
  
  // Connect Quick Navigation Buttons on Dashboard
  document.getElementById("go-to-planner-btn").addEventListener("click", () => switchTab("planner"));
  document.getElementById("btn-quick-quiz").addEventListener("click", () => switchTab("quiz"));
  document.getElementById("btn-quick-sim").addEventListener("click", () => switchTab("simulator"));

  // Subject rows on dashboard trigger simulator selection
  document.querySelectorAll(".clickable-subject-row").forEach(row => {
    row.addEventListener("click", () => {
      const subject = row.getAttribute("data-subject");
      document.getElementById("sim-subject-select").value = subject;
      document.getElementById("sim-subject-select").dispatchEvent(new Event("change"));
      switchTab("simulator");
    });
  });

  // Render initial chart
  updateSimulation();
}

// 1. Tab Navigation
function initTabNavigation() {
  const menuItems = document.querySelectorAll(".menu-item");
  menuItems.forEach(item => {
    item.addEventListener("click", () => {
      const tabId = item.getAttribute("data-tab");
      switchTab(tabId);
    });
  });
}

function switchTab(tabId) {
  // Update Active Menu
  document.querySelectorAll(".menu-item").forEach(item => {
    if (item.getAttribute("data-tab") === tabId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // Update Active Tab Content
  document.querySelectorAll(".tab-pane").forEach(pane => {
    if (pane.id === tabId) {
      pane.classList.add("active");
    } else {
      pane.classList.remove("active");
    }
  });

  // Update Header Title
  const titles = {
    dashboard: "대시보드 요약",
    simulator: "성적 역산 및 시뮬레이터",
    planner: "맞춤형 학습 계획 생성",
    parser: "교안 업로드 및 AI 분석",
    quiz: "AI 실전 퀴즈 & 채점 피드백",
    incorrect: "오답 노트 & 오답 복습",
    architecture: "시스템 아키텍처 및 RAG 흐름"
  };
  document.getElementById("current-tab-title").innerText = titles[tabId] || "학점 수호자";
  STATE.activeTab = tabId;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 2. Grade Simulator Logic
function initGradeSimulator() {
  const inputs = [
    "midterm-score", "homework-score", "attendance-score",
    "midterm-ratio", "homework-ratio", "attendance-ratio",
    "total-students", "current-rank"
  ];
  
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", (e) => {
      if (id.endsWith("-score")) {
        document.getElementById(id + "-val").innerText = e.target.value + "점";
      }
      updateSimulation();
    });
  });

  // Subject change listener
  document.getElementById("sim-subject-select").addEventListener("change", (e) => {
    const val = e.target.value;
    // Set preset values
    if (val === "data-structure") {
      setSimulatorValues(75, 90, 100, 30, 20, 10, 50, 15, "A0");
    } else if (val === "algorithm") {
      setSimulatorValues(85, 95, 100, 30, 20, 10, 40, 6, "A+");
    } else if (val === "network") {
      setSimulatorValues(92, 100, 100, 40, 20, 10, 30, 3, "A+");
    }
    updateSimulation();
  });

  // Grade button toggles
  document.querySelectorAll(".btn-grade-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-grade-toggle").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      updateSimulation();
    });
  });
}

function setSimulatorValues(mid, hw, att, midR, hwR, attR, total, rank, targetGrade) {
  document.getElementById("midterm-score").value = mid;
  document.getElementById("midterm-score-val").innerText = mid + "점";
  document.getElementById("homework-score").value = hw;
  document.getElementById("homework-score-val").innerText = hw + "점";
  document.getElementById("attendance-score").value = att;
  document.getElementById("attendance-score-val").innerText = att + "점";
  
  document.getElementById("midterm-ratio").value = midR;
  document.getElementById("homework-ratio").value = hwR;
  document.getElementById("attendance-ratio").value = attR;
  
  document.getElementById("total-students").value = total;
  document.getElementById("current-rank").value = rank;
  
  document.querySelectorAll(".btn-grade-toggle").forEach(btn => {
    if (btn.getAttribute("data-grade") === targetGrade) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function updateSimulation() {
  const midterm = parseFloat(document.getElementById("midterm-score").value) || 0;
  const homework = parseFloat(document.getElementById("homework-score").value) || 0;
  const attendance = parseFloat(document.getElementById("attendance-score").value) || 0;
  
  const midRatio = parseFloat(document.getElementById("midterm-ratio").value) || 0;
  const hwRatio = parseFloat(document.getElementById("homework-ratio").value) || 0;
  const attRatio = parseFloat(document.getElementById("attendance-ratio").value) || 0;
  const finalRatio = 100 - (midRatio + hwRatio + attRatio);

  const totalStudents = parseInt(document.getElementById("total-students").value) || 30;
  const currentRank = parseInt(document.getElementById("current-rank").value) || 10;
  
  const targetGradeBtn = document.querySelector(".btn-grade-toggle.active");
  const targetGrade = targetGradeBtn ? targetGradeBtn.getAttribute("data-grade") : "A0";

  // Calculate current earned score (out of 100 max)
  const currentEarned = (midterm * midRatio/100) + (homework * hwRatio/100) + (attendance * attRatio/100);
  
  // Calculate relative grade cutoffs based on total students
  // A+: top 10%, A0: top 30%, B+: top 50%, B0: top 70%
  // Let's assume absolute score requirements simulating a bell curve
  let requiredTotalScore = 75; // default A0
  if (targetGrade === "A+") requiredTotalScore = 88;
  else if (targetGrade === "A0") requiredTotalScore = 76;
  else if (targetGrade === "B+") requiredTotalScore = 67;
  else if (targetGrade === "B0") requiredTotalScore = 58;

  // Let's adjust target score based on rank pressure
  // If rank is tight, student needs higher score
  const percentile = (currentRank / totalStudents) * 100;
  if (percentile > 40 && targetGrade === "A0") {
    // If student is currently >40%, they need very high final score to get A0 (top 30%)
    requiredTotalScore += (percentile - 30) * 0.15;
  }

  // Calculate what they need on the Final Exam
  const neededFinalEarned = requiredTotalScore - currentEarned;
  let finalScorePercentage = Math.round((neededFinalEarned / (finalRatio/100)));
  
  // Boundaries checks
  if (finalScorePercentage < 0) finalScorePercentage = 0;
  
  const outputScoreEl = document.getElementById("required-final-score");
  const outputDescEl = document.getElementById("required-final-desc");
  const bannerEl = document.getElementById("sim-status-banner");
  const bannerTextEl = document.getElementById("sim-status-text");

  outputDescEl.innerText = `기말고사 반영 비율: ${finalRatio}% 기준`;

  if (finalScorePercentage > 100) {
    outputScoreEl.innerText = "불가능";
    outputScoreEl.style.textShadow = "0 0 10px rgba(239, 68, 68, 0.5)";
    bannerEl.className = "sim-status-indicator danger";
    bannerTextEl.innerText = `현재 누적 점수가 낮아 기말고사 만점을 받아도 ${targetGrade} 달성이 불가능합니다. 목표 학점을 조정하세요.`;
  } else {
    outputScoreEl.innerText = finalScorePercentage + "점";
    outputScoreEl.style.textShadow = "0 0 10px var(--color-cyan-glow)";
    bannerEl.className = "sim-status-indicator success";
    bannerTextEl.innerText = `기말고사 ${finalScorePercentage}점 이상 취득 시 목표 학점 ${targetGrade} 달성 유력!`;
  }

  // Draw chart in Canvas
  drawSimulationChart(currentEarned, finalRatio, requiredTotalScore);
}

function drawSimulationChart(currentEarned, finalRatio, targetTotal) {
  const canvas = document.getElementById("sim-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  
  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw Background Grid Lines
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  
  // Horizontal grids
  for (let y = 20; y < canvas.height; y += 30) {
    ctx.beginPath();
    ctx.moveTo(30, y);
    ctx.lineTo(canvas.width - 20, y);
    ctx.stroke();
  }

  // Draw line: final exam score (0 to 100) vs total earned score
  ctx.beginPath();
  ctx.strokeStyle = "var(--color-purple)";
  ctx.lineWidth = 3;
  
  const points = [];
  for (let x_val = 0; x_val <= 100; x_val += 20) {
    const totalScore = currentEarned + (x_val * finalRatio/100);
    // map values to canvas dimensions
    // x_val (0..100) -> px (30 .. width-20)
    // totalScore (0..100) -> px (height-20 .. 10)
    const px_x = 30 + (x_val / 100) * (canvas.width - 50);
    const px_y = (canvas.height - 20) - (totalScore / 100) * (canvas.height - 30);
    points.push({ x: px_x, y: px_y, score: totalScore, finalVal: x_val });
    if (x_val === 0) ctx.moveTo(px_x, px_y);
    else ctx.lineTo(px_x, px_y);
  }
  ctx.stroke();

  // Draw target horizontal cutoff line
  const targetY = (canvas.height - 20) - (targetTotal / 100) * (canvas.height - 30);
  ctx.strokeStyle = "var(--color-cyan)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(30, targetY);
  ctx.lineTo(canvas.width - 20, targetY);
  ctx.stroke();
  ctx.setLineDash([]); // reset

  // Label for target line
  ctx.fillStyle = "var(--color-cyan)";
  ctx.font = "9px Outfit";
  ctx.fillText(`목표 커트라인 (${Math.round(targetTotal)}점)`, 35, targetY - 5);

  // Draw points & Tooltips
  points.forEach(pt => {
    ctx.fillStyle = pt.score >= targetTotal ? "var(--color-cyan)" : "var(--color-purple)";
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Label scores
    ctx.fillStyle = "var(--text-muted)";
    ctx.font = "8px Outfit";
    ctx.fillText(`${Math.round(pt.score)}`, pt.x - 6, pt.y - 8);
  });

  // Axes Labels
  ctx.fillStyle = "var(--text-dark)";
  ctx.font = "8px Outfit";
  ctx.fillText("기말 0", 10, canvas.height - 5);
  ctx.fillText("기말 100", canvas.width - 45, canvas.height - 5);
}

// 3. AI Planner Logic
function initPlanner() {
  document.getElementById("btn-generate-plan").addEventListener("click", () => {
    const hours = document.getElementById("plan-daily-hours").value;
    const includeIncorrect = document.getElementById("plan-include-incorrect").checked;
    generateStudyPlan(hours, includeIncorrect);
  });

  // Track task completions
  const container = document.getElementById("planner-schedule-output");
  container.addEventListener("change", (e) => {
    if (e.target.classList.contains("task-checkbox")) {
      updatePlanProgress();
    }
  });
}

function generateStudyPlan(hours, includeIncorrect) {
  const container = document.getElementById("planner-schedule-output");
  
  // Calculate remaining days
  const examDate = new Date(document.getElementById("plan-exam-date").value);
  const today = new Date("2026-07-14"); // fixed baseline date from presentation
  const diffTime = Math.abs(examDate - today);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  document.getElementById("days-left-counter").innerText = `기말고사까지 ${diffDays}일 남음`;

  let html = "";
  
  // We will generate a plan for up to 3 days to demonstrate adaptive planning
  const planTasks = [
    {
      day: 1,
      title: "Day 1 - 연결 리스트 핵심 구조 학습",
      tasks: [
        { text: "연결 리스트 핵심 개념 요약본 복습 (20분)", type: "concept" },
        { text: "동적 메모리 할당 및 해제 메커니즘 학습 (malloc, free)", type: "warning-badge", key: "동적" },
        { text: "연결 리스트 서술형 자율 평가 3문항", type: "quiz" }
      ]
    },
    {
      day: 2,
      title: "Day 2 - 스택 & 큐 동작 원리",
      tasks: [
        { text: "스택과 큐의 구조적 차이 및 ADT 정의 학습 (30분)", type: "concept" },
        { text: "스택 오버플로우 발생 조건 실전 서술형 연습", type: "concept" },
        { text: "스택/큐 기출 퀴즈 풀이 (5문항)", type: "quiz" }
      ]
    },
    {
      day: 3,
      title: "Day 3 - 취약점 진단 및 3차 복습",
      tasks: [
        { text: "연결 리스트 삽입/삭제 순서 재학습 (포인터 꼬임 방지)", type: "warning-badge" },
        { text: "스택/큐 연결 리스트 구현 코드 구현 분석", type: "concept" }
      ]
    }
  ];

  if (includeIncorrect && STATE.incorrectList.some(item => !item.solved)) {
    // Add incorrect answer review to Day 1
    planTasks[0].tasks.push({ text: "오답 노트 보관 문항 ('배열과 연결리스트 비교') 재작성 및 피드백 확인", type: "incorrect" });
  }

  // Slice days based on remaining time
  const daysToRender = Math.min(diffDays, 3);

  for (let i = 0; i < daysToRender; i++) {
    const dayData = planTasks[i];
    html += `
      <div class="schedule-day-box" id="day-box-${dayData.day}">
        <div class="day-header">
          <span class="day-title">${dayData.title}</span>
          <span class="day-duration"><i data-lucide="clock"></i> ${hours}시간</span>
        </div>
        <ul class="task-list">
    `;

    dayData.tasks.forEach(task => {
      html += `
        <li class="task-item">
          <label class="checkbox-container">
            <input type="checkbox" class="task-checkbox" data-day="${dayData.day}">
            <span class="checkmark"></span>
            <span class="task-text">${task.text}</span>
          </label>
          <span class="task-badge ${task.type}">${task.type === 'warning-badge' ? '취약개념' : (task.type === 'concept' ? '개념' : (task.type === 'quiz' ? '퀴즈' : '오답'))}</span>
        </li>
      `;
    });

    html += `
        </ul>
      </div>
    `;
  }

  container.innerHTML = html;
  lucide.createIcons();
  updatePlanProgress();
}

function updatePlanProgress() {
  const checkboxes = document.querySelectorAll(".task-checkbox");
  if (checkboxes.length === 0) return;
  
  let checked = 0;
  checkboxes.forEach(cb => {
    if (cb.checked) checked++;
  });

  const pct = Math.round((checked / checkboxes.length) * 100);
  STATE.planProgress = pct;

  // Update UI Elements
  document.getElementById("plan-pct-label").innerText = pct + "%";
  
  // Sync back to Dashboard
  document.getElementById("dashboard-progress-pct").innerText = pct + "%";
  document.getElementById("dashboard-progress-bar").style.width = pct + "%";
}

// 4. Lecture File Parser Logic
function initFileParser() {
  const dropZone = document.getElementById("parser-drop-zone");
  const fileInput = document.getElementById("parser-file-input");
  
  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleUploadedFile(files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleUploadedFile(e.target.files[0]);
    }
  });
}

function handleUploadedFile(file) {
  const progressBox = document.getElementById("parser-progress-box");
  const progressFill = document.getElementById("parser-progress-bar-fill");
  const statusLabel = document.getElementById("parser-progress-status");
  const pctLabel = document.getElementById("parser-progress-percent");
  
  progressBox.classList.remove("hidden");
  
  // Progress Stages Animation
  const steps = [
    { pct: 25, label: "OCR 판독: 텍스트 및 레이아웃 바운딩 박스 검출 중...", id: "step-ocr" },
    { pct: 50, label: "키워드 추출: TF-IDF 및 NLP 기반 주요 토큰 분류 중...", id: "step-terms" },
    { pct: 75, label: "인덱싱: 슬라이드 구조 매핑 및 Supabase 데이터 동기화 중...", id: "step-index" },
    { pct: 100, label: "벡터화: Chroma DB 임베딩 공간 적재 완료!", id: "step-vector" }
  ];

  let currentStep = 0;
  
  const interval = setInterval(() => {
    if (currentStep < steps.length) {
      const step = steps[currentStep];
      progressFill.style.width = step.pct + "%";
      pctLabel.innerText = step.pct + "%";
      statusLabel.innerText = step.label;
      
      // Highlight steps
      document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
      document.getElementById(step.id).classList.add("active");
      
      currentStep++;
    } else {
      clearInterval(interval);
      setTimeout(() => {
        progressBox.classList.add("hidden");
        addNewFileToList(file.name);
      }, 1000);
    }
  }, 1000);
}

function addNewFileToList(fileName) {
  const list = document.querySelector(".file-list");
  const item = document.createElement("li");
  item.className = "file-list-item";
  item.innerHTML = `
    <div class="file-item-left">
      <i data-lucide="file-code" class="file-ico text-purple"></i>
      <div class="file-meta">
        <strong>${fileName}</strong>
        <span>15.1 MB | 총 32 슬라이드 | 분석 완료 (오늘)</span>
      </div>
    </div>
    <span class="file-status-badge text-success"><i data-lucide="check"></i> Vector DB 인덱싱됨</span>
  `;
  list.appendChild(item);
  lucide.createIcons();
  
  // Update Parser outputs
  document.getElementById("parser-subject-title").innerText = fileName.replace(".pptx", "").replace(".pdf", "");
  
  // Notify user
  alert(`파일 '${fileName}'의 분석 및 Vector DB 적재가 완료되었습니다. 해당 교안의 개념들이 AI 퀴즈 데이터베이스와 연계되었습니다.`);
}

// 5. AI Quiz & Descriptive Grader
function initQuizGrader() {
  document.getElementById("btn-quiz-generate").addEventListener("click", () => {
    // Hide config, show active quiz box
    document.getElementById("quiz-setup-container").classList.add("hidden");
    document.getElementById("active-question-container").classList.remove("hidden");
    document.getElementById("feedback-placeholder-box").classList.remove("hidden");
    document.getElementById("active-report-container").classList.add("hidden");
    
    // Set Question text based on choice
    const scope = document.getElementById("quiz-scope-select").value;
    const qTextEl = document.getElementById("quiz-question-text");
    
    if (scope === "linked-list") {
      qTextEl.innerText = "배열(Array)과 연결 리스트(Linked List)의 구조적 차이점을 메모리 할당 방식과 삽입/삭제 연산의 관점에서 비교하여 서술하시오.";
    } else {
      qTextEl.innerText = "단일 연결 리스트(Singly Linked List)에서 노드를 중간에 삽입할 때 발생할 수 있는 포인터 단절 예방 조치와 3단계 삽입 알고리즘을 서술하시오.";
    }

    document.getElementById("user-answer-input").value = "";
  });

  document.getElementById("btn-quiz-reset").addEventListener("click", () => {
    document.getElementById("quiz-setup-container").classList.remove("hidden");
    document.getElementById("active-question-container").classList.add("hidden");
    document.getElementById("feedback-placeholder-box").classList.remove("hidden");
    document.getElementById("active-report-container").classList.add("hidden");
  });

  document.getElementById("btn-submit-answer").addEventListener("click", () => {
    const ans = document.getElementById("user-answer-input").value.trim();
    if (!ans) {
      alert("답안을 먼저 입력해주세요!");
      return;
    }
    
    // Show loading
    document.getElementById("feedback-placeholder-box").classList.add("hidden");
    document.getElementById("active-report-container").classList.add("hidden");
    document.getElementById("grading-loading-box").classList.remove("hidden");
    
    setTimeout(() => {
      document.getElementById("grading-loading-box").classList.add("hidden");
      document.getElementById("active-report-container").classList.remove("hidden");
      gradeSubjectiveAnswer(ans);
    }, 1500);
  });
}

function gradeSubjectiveAnswer(answer) {
  // Grading Engine - Keyword checks
  const keywords = {
    dynamic: ["동적", "dynamic", "malloc", "free", "할당"],
    pointers: ["포인터", "pointer", "노드", "node", "주소", "링크", "link"],
    continuous: ["연속", "정적", "연속적", "배열"],
    complexity: ["복잡도", "O(1)", "O(N)", "시간"]
  };

  let hasDynamic = keywords.dynamic.some(k => answer.includes(k));
  let hasPointers = keywords.pointers.some(k => answer.includes(k));
  let hasContinuous = keywords.continuous.some(k => answer.includes(k));
  let hasComplexity = keywords.complexity.some(k => answer.includes(k));

  let score = 5; // base score
  if (hasContinuous) score += 1.5;
  if (hasComplexity) score += 1.5;
  if (hasDynamic) score += 1;
  if (hasPointers) score += 1;

  score = Math.round(score);

  // Update Score Indicator
  const scoreEl = document.getElementById("report-score-out");
  scoreEl.innerText = score;
  
  const evalEl = document.getElementById("report-eval-title");
  if (score >= 9) {
    evalEl.innerText = "우수 (Excellent)";
    evalEl.className = "text-success";
  } else if (score >= 7) {
    evalEl.innerText = "보완 필요 (Needs Study)";
    evalEl.className = "text-orange";
  } else {
    evalEl.innerText = "미흡 (Failed)";
    evalEl.className = "text-danger";
  }

  // Update keyword checklists
  const kList = document.querySelector(".keyword-eval-list");
  kList.innerHTML = `
    <li class="keyword-eval-item ${hasContinuous ? 'match' : 'missing'}">
      <i data-lucide="${hasContinuous ? 'check-circle' : 'alert-triangle'}" class="${hasContinuous ? 'text-success' : 'text-danger'}"></i>
      <span>메모리 연속 공간 (배열) ${hasContinuous ? '' : '<strong class="red-badge">누락</strong>'}</span>
    </li>
    <li class="keyword-eval-item ${hasComplexity ? 'match' : 'missing'}">
      <i data-lucide="${hasComplexity ? 'check-circle' : 'alert-triangle'}" class="${hasComplexity ? 'text-success' : 'text-danger'}"></i>
      <span>삽입/삭제 시간복잡도 O(1) ${hasComplexity ? '' : '<strong class="red-badge">누락</strong>'}</span>
    </li>
    <li class="keyword-eval-item ${hasDynamic ? 'match' : 'missing'}">
      <i data-lucide="${hasDynamic ? 'check-circle' : 'alert-triangle'}" class="${hasDynamic ? 'text-success' : 'text-danger'}"></i>
      <span>동적 메모리 할당 (연결 리스트) ${hasDynamic ? '' : '<strong class="red-badge">누락</strong>'}</span>
    </li>
    <li class="keyword-eval-item ${hasPointers ? 'match' : 'missing'}">
      <i data-lucide="${hasPointers ? 'check-circle' : 'alert-triangle'}" class="${hasPointers ? 'text-success' : 'text-danger'}"></i>
      <span>노드와 포인터 개념 ${hasPointers ? '' : '<strong class="red-badge">누락</strong>'}</span>
    </li>
  `;

  // Update descriptive total comments
  let weaknessHTML = "";
  if (!hasDynamic || !hasPointers) {
    weaknessHTML = `<strong>아쉬운 부분 / 감점 사유:</strong> `;
    if (!hasDynamic) weaknessHTML += `연결 리스트가 <strong>동적 메모리 할당(malloc/free)</strong>을 기반으로 메모리 연속성에 영향 없이 배치된다는 핵심 동작 원리가 누락되었습니다. `;
    if (!hasPointers) weaknessHTML += `각 노드가 다음 항목을 지목하기 위해 <strong>노드(Node)</strong> 구조 속의 <strong>포인터/링크 필드</strong>를 활용한다는 개념을 기재하지 않아 감점되었습니다.`;
  } else {
    weaknessHTML = `<strong>피드백:</strong> 교안의 핵심 키워드를 모두 기재하여 구조적 원리를 아주 훌륭히 설명하셨습니다. 완벽합니다!`;
  }
  document.getElementById("ai-report-weakness").innerHTML = weaknessHTML;
  lucide.createIcons();

  // If score < 10, add to incorrect notes!
  if (score < 10) {
    addIncorrectNote(answer, score);
  }
}

// 6. Incorrect Answer Notes Manager
function initIncorrectNotes() {
  document.getElementById("incorrect-list-output").addEventListener("click", (e) => {
    if (e.target.classList.contains("btn-retry-quiz") && !e.target.disabled) {
      // Switch to quiz tab and set array-list quiz
      switchTab("quiz");
      document.getElementById("quiz-setup-container").classList.add("hidden");
      document.getElementById("active-question-container").classList.remove("hidden");
      document.getElementById("feedback-placeholder-box").classList.remove("hidden");
      document.getElementById("active-report-container").classList.add("hidden");
      
      document.getElementById("quiz-scope-select").value = "linked-list";
      document.getElementById("quiz-question-text").innerText = "배열(Array)과 연결 리스트(Linked List)의 구조적 차이점을 메모리 할당 방식과 삽입/삭제 연산의 관점에서 비교하여 서술하시오.";
      document.getElementById("user-answer-input").value = "";
    }
    
    if (e.target.classList.contains("btn-view-slide")) {
      const slide = e.target.getAttribute("data-slide");
      openSlideModal(slide);
    }
  });

  // Initial Sync of Incorrect count
  updateIncorrectBadges();
}

function addIncorrectNote(ans, score) {
  // Check if already exists in list. If so, update user answer
  const existing = STATE.incorrectList.find(i => i.id === "array-list");
  if (existing) {
    existing.userAnswer = ans;
    existing.score = score;
    existing.solved = false;
  } else {
    STATE.incorrectList.push({
      id: "array-list",
      type: "용어 누락",
      subject: "자료구조",
      date: "2026-07-14",
      question: "배열과 연결 리스트의 구조적 차이점을 비교해 설명하시오.",
      userAnswer: ans,
      feedback: "'동적 메모리 할당', '포인터' 개념 누락",
      score: score,
      maxScore: 10,
      slide: 14,
      solved: false
    });
  }
  
  // Re-render
  renderIncorrectList();
}

function renderIncorrectList() {
  const container = document.getElementById("incorrect-list-output");
  let html = "";
  
  let unsolvedCount = 0;
  
  STATE.incorrectList.forEach(item => {
    if (!item.solved) unsolvedCount++;
    
    html += `
      <div class="incorrect-item-card glass" id="incorrect-item-${item.id}">
        <div class="item-header-meta">
          <span class="tag ${item.solved ? 'tag-success' : 'tag-danger'}">${item.solved ? '해결 완료' : item.type}</span>
          <span class="meta-sub">과목: ${item.subject} | 오답 등록일: ${item.date}</span>
        </div>
        <div class="item-question-box">
          <strong>문제:</strong> ${item.question}
        </div>
        <div class="item-user-ans">
          <strong>내 제출 답안:</strong> ${item.userAnswer}
        </div>
        <div class="item-feedback-summary ${item.solved ? 'text-success' : 'text-danger'}">
          <strong>AI 분석 감점요인:</strong> ${item.solved ? '해결 완료! 핵심 키워드가 바르게 포함되었습니다.' : item.feedback} (획득 점수: ${item.score}점 / ${item.maxScore}점)
        </div>
        <div class="item-actions">
          ${item.solved 
            ? `<button class="btn btn-success" disabled>오답 해결 완료</button>`
            : `<button class="btn btn-outline-danger btn-retry-quiz" data-q-type="${item.id}" id="btn-retry-${item.id}">오답 재풀이</button>`
          }
          <button class="btn btn-outline btn-view-slide" data-slide="${item.slide}">원본 슬라이드 보기 (Slide ${item.slide})</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  STATE.incorrectCount = unsolvedCount;
  updateIncorrectBadges();
}

function updateIncorrectBadges() {
  const count = STATE.incorrectCount;
  
  // Sidebar Badge
  const badge = document.getElementById("incorrect-badge");
  badge.innerText = count;
  if (count === 0) badge.classList.add("hidden");
  else badge.classList.remove("hidden");
  
  // Card header counts
  const headerCount = document.getElementById("incorrect-card-count");
  if (headerCount) headerCount.innerText = `총 ${count}문항 수록`;
  
  // Dashboard count
  const dashCount = document.getElementById("dashboard-incorrect-count");
  if (dashCount) dashCount.innerText = `${count}개`;
}

// 7. PowerPoint Slide Deep Link Modal
function initModal() {
  const modal = document.getElementById("slide-viewer-modal");
  const closeBtn = document.getElementById("close-modal-btn");
  const confirmBtn = document.getElementById("modal-confirm-btn");

  closeBtn.addEventListener("click", () => closeModal());
  confirmBtn.addEventListener("click", () => {
    closeModal();
    // Special action: if user closes slide 14, let's suggest updating retry answer!
    // But no forced action, just closure is fine.
  });

  // Clicking outside card closes modal
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // Connect deep link clicks on quiz report tab
  const reportTab = document.getElementById("quiz");
  reportTab.addEventListener("click", (e) => {
    const dlBtn = e.target.closest(".deeplink-btn");
    if (dlBtn) {
      const slide = dlBtn.getAttribute("data-slide");
      openSlideModal(slide);
    }
  });
}

function openSlideModal(slideNum) {
  const slide = SLIDE_DB[slideNum];
  if (!slide) return;

  document.getElementById("modal-slide-num").innerText = `Slide ${slideNum}`;
  
  let bulletsHTML = `<h2 class="slide-title">${slide.title}</h2><hr class="slide-divider"><ul class="slide-bullets">`;
  slide.bullets.forEach(b => {
    bulletsHTML += `<li>${b}</li>`;
  });
  bulletsHTML += `</ul>`;
  
  document.getElementById("modal-slide-content").innerHTML = bulletsHTML;
  document.getElementById("slide-viewer-modal").classList.add("active");
  document.getElementById("slide-viewer-modal").classList.remove("hidden");
  
  // If user reviews Slide 14, let's mark it in state as reviewed.
  if (slideNum === "14") {
    // Simulate user writing better answer next time they retry
    setTimeout(() => {
      // Pre-fill quiz with corrected answer when they go back
      document.getElementById("user-answer-input").value = "배열은 컴파일타임에 크기가 고정되는 연속적인 메모리 할당 방식을 사용하며 삽입/삭제 시 이동 연산이 동반되어 O(N) 시간이 소요됩니다. 반면 연결 리스트는 런타임에 동적 메모리 할당(malloc/free) 방식을 사용하여 메모리 임의 공간에 배치된 노드(Node)들의 포인터(Pointer) 주소 연결을 조작하므로 삽입/삭제 연산이 O(1) 시간복잡도로 가능합니다.";
    }, 100);
  }
}

function closeModal() {
  document.getElementById("slide-viewer-modal").classList.remove("active");
  setTimeout(() => {
    document.getElementById("slide-viewer-modal").classList.add("hidden");
  }, 200);
}

// Special simulator solver to run after grading incorrect answer is solved
// We will trigger a mock completion if the user submits the exact corrected answer!
const originalSubmitHandler = document.getElementById("btn-submit-answer").onclick;

document.getElementById("btn-submit-answer").addEventListener("click", () => {
  const ans = document.getElementById("user-answer-input").value;
  // If user corrected answer has malloc/free and node pointers keywords:
  if (ans.includes("동적") && ans.includes("포인터") && STATE.activeTab === "quiz") {
    // Solve the incorrect note!
    setTimeout(() => {
      const item = STATE.incorrectList.find(i => i.id === "array-list");
      if (item) {
        item.solved = true;
        item.score = 10;
        renderIncorrectList();
        
        // Also update dashboard AI recommendations!
        const recBox = document.querySelector(".speech-content .recommendation");
        if (recBox) {
          recBox.className = "recommendation success-rec";
          recBox.style.borderLeftColor = "var(--color-green)";
          recBox.style.color = "#a7f3d0";
          recBox.innerHTML = `<strong>해결 완료:</strong> 연결 리스트 취약점 보완 완료! 기말고사 대비 학습 플랜에 따라 다른 단원을 준비하세요.`;
        }
      }
    }, 1800); // execute after grading delay finishes
  }
});
