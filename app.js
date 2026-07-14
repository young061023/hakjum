const settingsKey = "hakjum-generator-settings";
const plannerKey = "hakjum-planner-state";
const pendingGenerationKey = "hakjum-pending-generation";
const materialDbName = "hakjum-material-files";
const materialStoreName = "files";

let latestPayload = null;
let supabaseClient = null;
let currentUser = null;
let calendarDate = new Date();
let timerId = null;
let timerStartedAt = 0;
let timerElapsed = 0;
const courseFiles = new Map();

const state = loadPlannerState();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const form = $("#generatorForm");
const materialFile = $("#materialFile");
const questionType = $("#questionType");
const questionCount = $("#questionCount");
const difficulty = $("#difficulty");
const courseName = $("#courseName");
const instruction = $("#instruction");
const apiBaseUrl = $("#apiBaseUrl");
const apiLabel = $("#apiLabel");
const supabaseUrl = $("#supabaseUrl");
const supabaseAnonKey = $("#supabaseAnonKey");
const saveSettings = $("#saveSettings");
const submitButton = $("#submitButton");
const statusText = $("#statusText");
const connectionBadge = $("#connectionBadge");
const results = $("#results");
const resultMeta = $("#resultMeta");
const copyJson = $("#copyJson");
const loadHistory = $("#loadHistory");
const history = $("#history");
const courseTabs = $("#courseTabs");
const courseEditorName = $("#courseEditorName");
const courseExamDate = $("#courseExamDate");
const courseCurrentScore = $("#courseCurrentScore");
const courseTargetScore = $("#courseTargetScore");
const courseWeeklyHours = $("#courseWeeklyHours");
const coursePlanPreview = $("#coursePlanPreview");
const materialTitle = $("#materialTitle");
const courseMaterialFile = $("#courseMaterialFile");
const materialList = $("#materialList");
const summaryInstruction = $("#summaryInstruction");
const summaryStatus = $("#summaryStatus");
const courseSummary = $("#courseSummary");
const courseSummaryMeta = $("#courseSummaryMeta");

const endpointCandidates = ["/generate"];
let renderedQuestions = [];

function loadPlannerState() {
  const fallback = {
    currentGpa: 3.48,
    targetGpa: 4.0,
    attendance: 92,
    streak: 14,
    studySeconds: 0,
    activeCourseId: "course-default",
    courses: [
      {
        id: "course-default",
        name: "인간과 환경의 이해",
        examDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 21).toISOString().slice(0, 10),
        currentScore: 68,
        targetScore: 90,
        weeklyHours: 6,
        activeMaterialId: "",
        materials: [],
        wrongNotes: []
      }
    ],
    tasks: [
      {
        id: crypto.randomUUID(),
        title: "중간고사 정리",
        course: "인간과 환경의 이해",
        type: "시험",
        date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString().slice(0, 10),
        progress: 35,
        done: false
      },
      {
        id: crypto.randomUUID(),
        title: "자기개념 요약 과제",
        course: "교양심리",
        type: "과제",
        date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 6).toISOString().slice(0, 10),
        progress: 70,
        done: false
      }
    ]
  };

  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(plannerKey) || "{}") };
  } catch {
    return fallback;
  }
}

function savePlannerState() {
  ensureAutoStudyPlan();
  localStorage.setItem(plannerKey, JSON.stringify(state));
  savePlannerStateToSupabase();
}

function syncCourseExamTask(course) {
  if (!course?.id) return;
  const taskId = `exam-${course.id}`;
  state.tasks = state.tasks.filter((task) => task.id !== taskId);

  if (!course.examDate) return;

  state.tasks.push({
    id: taskId,
    title: `${course.name || "과목"} 시험`,
    course: course.name || "과목 없음",
    type: "시험",
    date: course.examDate,
    progress: 0,
    done: false,
    courseExam: true
  });
}

async function savePlannerStateToSupabase() {
  if (!supabaseClient || !currentUser) return;
  await supabaseClient.from("planner_states").upsert({
    user_id: currentUser.id,
    state,
    updated_at: new Date().toISOString()
  });
}

function switchView(viewId) {
  $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
}

async function loadSettings() {
  const saved = JSON.parse(localStorage.getItem(settingsKey) || "{}");
  try {
    const response = await fetch("/client-config");
    const config = await response.json();
    if (config.supabaseUrl) saved.supabaseUrl = config.supabaseUrl;
    if (config.supabaseAnonKey) saved.supabaseAnonKey = config.supabaseAnonKey;
  } catch {
    // Local file use or older server: fall back to saved browser settings.
  }

  if (saved.apiBaseUrl && apiBaseUrl) apiBaseUrl.value = saved.apiBaseUrl;
  if (saved.supabaseUrl && supabaseUrl) supabaseUrl.value = saved.supabaseUrl;
  if (saved.supabaseAnonKey && supabaseAnonKey) supabaseAnonKey.value = saved.supabaseAnonKey;
  localStorage.setItem(settingsKey, JSON.stringify(saved));
  if (apiLabel) apiLabel.textContent = getDisplayApiLabel();
  await initSupabase();
}

function persistSettings() {
  const saved = JSON.parse(localStorage.getItem(settingsKey) || "{}");
  localStorage.setItem(
    settingsKey,
    JSON.stringify({
      apiBaseUrl: apiBaseUrl?.value.trim() || saved.apiBaseUrl || "",
      supabaseUrl: supabaseUrl?.value.trim() || saved.supabaseUrl || "",
      supabaseAnonKey: supabaseAnonKey?.value.trim() || saved.supabaseAnonKey || ""
    })
  );
  if (apiLabel) apiLabel.textContent = getDisplayApiLabel();
  initSupabase();
  setStatus("설정을 저장했습니다.", "ok");
}

async function initSupabase() {
  const saved = JSON.parse(localStorage.getItem(settingsKey) || "{}");
  const url = supabaseUrl?.value.trim() || saved.supabaseUrl || "";
  const key = supabaseAnonKey?.value.trim() || saved.supabaseAnonKey || "";
  if (!url || !key || !window.supabase) {
    supabaseClient = null;
    currentUser = null;
    updateAuthUi();
    return;
  }
  supabaseClient = window.supabase.createClient(url, key);
  const { data } = await supabaseClient.auth.getUser();
  currentUser = data.user || null;
  updateAuthUi();
  await loadPlannerStateFromSupabase();
}

async function loadPlannerStateFromSupabase() {
  if (!supabaseClient || !currentUser) return;
  const { data, error } = await supabaseClient
    .from("planner_states")
    .select("state")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (!error && data?.state) {
    Object.assign(state, data.state);
    localStorage.setItem(plannerKey, JSON.stringify(state));
    renderAll();
  }
}

function updateAuthUi() {
  const label = $("#authStateLabel");
  const status = $("#authStatus");
  if (label) label.textContent = currentUser ? "로그인됨" : "로그아웃";
  if (status) {
    status.textContent = currentUser
      ? `${currentUser.email} 계정으로 로그인했습니다.`
      : supabaseClient
        ? "이메일과 비밀번호로 로그인하거나 가입하세요."
        : "Supabase URL과 anon key가 서버에 설정되어 있지 않습니다.";
    status.className = `status ${currentUser ? "ok" : ""}`.trim();
  }
}

function setStatus(message, stateName = "") {
  if (!statusText) return;
  statusText.textContent = message;
  statusText.className = `status ${stateName}`.trim();
}

function setBadge(message, stateName = "muted") {
  if (!connectionBadge) return;
  connectionBadge.textContent = message;
  connectionBadge.className = `badge ${stateName}`.trim();
}

function renderAll() {
  ensureAutoStudyPlan();
  if ($("#dashboardView")) renderDashboard();
  if (courseTabs) renderCourses();
  if ($("#wrongNoteList")) renderWrongNotes();
  if ($("#taskList")) renderTasks();
  if ($("#calendarGrid")) renderCalendar();
  if ($("#doneRate")) renderAnalysis();
  if ($("#gradeProjectionForm")) renderGradeProjectionForm();
  if ($("#timerDisplay")) renderTimer();
}

function migrateCourseGoalFields(course) {
  if (!course.examDate) {
    const inferredExam = state.tasks
      ?.filter((task) => task.type === "시험" && task.course === course.name && task.date >= todayText())
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    course.examDate = inferredExam?.date || "";
  }
  course.currentScore = Number.isFinite(Number(course.currentScore)) ? Number(course.currentScore) : 70;
  course.targetScore = Number.isFinite(Number(course.targetScore)) ? Number(course.targetScore) : 90;
  course.weeklyHours = Number.isFinite(Number(course.weeklyHours)) ? Number(course.weeklyHours) : 6;
}

function getCoursePlanInput(course) {
  migrateCourseGoalFields(course);
  const projection = course.gradeProjection || null;
  const today = new Date(`${todayText()}T00:00:00`);
  const exam = course.examDate ? new Date(`${course.examDate}T00:00:00`) : null;
  const daysLeft = exam ? Math.ceil((exam - today) / (1000 * 60 * 60 * 24)) : null;
  const currentScore = projection ? Number(projection.secured_score) : Number(course.currentScore);
  const targetScore = projection ? Number(projection.target_total) : Number(course.targetScore);
  const requiredFinal = projection ? Number(projection.required_final_score) : null;
  const possibility = projection?.possibility || "";
  const possibilityScore = Number(projection?.possibility_score);
  const scoreGap = Math.max(0, targetScore - currentScore);
  const materialCount = Array.isArray(course.materials) ? course.materials.length : 0;
  const urgency = daysLeft === null ? 0 : Math.max(0, 30 - Math.min(daysLeft, 30));
  const finalPressure = Number.isFinite(requiredFinal) ? Math.max(0, requiredFinal - 70) : 0;
  const riskPressure = possibility === "낮음" ? 26 : possibility === "도전" ? 16 : possibility === "가능" ? 8 : 0;
  const load = Math.min(100, Math.round(scoreGap * 1.6 + urgency * 1.7 + materialCount * 6 + finalPressure * 1.2 + riskPressure));
  const baseMinutes = (Number(course.weeklyHours) || 6) * 60 / 7;
  const projectionMinutes = Number.isFinite(requiredFinal) ? Math.max(0, requiredFinal - 65) * 2.4 : 0;

  return {
    daysLeft,
    scoreGap,
    materialCount,
    currentScore,
    targetScore,
    requiredFinal,
    possibility,
    possibilityScore: Number.isFinite(possibilityScore) ? possibilityScore : null,
    load,
    dailyMinutes: Math.max(25, Math.min(160, Math.round(baseMinutes + scoreGap * 1.4 + projectionMinutes)))
  };
}

function buildMaterialStudyChunks(material) {
  if (!material?.summary) return [];
  const summary = String(material.summary)
    .replace(/\r/g, "\n")
    .split(/\n{2,}|(?=#+\s)|(?=\d+\.\s)|(?=\*\*[^*]+\*\*)/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 18);

  return summary.slice(0, 12).map((text, index) => {
    const concept = inferConceptTitle(text) || `${index + 1}번째 개념`;
    return {
      index,
      concept,
      text: text.slice(0, 160),
      materialTitle: material.title || material.fileName || "교안"
    };
  });
}

function getCourseStudyChunks(course) {
  const materials = Array.isArray(course.materials) ? course.materials : [];
  return materials.flatMap((material) =>
    buildMaterialStudyChunks(material).map((chunk) => ({
      ...chunk,
      materialId: material.id
    }))
  );
}

function buildAutoTasksForCourse(course) {
  const plan = getCoursePlanInput(course);
  if (!course.examDate || plan.daysLeft === null || plan.daysLeft < 0) return [];

  const today = new Date(`${todayText()}T00:00:00`);
  const span = Math.max(1, Math.min(plan.daysLeft, 10));
  const taskCount = Math.max(2, Math.min(6, Math.ceil(plan.load / 22)));
  const materials = Array.isArray(course.materials) ? course.materials : [];
  const studyChunks = getCourseStudyChunks(course);
  const tasks = [];

  for (let index = 0; index < taskCount; index += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + Math.min(span, Math.round((span / taskCount) * index)));
    const material = materials[index % Math.max(1, materials.length)];
    const chunk = studyChunks[index % Math.max(1, studyChunks.length)];
    const title = index === taskCount - 1 || plan.daysLeft <= 3
      ? `${course.name} 시험 직전 점검`
      : chunk
        ? `${course.name} · ${chunk.concept}`
        : material
          ? `${course.name} · ${material.title || material.fileName} 복습`
        : `${course.name} 핵심 개념 복습`;
    const projectionReason = Number.isFinite(plan.requiredFinal)
      ? `필요 기말 ${Math.round(plan.requiredFinal)}점 · 가능성 ${plan.possibility || "-"}`
      : `목표 ${plan.targetScore}점까지 ${plan.scoreGap}점`;

    tasks.push({
      id: `auto-${course.id}-${index}`,
      autoPlan: true,
      title,
      course: course.name,
      type: index === taskCount - 1 ? "시험 대비" : "공부",
      date: toDateText(date),
      progress: Math.max(10, Math.min(85, Math.round(100 - plan.load + index * 8))),
      done: false,
      minutes: plan.dailyMinutes,
      reason: `${projectionReason} · D-${plan.daysLeft}`,
      studyGoal: chunk
        ? `${chunk.materialTitle} 청크 ${chunk.index + 1}: ${chunk.text}`
        : "오늘의 학습 목표: 핵심 개념 정리, 오답 확인, 예상 문제 1회 풀이"
    });
  }

  return tasks;
}

function ensureAutoStudyPlan() {
  if (!Array.isArray(state.courses)) return;
  state.courses.forEach(migrateCourseGoalFields);
  state.courses.forEach(syncCourseExamTask);
  const manualDoneIds = new Set(
    state.tasks
      .filter((task) => task.autoPlan && task.done)
      .map((task) => task.id)
  );
  const manualTasks = state.tasks.filter((task) => !task.autoPlan);
  const autoTasks = state.courses.flatMap(buildAutoTasksForCourse).map((task) => ({
    ...task,
    done: manualDoneIds.has(task.id)
  }));
  state.tasks = [...manualTasks, ...autoTasks].sort((a, b) => a.date.localeCompare(b.date));
}

function getAutoTasks() {
  return state.tasks.filter((task) => task.autoPlan && !task.done);
}

function renderDashboard() {
  if (!$("#dashboardView")) return;
  const current = Number(state.currentGpa) || 0;
  const target = Number(state.targetGpa) || 0;
  const percent = target ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const gap = Math.max(0, target - current).toFixed(2);
  const upcoming = getUpcomingTasks();
  const nearest = upcoming[0];
  const autoTasks = getAutoTasks();
  const todayAutoTasks = autoTasks.filter((task) => task.date === todayText());

  $("#currentGpaText").textContent = current.toFixed(2);
  $("#targetGpaText").textContent = target.toFixed(2);
  $("#headerGpa").textContent = current.toFixed(2);
  if ($("#currentGpa") && document.activeElement !== $("#currentGpa")) $("#currentGpa").value = current.toFixed(2);
  if ($("#targetGpa") && document.activeElement !== $("#targetGpa")) $("#targetGpa").value = target.toFixed(2);
  $("#gpaPercent").textContent = `${percent}%`;
  $("#gpaMeter").style.width = `${percent}%`;
  $("#gpaHint").textContent = gap === "0.00" ? "목표 GPA를 달성했어요." : `목표까지 ${gap} 남았어요.`;
  $("#gpaBadge").textContent = todayAutoTasks.length ? `오늘 ${todayAutoTasks.length}개` : "계획 대기";
  $("#gpaBadge").className = `badge ${autoTasks.length ? "ok" : ""}`;
  $("#upcomingCount").textContent = `${upcoming.length}건`;
  $("#nearestTask").textContent = nearest
    ? `${nearest.title} · ${formatDate(nearest.date)}`
    : "등록된 일정이 없습니다.";
  $("#attendanceValue").textContent = `${state.attendance}%`;
  $("#streakValue").textContent = `${state.streak}일`;
  renderAutoPlanDashboard(autoTasks, todayAutoTasks);
  renderCourseGoalDashboard();
}

function renderAutoPlanDashboard(autoTasks, todayAutoTasks) {
  const list = $("#autoPlanList");
  const summary = $("#planSummary");
  if (!list) return;

  const visible = (todayAutoTasks.length ? todayAutoTasks : autoTasks).slice(0, 6);
  const totalMinutes = visible.reduce((sum, task) => sum + (Number(task.minutes) || 0), 0);

  if (summary) {
    summary.textContent = visible.length
      ? `오늘 기준 ${visible.length}개, 예상 ${totalMinutes}분 학습으로 자동 조정했습니다.`
      : "과목별 목표 점수와 시험일을 입력하면 계획이 자동으로 잡힙니다.";
  }

  if (!visible.length) {
    list.className = "auto-plan-list empty";
    list.textContent = "과제/공부에서 과목별 시험일과 목표 점수를 설정하세요.";
    return;
  }

  list.className = "auto-plan-list";
  list.innerHTML = visible
    .map(
      (task) => `
        <button class="auto-plan-item" type="button" data-course-name="${escapeHtml(task.course || "")}">
          <div>
            <strong>${escapeHtml(task.title)}</strong>
            <p>${escapeHtml(task.reason || "")}</p>
            <small>오늘의 학습 목표 · ${escapeHtml(task.studyGoal || "핵심 개념 복습")}</small>
          </div>
          <div class="plan-meta">
            <span>${formatDate(task.date)}</span>
            <span>${task.minutes || 30}분</span>
          </div>
        </button>
      `
    )
    .join("");
}

function renderCourseGoalDashboard() {
  const list = $("#courseGoalList");
  if (!list) return;
  const courses = state.courses
    .map((course) => ({ course, plan: getCoursePlanInput(course) }))
    .filter(({ course }) => course.examDate);

  if (!courses.length) {
    list.className = "goal-list empty";
    list.textContent = "과목별 시험일과 목표 점수를 설정하면 여기에 표시됩니다.";
    return;
  }

  list.className = "goal-list";
  list.innerHTML = courses
    .sort((a, b) => b.plan.load - a.plan.load)
    .map(({ course, plan }) => {
      const progress = Math.max(0, Math.min(100, Math.round((Number(plan.currentScore) / Number(plan.targetScore || 1)) * 100)));
      const detail = Number.isFinite(plan.requiredFinal)
        ? `D-${plan.daysLeft} · 필요 기말 ${Math.round(plan.requiredFinal)}점 · 가능성 ${plan.possibility || "-"}`
        : `D-${plan.daysLeft} · 목표 ${plan.targetScore}점 · 현재 ${plan.currentScore}점`;
      return `
        <article class="goal-item">
          <div>
            <strong>${escapeHtml(course.name || "이름 없는 과목")}</strong>
            <p>${escapeHtml(detail)}</p>
          </div>
          <div class="goal-meter">
            <span>${progress}%</span>
            <div class="mini-meter"><span style="width:${progress}%"></span></div>
          </div>
        </article>
      `;
    })
    .join("");
}

function getUpcomingTasks() {
  const today = todayText();
  return state.tasks
    .filter((task) => !task.done && task.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderTasks() {
  const list = $("#taskList");
  if (!list) return;
  const tasks = [...state.tasks].sort((a, b) => a.date.localeCompare(b.date));
  const doneCount = tasks.filter((task) => task.done).length;

  $("#taskSummary").textContent = tasks.length
    ? `전체 ${tasks.length}건 · 완료 ${doneCount}건 · 진행 중 ${tasks.length - doneCount}건`
    : "등록된 일정이 없습니다.";

  if (!tasks.length) {
    list.className = "task-list empty";
    list.textContent = "일정을 추가하면 여기에 표시됩니다.";
    return;
  }

  list.className = "task-list";
  list.innerHTML = tasks
    .map(
      (task) => `
        <article class="task-item ${task.done ? "done" : ""}">
          <div>
            <h3>${escapeHtml(task.title)}</h3>
            <div class="task-meta">
              <span>${escapeHtml(task.type)}</span>
              <span>${escapeHtml(task.course || "과목 없음")}</span>
              <span>${formatDate(task.date)}</span>
              <span>${task.progress}%</span>
            </div>
            <div class="mini-meter"><span style="width:${task.progress}%"></span></div>
          </div>
          <div class="task-actions">
            <button class="secondary" type="button" data-action="toggle" data-id="${task.id}">
              ${task.done ? "되돌리기" : "완료"}
            </button>
            <button class="secondary" type="button" data-action="delete" data-id="${task.id}">삭제</button>
          </div>
        </article>
      `
    )
    .join("");
}

function getActiveCourse() {
  if (!state.courses?.length) {
    state.courses = [
      {
        id: crypto.randomUUID(),
        name: "새 과목",
        examDate: "",
        currentScore: 70,
        targetScore: 90,
        weeklyHours: 6,
        activeMaterialId: "",
        materials: []
      }
    ];
  }

  if (!state.courses.some((course) => course.id === state.activeCourseId)) {
    state.activeCourseId = state.courses[0].id;
  }

  const course = state.courses.find((item) => item.id === state.activeCourseId);
  migrateCourseGoalFields(course);
  migrateCourseMaterials(course);
  return course;
}

function migrateCourseMaterials(course) {
  if (!Array.isArray(course.materials)) {
    course.materials = [];
  }
  if (!Array.isArray(course.wrongNotes)) {
    course.wrongNotes = [];
  }

  if (course.materialName || course.summary) {
    const material = {
      id: crypto.randomUUID(),
      title: course.materialName?.replace(/\.[^.]+$/, "") || "기존 교안",
      fileName: course.materialName || "",
      mimeType: course.materialMimeType || "",
      summary: course.summary || ""
    };
    course.materials.push(material);
    course.activeMaterialId = material.id;
    delete course.materialName;
    delete course.materialMimeType;
    delete course.summary;
  }
}

function getActiveMaterial(course = getActiveCourse()) {
  if (!course.materials.length) return null;
  if (!course.materials.some((material) => material.id === course.activeMaterialId)) {
    course.activeMaterialId = course.materials[0].id;
  }
  return course.materials.find((material) => material.id === course.activeMaterialId);
}

function renderCourses() {
  if (!courseTabs) return;
  const active = getActiveCourse();
  const activeMaterial = getActiveMaterial(active);
  courseTabs.innerHTML = state.courses
    .map(
      (course) => `
        <button class="course-tab ${course.id === active.id ? "active" : ""}" type="button" data-course-id="${course.id}">
          ${escapeHtml(course.name || "이름 없음")}
        </button>
      `
    )
    .join("");

  courseEditorName.value = active.name || "";
  if (courseExamDate) courseExamDate.value = active.examDate || "";
  if (courseCurrentScore) courseCurrentScore.value = active.currentScore;
  if (courseTargetScore) courseTargetScore.value = active.targetScore;
  if (courseWeeklyHours) courseWeeklyHours.value = active.weeklyHours;
  renderCoursePlanPreview(active);
  renderMaterials(active);
  courseSummaryMeta.textContent = activeMaterial
    ? `${active.name || "과목"} · ${activeMaterial.title || activeMaterial.fileName}`
    : `${active.name || "과목"} · 업로드된 교안 없음`;

  if (activeMaterial?.summary) {
    courseSummary.className = "summary-box";
    courseSummary.innerHTML = renderMarkdown(activeMaterial.summary);
  } else {
    courseSummary.className = "summary-box empty";
    courseSummary.textContent = activeMaterial
      ? "선택한 교안의 요약 결과가 여기에 표시됩니다."
      : "Gemini 요약 결과가 여기에 표시됩니다.";
  }
}

function renderCoursePlanPreview(course) {
  if (!coursePlanPreview) return;
  const plan = getCoursePlanInput(course);

  if (!course.examDate) {
    coursePlanPreview.textContent = "시험일을 입력하면 홈과 캘린더에 자동 학습 계획이 생성됩니다.";
    return;
  }

  if (plan.daysLeft < 0) {
    coursePlanPreview.textContent = "지난 시험일입니다. 다음 시험일로 수정하세요.";
    return;
  }

  coursePlanPreview.textContent = `D-${plan.daysLeft} · 목표까지 ${plan.scoreGap}점 · 하루 권장 ${plan.dailyMinutes}분`;
}

function renderMaterials(course) {
  if (!materialList) return;
  if (!course.materials.length) {
    materialList.className = "material-list empty";
    materialList.textContent = "이 과목에 등록된 교안이 없습니다.";
    return;
  }

  materialList.className = "material-list";
  materialList.innerHTML = course.materials
    .map(
      (material) => `
        <button class="material-item ${material.id === course.activeMaterialId ? "active" : ""}" type="button" data-material-id="${material.id}">
          <strong>${escapeHtml(material.title || "이름 없는 교안")}</strong>
          <span>${escapeHtml(material.fileName || "파일 다시 선택 필요")}${material.summary ? " · 요약 완료" : ""}${material.vectorized ? " · Chroma 완료" : ""}</span>
        </button>
      `
    )
    .join("");
}

function findCourseForResult() {
  const name = courseName?.value.trim();
  if (name) {
    const exact = state.courses.find((course) => course.name === name);
    if (exact) return exact;
  }
  return state.courses.find((course) => course.id === state.activeCourseId) || state.courses[0];
}

async function vectorizeMaterialText(course, material) {
  if (!course || !material?.summary) return null;

  const file = await getMaterialFile(material);
  const isPdf = file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || material.fileName || ""));
  const title = material.title || material.fileName || "교안";

  let response;
  if (isPdf) {
    const form = new FormData();
    form.append("file", file, file.name || material.fileName || `${title}.pdf`);
    form.append("course_id", course.id);
    form.append("course_name", course.name);
    form.append("material_id", material.id);
    form.append("title", title);
    response = await fetch("/vectorize-upload", {
      method: "POST",
      body: form
    });
  } else {
    response = await fetch("/vectorize-text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        course_id: course.id,
        course_name: course.name,
        material_id: material.id,
        title,
        text: material.summary
      })
    });
  }

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Chroma DB 저장에 실패했습니다.");
  }

  material.vectorized = true;
  material.vectorizedSource = isPdf ? "pdf_pages" : "summary";
  material.vectorizedAt = new Date().toISOString();
  material.chunkCount = data.chunk_count || 0;
  return data;
}

async function ensureCourseMaterialsVectorized(course) {
  if (!course?.materials?.length) return false;
  let changed = false;

  for (const material of course.materials) {
    if (!material.summary || material.vectorizedSource === "pdf_pages" || material.vectorizedSource === "summary") continue;
    try {
      await vectorizeMaterialText(course, material);
      changed = true;
    } catch {
      material.vectorized = false;
    }
  }

  if (changed) {
    savePlannerState();
    renderCourses();
  }
  return changed;
}

async function fetchRelatedMaterialChunks({ query, course, limit = 4 }) {
  const response = await fetch("/search-material", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      course_id: course?.id || "",
      limit
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) return [];
  return data.chunks || [];
}

async function searchRelatedMaterialChunks({ question, grading, course }) {
  const missing = Array.isArray(grading.missing_keywords) ? grading.missing_keywords.join(" ") : "";
  const query = [question, missing, grading.feedback].filter(Boolean).join("\n");
  if (!query.trim()) return [];

  try {
    await ensureCourseMaterialsVectorized(course);
    let chunks = await fetchRelatedMaterialChunks({ query, course });
    if (chunks.length) return chunks;

    const vectorized = await ensureCourseMaterialsVectorized(course);
    if (!vectorized) return [];

    chunks = await fetchRelatedMaterialChunks({ query, course });
    return chunks;
  } catch {
    return [];
  }
}

function shouldSaveWrongNote(grading) {
  const score = Number(grading.score);
  const missing = Array.isArray(grading.missing_keywords) ? grading.missing_keywords : [];
  return !Number.isFinite(score) || score < 80 || missing.length > 0;
}

function addWrongNote({ parsed, payload, grading, relatedChunks }) {
  if (!shouldSaveWrongNote(grading)) return null;
  const course = findCourseForResult();
  if (!course) return null;
  migrateCourseMaterials(course);

  const note = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    question: parsed.question,
    modelAnswer: payload.modelAnswer || "",
    studentAnswer: payload.studentAnswer || payload.studentAnswerImage?.fileName || "이미지 답안",
    score: grading.score ?? null,
    grade: grading.grade || "",
    feedback: grading.feedback || "",
    missingKeywords: Array.isArray(grading.missing_keywords) ? grading.missing_keywords : [],
    revisedAnswer: grading.revised_answer || "",
    relatedChunks
  };

  course.wrongNotes.unshift(note);
  course.wrongNotes = course.wrongNotes.slice(0, 50);
  savePlannerState();
  return note;
}

function renderWrongNotes() {
  const list = $("#wrongNoteList");
  if (!list) return;
  const course = getActiveCourse();
  const notes = course.wrongNotes || [];

  if (!notes.length) {
    list.className = "wrong-note-list empty";
    list.textContent = "아직 저장된 오답이 없습니다.";
    return;
  }

  list.className = "wrong-note-list";
  list.innerHTML = notes
    .map((note) => {
      const related = Array.isArray(note.relatedChunks) ? note.relatedChunks : [];
      return `
        <article class="wrong-note-item">
          <div class="wrong-note-head">
            <small>${new Date(note.createdAt).toLocaleString("ko-KR")}</small>
            <strong>${escapeHtml(note.score ?? "-")}점 · ${escapeHtml(note.grade || "채점")}</strong>
          </div>
          <h3>${renderRichText(note.question)}</h3>
          <p><b>부족 키워드</b> ${renderRichText(note.missingKeywords?.join(", ") || "-")}</p>
          <p><b>피드백</b> ${renderRichText(note.feedback || "-")}</p>
          <div class="related-chunks">
            ${
              related.length
                ? related
                    .map((chunk) => {
                      const source = formatMaterialReference(chunk);
                      return `<div><span>${escapeHtml(source)}</span><p>${renderRichText(String(chunk.text || "").slice(0, 220))}</p></div>`;
                    })
                    .join("")
                : `<div><span>관련 교안 없음</span><p>Chroma DB에 벡터화된 교안 chunk가 아직 없거나 검색 결과가 없습니다.</p></div>`
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCalendar() {
  const grid = $("#calendarGrid");
  if (!grid) return;
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());

  $("#calendarTitle").textContent = `${year}년 ${month + 1}월`;

  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const text = toDateText(date);
    const items = state.tasks.filter((task) => task.date === text);
    const muted = date.getMonth() !== month ? "muted" : "";

    return `
      <div class="calendar-day ${muted}">
        <strong>${date.getDate()}</strong>
        <div class="dot-list">
          ${items.map((item) => `<span class="dot">${escapeHtml(item.type)} · ${escapeHtml(item.title)}</span>`).join("")}
        </div>
      </div>
    `;
  });

  grid.innerHTML = days.join("");
}

function renderAnalysis() {
  if (!$("#doneRate")) return;
  const tasks = state.tasks;
  const doneRate = tasks.length ? Math.round((tasks.filter((task) => task.done).length / tasks.length) * 100) : 0;
  const monthPrefix = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, "0")}`;
  const monthTasks = tasks.filter((task) => task.date.startsWith(monthPrefix));
  const courseMap = tasks.reduce((acc, task) => {
    const course = task.course || "과목 없음";
    acc[course] = acc[course] || { total: 0, pending: 0 };
    acc[course].total += 1;
    if (!task.done) acc[course].pending += 1;
    return acc;
  }, {});
  const risky = Object.entries(courseMap).sort((a, b) => b[1].pending - a[1].pending)[0];

  $("#doneRate").textContent = `${doneRate}%`;
  $("#riskCourse").textContent = risky && risky[1].pending ? risky[0] : "없음";
  $("#monthTaskCount").textContent = `${monthTasks.length}건`;

  const bars = Object.entries(courseMap);
  $("#courseBars").innerHTML = bars.length
    ? bars
        .map(([course, value]) => {
          const progress = Math.round(((value.total - value.pending) / value.total) * 100);
          return `
            <div class="course-bar">
              <span><b>${escapeHtml(course)}</b><b>${progress}%</b></span>
              <div class="mini-meter"><span style="width:${progress}%"></span></div>
            </div>
          `;
        })
        .join("")
    : `<div class="empty">분석할 일정이 없습니다.</div>`;
}

function renderGradeProjectionForm() {
  const select = $("#gradeCourseSelect");
  if (!select) return;
  const selected = select.value || state.activeCourseId || state.courses[0]?.id || "";
  select.innerHTML = state.courses
    .map((course) => `<option value="${course.id}">${escapeHtml(course.name || "이름 없는 과목")}</option>`)
    .join("");
  select.value = state.courses.some((course) => course.id === selected) ? selected : state.courses[0]?.id || "";
  const course = state.courses.find((item) => item.id === select.value);
  if ($("#gradeExamDate")) $("#gradeExamDate").value = course?.examDate || "";
  if ($("#gradeMidtermScore")) $("#gradeMidtermScore").value = course?.gradeProjection?.input?.midterm_score ?? course?.currentScore ?? 75;
  if ($("#gradeTargetGrade") && course?.gradeProjection?.target_grade) $("#gradeTargetGrade").value = course.gradeProjection.target_grade;
  if ($("#gradeCreditUnits") && course?.gradeProjection?.credit_units) $("#gradeCreditUnits").value = course.gradeProjection.credit_units;
  if ($("#gradeCurrentGrade") && course?.gradeProjection?.current_grade) $("#gradeCurrentGrade").value = course.gradeProjection.current_grade;
  renderGradeProjectionResult(course?.gradeProjection || state.lastGradeProjection || null);
}

function numberValue(selector, fallback = 0) {
  const value = $(selector)?.value;
  return value === "" || value == null ? fallback : Number(value);
}

function optionalNumberValue(selector) {
  const value = $(selector)?.value;
  return value === "" || value == null ? null : Number(value);
}

function buildGradeProjectionPayload() {
  const course = state.courses.find((item) => item.id === $("#gradeCourseSelect")?.value) || state.courses[0];
  if (course && $("#gradeExamDate")?.value) {
    course.examDate = $("#gradeExamDate").value;
    syncCourseExamTask(course);
  }
  return {
    course_id: course?.id || "",
    course_name: course?.name || "과목 없음",
    credit_units: numberValue("#gradeCreditUnits", 3),
    current_grade: $("#gradeCurrentGrade")?.value || "미정",
    total_students: numberValue("#gradeTotalStudents", 100),
    target_grade: $("#gradeTargetGrade")?.value || "A0",
    target_percent: numberValue("#gradeTargetPercent", 30),
    attendance_weight: numberValue("#gradeAttendanceWeight", 10),
    assignment_weight: numberValue("#gradeAssignmentWeight", 20),
    midterm_weight: numberValue("#gradeMidtermWeight", 30),
    final_weight: numberValue("#gradeFinalWeight", 40),
    attendance_score: numberValue("#gradeAttendanceScore", 100),
    assignment_score: numberValue("#gradeAssignmentScore", 85),
    midterm_score: numberValue("#gradeMidtermScore", 75),
    midterm_rank: optionalNumberValue("#gradeMidtermRank"),
    midterm_mean: optionalNumberValue("#gradeMidtermMean"),
    midterm_std: optionalNumberValue("#gradeMidtermStd"),
    final_mean: optionalNumberValue("#gradeFinalMean"),
    final_std: optionalNumberValue("#gradeFinalStd")
  };
}

async function requestGradeProjection(payload) {
  const response = await fetch("/grade-projection", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const message = Array.isArray(data.error) ? data.error.map((item) => item.msg).join(", ") : data.error;
    throw new Error(message || "성적 계산에 실패했습니다.");
  }
  return data.result;
}

function renderGradeGraph(points, targetTotal) {
  const safePoints = Array.isArray(points) && points.length ? points : [];
  if (!safePoints.length) return "";
  const width = 620;
  const height = 240;
  const padX = 46;
  const padY = 30;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const y = (score) => padY + plotH - (Math.max(0, Math.min(100, Number(score) || 0)) / 100) * plotH;
  const x = (index) => padX + (safePoints.length === 1 ? plotW / 2 : (plotW / (safePoints.length - 1)) * index);
  const path = safePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.score)}`).join(" ");
  const targetY = y(targetTotal);

  return `
    <div class="grade-chart" aria-label="예상 성적 그래프">
      <svg viewBox="0 0 ${width} ${height}" role="img">
        <line x1="${padX}" y1="${targetY}" x2="${width - padX}" y2="${targetY}" class="target-line"></line>
        <text x="${width - padX}" y="${Math.max(14, targetY - 8)}" text-anchor="end" class="target-label">목표 ${targetTotal}점</text>
        <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${height - padY}" class="axis"></line>
        <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" class="axis"></line>
        <path d="${path}" class="grade-line"></path>
        ${safePoints
          .map(
            (point, index) => `
              <circle cx="${x(index)}" cy="${y(point.score)}" r="5" class="grade-dot"></circle>
              <text x="${x(index)}" y="${height - 8}" text-anchor="middle" class="chart-label">${escapeHtml(point.label)}</text>
              <text x="${x(index)}" y="${Math.max(16, y(point.score) - 12)}" text-anchor="middle" class="chart-score">${escapeHtml(`${point.score}점`)}</text>
            `
          )
          .join("")}
      </svg>
    </div>
  `;
}

function renderGradeProjectionResult(result) {
  const box = $("#gradeProjectionResult");
  if (!box) return;
  if (!result) {
    box.className = "grade-result empty";
    box.textContent = "계산 결과가 여기에 표시됩니다.";
    return;
  }

  box.className = "grade-result";
  box.innerHTML = `
    <div class="grade-result-title">
      <div>
        <span>과목명</span>
        <strong>${escapeHtml(result.course_name || "과목 없음")}</strong>
      </div>
      <div>
        <span>학점 수</span>
        <strong>${escapeHtml(result.credit_units ?? "-")}학점</strong>
      </div>
      <div>
        <span>현재 성적</span>
        <strong>${escapeHtml(result.current_grade || result.current_estimated_grade || "-")}</strong>
      </div>
      <div>
        <span>목표 성적</span>
        <strong>${escapeHtml(result.target_grade || "-")}</strong>
      </div>
    </div>
    <div class="grade-summary-grid">
      <div><span>목표 등수</span><strong>${escapeHtml(result.target_rank_text)}</strong></div>
      <div><span>현재 확보 점수</span><strong>${result.secured_score}점</strong></div>
      <div><span>필요 기말 점수</span><strong>${result.required_final_score}점</strong></div>
      <div><span>목표 달성 가능성</span><strong>${escapeHtml(result.possibility || "-")} · ${result.possibility_score ?? "-"}%</strong></div>
    </div>
    <div class="grade-breakdown">
      <div><span>목표 기준 점수</span><strong>${result.target_total}점</strong></div>
      <div><span>중간 위치</span><strong>${result.rank_percentile ?? result.midterm_percentile ?? "-"}%</strong></div>
      <div><span>필요 기말 백분위</span><strong>${result.final_needed_percentile ?? "-"}%</strong></div>
      <div><span>현재 추정 학점</span><strong>${escapeHtml(result.current_estimated_grade || "-")}</strong></div>
    </div>
    ${renderGradeGraph(result.graph_points, result.target_total)}
    <h3 class="section-mini-title">예상 성적 시뮬레이션</h3>
    <div class="scenario-list">
      ${result.scenarios
        .map(
          (scenario) => `
            <div class="scenario-item">
              <span>기말 ${scenario.final_score}점</span>
              <div class="mini-meter"><span style="width:${Math.min(100, scenario.expected_total)}%"></span></div>
              <strong>${scenario.expected_grade} · ${scenario.expected_total}점</strong>
            </div>
          `
        )
        .join("")}
    </div>
    <p class="direction-text">${escapeHtml(result.direction)}</p>
  `;
}

function applyGradeProjectionToCourse(result) {
  if (!result?.course_id) return;
  const course = state.courses.find((item) => item.id === result.course_id);
  if (!course) return;

  course.gradeProjection = {
    ...result,
    savedAt: new Date().toISOString()
  };
  course.currentScore = Math.max(0, Math.min(100, Number(result.secured_score) || course.currentScore || 0));
  course.targetScore = Math.max(0, Math.min(100, Number(result.target_total) || course.targetScore || 0));
}

async function saveGradeProjectionToSupabase(result) {
  if (!supabaseClient || !currentUser) return { skipped: true };
  const { error } = await supabaseClient.from("grade_projections").insert({
    user_id: currentUser.id,
    course_id: result.course_id || null,
    course_name: result.course_name,
    target_grade: result.target_grade,
    result
  });
  if (error) throw error;
  return { skipped: false };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("교안 파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

function openMaterialDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(materialDbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(materialStoreName, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveMaterialFile(materialId, file) {
  const db = await openMaterialDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(materialStoreName, "readwrite");
    tx.objectStore(materialStoreName).put({
      id: materialId,
      file,
      fileName: file.name,
      mimeType: file.type || guessMimeType(file.name),
      savedAt: new Date().toISOString()
    });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function getMaterialFile(material) {
  if (!material) return null;
  const memoryFile = courseFiles.get(material.id);
  if (memoryFile) return memoryFile;

  const db = await openMaterialDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(materialStoreName, "readonly");
    const request = tx.objectStore(materialStoreName).get(material.id);
    request.onsuccess = () => {
      db.close();
      const record = request.result;
      if (!record?.file) {
        resolve(null);
        return;
      }
      const file =
        record.file instanceof File
          ? record.file
          : new File([record.file], record.fileName || material.fileName || "material.pdf", {
              type: record.mimeType || material.mimeType || "application/octet-stream"
            });
      courseFiles.set(material.id, file);
      resolve(file);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function deleteMaterialFile(materialId) {
  const db = await openMaterialDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(materialStoreName, "readwrite");
    tx.objectStore(materialStoreName).delete(materialId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function addMaterialFromSelectedFile() {
  const active = getActiveCourse();
  const file = courseMaterialFile.files[0];

  if (!file) {
    summaryStatus.textContent = "추가할 교안 파일을 먼저 선택하세요.";
    summaryStatus.className = "status error";
    return null;
  }

  const material = {
    id: crypto.randomUUID(),
    title: materialTitle.value.trim() || file.name.replace(/\.[^.]+$/, ""),
    fileName: file.name,
    mimeType: file.type || guessMimeType(file.name),
    summary: ""
  };

  active.materials.push(material);
  active.activeMaterialId = material.id;
  courseFiles.set(material.id, file);
  await saveMaterialFile(material.id, file);
  materialTitle.value = "";
  savePlannerState();
  renderCourses();
  summaryStatus.textContent = `${material.title} 교안을 추가했습니다.`;
  summaryStatus.className = "status ok";
  return material;
}

async function summarizeActiveCourse() {
  const active = getActiveCourse();
  const material = getActiveMaterial(active);
  let file = material ? await getMaterialFile(material) : courseMaterialFile.files[0];

  if (!file) {
    summaryStatus.textContent = "요약할 교안을 추가하거나 파일을 다시 선택하세요.";
    summaryStatus.className = "status error";
    return;
  }

  if (!material) {
    await addMaterialFromSelectedFile();
    file = await getMaterialFile(getActiveMaterial(active));
  }

  const targetMaterial = getActiveMaterial(active);

  summaryStatus.textContent = "Gemini로 교안을 요약하는 중입니다.";
  summaryStatus.className = "status";

  try {
    courseFiles.set(targetMaterial.id, file);
    await saveMaterialFile(targetMaterial.id, file);
    targetMaterial.fileName = file.name;
    targetMaterial.mimeType = file.type || guessMimeType(file.name);
    active.name = courseEditorName.value.trim() || active.name;

    const response = await fetch("/summarize-material", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        courseName: active.name,
        fileName: file.name,
        mimeType: targetMaterial.mimeType,
        base64: await fileToBase64(file),
        instruction: summaryInstruction.value.trim()
      })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Gemini 요약에 실패했습니다.");
    }

    targetMaterial.summary = data.summary || "요약 결과가 비어 있습니다.";
    targetMaterial.vectorized = false;
    savePlannerState();
    renderCourses();
    summaryStatus.textContent = "교안 요약 완료. Chroma DB에 저장하는 중입니다.";
    summaryStatus.className = "status";

    try {
      const vectorized = await vectorizeMaterialText(active, targetMaterial);
      savePlannerState();
      renderCourses();
      summaryStatus.textContent = `교안 요약과 Chroma 저장을 완료했습니다. ${vectorized.chunk_count || 0}개 chunk가 저장됐습니다.`;
      summaryStatus.className = "status ok";
    } catch (vectorError) {
      savePlannerState();
      renderCourses();
      summaryStatus.textContent = `교안 요약은 완료했습니다. Chroma 저장 실패: ${vectorError.message}`;
      summaryStatus.className = "status error";
    }
  } catch (error) {
    summaryStatus.textContent = `요약 실패: ${error.message}`;
    summaryStatus.className = "status error";
  }
}

async function useActiveMaterialForQuestions() {
  const active = getActiveCourse();
  const material = getActiveMaterial(active);

  if (!material) {
    summaryStatus.textContent = "문제 생성에 사용할 교안을 먼저 선택하세요.";
    summaryStatus.className = "status error";
    return;
  }

  const prompt = material?.summary
    ? `교안 "${material.title}" 범위 안에서 문제를 생성해줘.\n\n아래 요점정리를 참고해줘.\n\n${material.summary.slice(0, 1800)}`
    : summaryInstruction.value.trim();
  const file = await getMaterialFile(material);

  localStorage.setItem(
    pendingGenerationKey,
    JSON.stringify({
      materialId: material.id,
      courseName: active.name || "",
      materialTitle: material.title || material.fileName || "",
      fileName: material.fileName || file?.name || "",
      instruction: prompt
    })
  );

  if (materialFile && file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    materialFile.files = transfer.files;
    courseName.value = active.name || "";
    instruction.value = prompt;
    switchView("generatorView");
    setStatus(`${material.title || file.name} 교안을 문제 생성에 연결했습니다.`, "ok");
    return;
  }

  window.location.href = "./generator.html";
}

async function loadPendingGeneration() {
  if (!form) return;
  const pending = JSON.parse(localStorage.getItem(pendingGenerationKey) || "null");
  if (!pending) return;

  if (courseName) courseName.value = pending.courseName || "";
  if (instruction) instruction.value = pending.instruction || "";

  const material = {
    id: pending.materialId,
    fileName: pending.fileName,
    mimeType: guessMimeType(pending.fileName || "")
  };
  const file = await getMaterialFile(material);
  if (file && materialFile) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    materialFile.files = transfer.files;
    setStatus(`${pending.materialTitle || file.name} 교안 파일이 자동 연결됐습니다.`, "ok");
  } else {
    setStatus(`${pending.materialTitle || pending.fileName} 교안 정보는 연결됐지만 저장된 파일을 찾지 못했습니다.`, "error");
  }
  localStorage.removeItem(pendingGenerationKey);
}

function guessMimeType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  return "application/octet-stream";
}

function renderTimer() {
  if (!$("#timerDisplay")) return;
  $("#timerDisplay").textContent = formatSeconds(getTimerSeconds());
  $("#studyTotal").textContent = `오늘 누적 공부 시간 ${Math.floor(state.studySeconds / 60)}분`;
}

function getTimerSeconds() {
  const running = timerId ? Math.floor((Date.now() - timerStartedAt) / 1000) : 0;
  return timerElapsed + running;
}

function normalizeQuestions(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.questions)) return data.questions;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.results)) return data.results;
  if (typeof data.output === "string") {
    try {
      return normalizeQuestions(JSON.parse(data.output));
    } catch {
      return [{ question: data.output }];
    }
  }
  return [data];
}

async function requestGeneration(formData) {
  const base = getRequestBase();
  let lastError = null;

  for (const endpoint of endpointCandidates) {
    try {
      const response = await fetch(`${base}${endpoint}`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        lastError = new Error(`${endpoint} ${response.status}`);
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await response.json()
        : { output: await response.text() };

      return { data, endpoint };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("생성 API를 찾을 수 없습니다.");
}

function getRequestBase() {
  const base = apiBaseUrl?.value.trim().replace(/\/$/, "") || "";
  if (!base || base === "http://127.0.0.1:8000" || base === "http://localhost:8000") {
    return "";
  }
  return base;
}

function getDisplayApiLabel() {
  const base = apiBaseUrl?.value.trim() || "";
  if (!base || base === "http://127.0.0.1:8000" || base === "http://localhost:8000") {
    return "5173 프록시 → 8000";
  }
  return base;
}

function buildFormData() {
  const data = new FormData();
  data.append("file", materialFile.files[0]);
  data.append("pdf", materialFile.files[0]);
  data.append("material", materialFile.files[0]);
  data.append("question_type", questionType.value);
  data.append("type", questionType.value);
  data.append("count", questionCount.value);
  data.append("num_questions", questionCount.value);
  data.append("difficulty", difficulty.value);
  data.append("course_name", courseName.value.trim());
  data.append("instruction", instruction.value.trim());
  data.append("prompt", instruction.value.trim());
  return data;
}

async function saveResultToSupabase(payload) {
  if (!supabaseClient || !currentUser) return { skipped: true };

  const row = {
    user_id: currentUser.id,
    course_name: courseName.value.trim() || null,
    material_name: materialFile.files[0]?.name || null,
    question_type: questionType.value,
    question_count: Number(questionCount.value),
    difficulty: difficulty.value,
    instruction: instruction.value.trim() || null,
    result: payload,
    created_at: new Date().toISOString()
  };

  const { error } = await supabaseClient.from("generated_questions").insert(row);
  if (error) throw error;
  return { skipped: false };
}

async function requestAnswerGrading(payload) {
  const response = await fetch("/grade-answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Gemini 채점에 실패했습니다.");
  }
  return data.grading || {
    score: null,
    grade: "검토 필요",
    strengths: [],
    missing_keywords: [],
    feedback: data.raw || "채점 결과가 비어 있습니다.",
    revised_answer: ""
  };
}

async function saveGradingToSupabase(payload, grading) {
  if (!supabaseClient || !currentUser) return { skipped: true };

  const { error } = await supabaseClient.from("graded_answers").insert({
    user_id: currentUser.id,
    course_name: courseName?.value.trim() || null,
    question: payload.question,
    model_answer: payload.modelAnswer || null,
    student_answer: payload.studentAnswer || payload.studentAnswerImage?.fileName || "이미지 답안",
    result: {
      ...grading,
      submitted_image_name: payload.studentAnswerImage?.fileName || null
    }
  });
  if (error) throw error;
  return { skipped: false };
}

function textOrFallback(value, fallback = "-") {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return value || fallback;
}

function inferConceptTitle(text) {
  const raw = String(text || "");
  const bold = raw.match(/\*\*([^*]{2,60})\*\*/);
  const heading = raw.match(/#{1,6}\s*([^\n#*]{2,60})/);
  const colon = raw.match(/(?:^|\n|\.|\*)\s*([가-힣A-Za-z0-9()[\] /·+\-=]{2,50})\s*[:：]/);
  const candidate = (bold?.[1] || colon?.[1] || heading?.[1] || raw.slice(0, 45))
    .replace(/^[\s*\-#0-9.)]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return candidate.length > 45 ? `${candidate.slice(0, 45)}...` : candidate;
}

function formatMaterialReference(chunk) {
  const meta = chunk?.metadata || {};
  const title =
    meta.title ||
    meta.material_title ||
    meta.file_name ||
    meta.filename ||
    (meta.source && !["local_upload", "uploaded_pdf"].includes(meta.source) ? meta.source : "") ||
    "교안";
  const page = Number(meta.page_number);
  const slide = Number(meta.slide_number);
  const chunkIndex = Number(meta.chunk_index);
  const concept = meta.concept || inferConceptTitle(chunk?.text);
  const location = [];

  if (Number.isFinite(page) && page > 0) location.push(`${page}쪽`);
  if (Number.isFinite(slide) && slide > 0) location.push(`${slide}슬라이드`);
  if (!location.length && Number.isFinite(chunkIndex)) location.push("요약 기반");

  return [title, ...location, concept ? `${concept} 개념` : "관련 개념"].filter(Boolean).join(" · ");
}

function formatSource(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatSource).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return formatMaterialReference({ metadata: value, text: value.text || "" });
  }
  return String(value);
}

function parseGeneratedQuestion(item, index) {
  const rawQuestion =
    item.question ||
    item.question_text ||
    item.problem ||
    item.title ||
    `문제 ${index + 1}`;

  const rawText = textOrFallback(rawQuestion, "");
  const parsed = {
    question: rawText,
    answer: item.model_answer || item.answer || item.sample_answer || item.solution || "",
    explanation: item.explanation || item.commentary || "",
    keywords: item.required_keywords || item.keywords || item.key_points || [],
    rubric: item.rubric || item.scoring_criteria || item.criteria || "",
    source: item.source || item.source_pages || item.page || item.slide
  };

  const compact = rawText.replace(/\r/g, "").trim();
  const labeled = compact.match(
    /(?:^|\n)\s*문제\s*[:：]\s*([\s\S]*?)(?=(?:\n|^)\s*(?:정답|답|해설)\s*[:：]|$)/
  );
  const answer = compact.match(
    /(?:^|\n)\s*(?:정답|답)\s*[:：]\s*([\s\S]*?)(?=(?:\n|^)\s*해설\s*[:：]|$)/
  );
  const explanation = compact.match(/(?:^|\n)\s*해설\s*[:：]\s*([\s\S]*)$/);

  if (labeled?.[1]) parsed.question = labeled[1].trim();
  if (!parsed.answer && answer?.[1]) parsed.answer = answer[1].trim();
  if (!parsed.explanation && explanation?.[1]) parsed.explanation = explanation[1].trim();

  return parsed;
}

function renderQuestions(payload) {
  const questions = normalizeQuestions(payload);
  latestPayload = payload;
  renderedQuestions = questions.map((item, index) => parseGeneratedQuestion(item, index));

  results.className = "results";
  results.innerHTML = renderedQuestions
    .map((parsed, index) => {
      const answerParts = [parsed.answer, parsed.explanation && `해설: ${parsed.explanation}`]
        .filter(Boolean)
        .join("\n\n");

      return `
        <article class="question-card">
          <div class="question-head">
            <small>문제 ${index + 1}${parsed.source ? ` · 출처 ${formatSource(parsed.source)}` : ""}</small>
            <h3>${renderRichText(textOrFallback(parsed.question))}</h3>
          </div>
          <div class="answer-grid">
            <div class="answer-block">
              <h4>모범답안</h4>
              <p>${renderRichText(textOrFallback(answerParts, "응답에 모범답안 필드가 없습니다."))}</p>
            </div>
            <div class="answer-block">
              <h4>필수 키워드 / 채점 기준</h4>
              <p>${renderRichText(textOrFallback(parsed.keywords))}</p>
              <p>${renderRichText(textOrFallback(parsed.rubric))}</p>
            </div>
          </div>
          <div class="grading-box">
            <label class="field">
              <span>내 답안</span>
              <textarea class="student-answer" data-index="${index}" rows="4" placeholder="여기에 내가 푼 주관식 답안을 입력하세요."></textarea>
            </label>
            <label class="field">
              <span>답안 사진</span>
              <input class="student-answer-image" data-index="${index}" type="file" accept="image/*" />
            </label>
            <div class="button-row">
              <button class="secondary grade-answer-button" type="button" data-index="${index}">Gemini 채점</button>
            </div>
            <div id="gradingResult-${index}" class="grading-result empty">채점 결과가 여기에 표시됩니다.</div>
          </div>
        </article>
      `;
    })
    .join("");

  resultMeta.textContent = `생성 완료: ${questions.length}개`;
}

function renderHistory(rows) {
  if (!rows.length) {
    history.className = "history empty";
    history.textContent = "저장된 기록이 아직 없습니다.";
    return;
  }

  history.className = "history";
  history.innerHTML = rows
    .map((row) => {
      const count = Array.isArray(row.result?.questions)
        ? row.result.questions.length
        : row.question_count || "-";
      return `
        <article class="history-card">
          <small>${new Date(row.created_at).toLocaleString("ko-KR")}</small>
          <strong>${escapeHtml(row.course_name || "과목명 없음")}</strong>
          <p>${escapeHtml(row.material_name || "자료명 없음")} · ${count}개 · ${escapeHtml(row.difficulty || "")}</p>
        </article>
      `;
    })
    .join("");
}

function renderGradingResult(index, grading) {
  const box = $(`#gradingResult-${index}`);
  if (!box) return;
  const strengths = Array.isArray(grading.strengths) ? grading.strengths : [];
  const missing = Array.isArray(grading.missing_keywords) ? grading.missing_keywords : [];
  const relatedChunks = Array.isArray(grading.related_chunks) ? grading.related_chunks : [];
  box.className = "grading-result";
  box.innerHTML = `
    <div class="grading-score">
      <strong>${grading.score ?? "-"}점</strong>
      <span>${escapeHtml(grading.grade || "채점 완료")}</span>
    </div>
    <div class="grading-feedback">
      ${grading.recognized_answer ? `<p><b>인식된 답안</b><br>${renderRichText(grading.recognized_answer)}</p>` : ""}
      <p>${renderRichText(grading.feedback || "피드백이 없습니다.")}</p>
      ${strengths.length ? `<p><b>잘한 점</b> ${renderRichText(strengths.join(", "))}</p>` : ""}
      ${missing.length ? `<p><b>부족한 키워드</b> ${renderRichText(missing.join(", "))}</p>` : ""}
      ${grading.revised_answer ? `<p><b>보완 답안</b><br>${renderRichText(grading.revised_answer)}</p>` : ""}
    </div>
    <div class="related-chunks">
      ${
        relatedChunks.length
          ? relatedChunks
              .map((chunk) => {
                const source = formatMaterialReference(chunk);
                return `<div><span>${escapeHtml(source)}</span><p>${renderRichText(String(chunk.text || "").slice(0, 220))}</p></div>`;
              })
              .join("")
          : `<div><span>관련 교안</span><p>Chroma DB 검색 결과가 없습니다. 교안을 벡터화하면 관련 페이지가 표시됩니다.</p></div>`
      }
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "<br />");
}

function escapeHtmlRaw(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderRichText(value) {
  return renderInlineMath(escapeHtmlRaw(value)).replaceAll("\n", "<br />");
}

function renderInlineMath(html) {
  return html
    .replace(
      /([A-Za-z0-9가-힣.)\]}]+)\^(\([^)]+\)|\{[^}]+\}|-?\d+(?:\.\d+)?|[A-Za-z가-힣]+)/g,
      (_, base, exponent) => `${base}<sup>${stripMathBrackets(exponent)}</sup>`
    )
    .replace(
      /([A-Za-z0-9가-힣.)\]}]+)_(\([^)]+\)|\{[^}]+\}|-?\d+(?:\.\d+)?|[A-Za-z가-힣]+)/g,
      (_, base, subscript) => `${base}<sub>${stripMathBrackets(subscript)}</sub>`
    );
}

function stripMathBrackets(value) {
  const text = String(value);
  if (
    (text.startsWith("(") && text.endsWith(")")) ||
    (text.startsWith("{") && text.endsWith("}"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function renderInlineMarkdown(value) {
  return escapeHtmlRaw(value)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /((?:^|>)(?:(?!<code>).)*?)(?=<code>|$)/g,
      (match) => renderInlineMath(match)
    );
}

function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r/g, "").split("\n");
  const html = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      closeList();
      html.push("<hr />");
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 4);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      closeList();
      html.push(`<h4>${renderInlineMarkdown(numbered[1])}</h4>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeList();
  return html.join("");
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, "0")}`;
}

function todayText() {
  return toDateText(new Date());
}

function toDateText(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatSeconds(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hrs, mins, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

$$("button.tab[data-view]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

$("#currentGpa")?.addEventListener("input", (event) => {
  state.currentGpa = Number(event.target.value);
  savePlannerState();
  renderDashboard();
});

$("#targetGpa")?.addEventListener("input", (event) => {
  state.targetGpa = Number(event.target.value);
  savePlannerState();
  renderDashboard();
});

$("#attendanceInput")?.addEventListener("input", (event) => {
  state.attendance = Number(event.target.value);
  savePlannerState();
  renderDashboard();
});

$("#streakInput")?.addEventListener("input", (event) => {
  state.streak = Number(event.target.value);
  savePlannerState();
  renderDashboard();
});

$("#autoPlanList")?.addEventListener("click", (event) => {
  const button = event.target.closest(".auto-plan-item");
  if (!button) return;
  const course = state.courses.find((item) => item.name === button.dataset.courseName);
  if (course) {
    state.activeCourseId = course.id;
    localStorage.setItem(plannerKey, JSON.stringify(state));
  }
  location.href = "./study.html";
});

$("#taskForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  state.tasks.push({
    id: crypto.randomUUID(),
    title: $("#taskTitle").value.trim(),
    course: $("#taskCourse").value.trim(),
    type: $("#taskType").value,
    date: $("#taskDate").value,
    progress: Math.max(0, Math.min(100, Number($("#taskProgress").value) || 0)),
    done: false
  });
  event.currentTarget.reset();
  $("#taskProgress").value = 0;
  $("#taskDate").value = todayText();
  savePlannerState();
  renderAll();
});

$("#taskList")?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const task = state.tasks.find((item) => item.id === button.dataset.id);
  if (!task) return;

  if (button.dataset.action === "toggle") {
    task.done = !task.done;
    task.progress = task.done ? 100 : Math.min(task.progress, 90);
  }

  if (button.dataset.action === "delete") {
    state.tasks = state.tasks.filter((item) => item.id !== button.dataset.id);
  }

  savePlannerState();
  renderAll();
});

$("#gradeProjectionForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("#gradeProjectionStatus");
  status.textContent = "성적 역산 계산 중입니다.";
  status.className = "status";

  try {
    const payload = buildGradeProjectionPayload();
    const result = await requestGradeProjection(payload);
    state.lastGradeProjection = result;
    applyGradeProjectionToCourse(result);
    savePlannerState();
    renderGradeProjectionResult(result);
    renderAll();

    try {
      const saved = await saveGradeProjectionToSupabase(result);
      status.textContent = saved.skipped
        ? "계산 완료. 메인 화면 학습 계획에도 반영했습니다. 로그인하면 Supabase에도 저장됩니다."
        : "계산 완료. 메인 화면 학습 계획과 Supabase에 저장했습니다.";
      status.className = "status ok";
    } catch (error) {
      status.textContent = `계산 완료. Supabase 저장 실패: ${error.message}`;
      status.className = "status error";
    }
  } catch (error) {
    status.textContent = `계산 실패: ${error.message}`;
    status.className = "status error";
  }
});

$("#gradeCourseSelect")?.addEventListener("change", () => {
  const course = state.courses.find((item) => item.id === $("#gradeCourseSelect").value);
  if (course) {
    if ($("#gradeMidtermScore")) $("#gradeMidtermScore").value = course.gradeProjection?.input?.midterm_score ?? course.currentScore ?? 70;
    if ($("#gradeExamDate")) $("#gradeExamDate").value = course.examDate || "";
    if ($("#gradeTargetGrade") && course.gradeProjection?.target_grade) $("#gradeTargetGrade").value = course.gradeProjection.target_grade;
    if ($("#gradeCreditUnits") && course.gradeProjection?.credit_units) $("#gradeCreditUnits").value = course.gradeProjection.credit_units;
    if ($("#gradeCurrentGrade") && course.gradeProjection?.current_grade) $("#gradeCurrentGrade").value = course.gradeProjection.current_grade;
    renderGradeProjectionResult(course.gradeProjection || state.lastGradeProjection || null);
  }
});

$("#clearDoneTasks")?.addEventListener("click", () => {
  state.tasks = state.tasks.filter((task) => !task.done);
  savePlannerState();
  renderAll();
});

$("#prevMonth")?.addEventListener("click", () => {
  calendarDate.setMonth(calendarDate.getMonth() - 1);
  renderCalendar();
  renderAnalysis();
});

$("#nextMonth")?.addEventListener("click", () => {
  calendarDate.setMonth(calendarDate.getMonth() + 1);
  renderCalendar();
  renderAnalysis();
});

$("#startTimer")?.addEventListener("click", () => {
  if (timerId) return;
  timerStartedAt = Date.now();
  timerId = setInterval(renderTimer, 500);
});

$("#stopTimer")?.addEventListener("click", () => {
  if (!timerId) return;
  timerElapsed = getTimerSeconds();
  clearInterval(timerId);
  timerId = null;
  renderTimer();
});

$("#resetTimer")?.addEventListener("click", () => {
  state.studySeconds += getTimerSeconds();
  timerElapsed = 0;
  clearInterval(timerId);
  timerId = null;
  timerStartedAt = Date.now();
  savePlannerState();
  renderTimer();
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!materialFile.files[0]) {
    setStatus("강의자료 파일을 먼저 선택하세요.", "error");
    return;
  }

  submitButton.disabled = true;
  setBadge("생성 중", "muted");
  setStatus("로컬 파인튜닝 모델에 문제 생성을 요청하는 중입니다.");

  try {
    const { data, endpoint } = await requestGeneration(buildFormData());
    renderQuestions(data);
    setBadge("API 연결됨", "ok");
    setStatus(`생성 완료. 사용된 엔드포인트: ${endpoint}`, "ok");

    try {
      const saved = await saveResultToSupabase(data);
      if (!saved.skipped) setStatus("생성 완료. Supabase에도 저장했습니다.", "ok");
    } catch (error) {
      setStatus(`생성은 완료됐지만 Supabase 저장 실패: ${error.message}`, "error");
    }
  } catch (error) {
    setBadge("연결 실패", "error");
    setStatus(`생성 실패: ${error.message}. 8000 서버가 켜져 있는지 확인하세요.`, "error");
  } finally {
    submitButton.disabled = false;
  }
});

saveSettings?.addEventListener("click", persistSettings);
apiBaseUrl?.addEventListener("input", () => {
  if (apiLabel) apiLabel.textContent = getDisplayApiLabel();
});

$("#addCourse")?.addEventListener("click", () => {
  const course = {
    id: crypto.randomUUID(),
    name: `새 과목 ${state.courses.length + 1}`,
    examDate: "",
    currentScore: 70,
    targetScore: 90,
    weeklyHours: 6,
    activeMaterialId: "",
    materials: []
  };
  state.courses.push(course);
  state.activeCourseId = course.id;
  courseMaterialFile.value = "";
  materialTitle.value = "";
  savePlannerState();
  renderCourses();
  renderWrongNotes();
});

courseTabs?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-course-id]");
  if (!button) return;
  state.activeCourseId = button.dataset.courseId;
  courseMaterialFile.value = "";
  materialTitle.value = "";
  savePlannerState();
  renderCourses();
  renderWrongNotes();
});

courseEditorName?.addEventListener("input", (event) => {
  const active = getActiveCourse();
  active.name = event.target.value.trim();
  syncCourseExamTask(active);
  savePlannerState();
  renderCourses();
});

function updateActiveCourseGoal(field, value) {
  const active = getActiveCourse();
  active[field] = value;
  if (field === "examDate") syncCourseExamTask(active);
  savePlannerState();
  renderCourses();
}

courseExamDate?.addEventListener("input", (event) => {
  updateActiveCourseGoal("examDate", event.target.value);
});

courseCurrentScore?.addEventListener("input", (event) => {
  updateActiveCourseGoal("currentScore", Math.max(0, Math.min(100, Number(event.target.value) || 0)));
});

courseTargetScore?.addEventListener("input", (event) => {
  updateActiveCourseGoal("targetScore", Math.max(0, Math.min(100, Number(event.target.value) || 0)));
});

courseWeeklyHours?.addEventListener("input", (event) => {
  updateActiveCourseGoal("weeklyHours", Math.max(1, Math.min(40, Number(event.target.value) || 1)));
});

courseMaterialFile?.addEventListener("change", () => {
  const file = courseMaterialFile.files[0];
  if (!file) return;
  if (!materialTitle.value.trim()) {
    materialTitle.value = file.name.replace(/\.[^.]+$/, "");
  }
});

$("#addMaterial")?.addEventListener("click", addMaterialFromSelectedFile);

materialList?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-material-id]");
  if (!button) return;
  const active = getActiveCourse();
  active.activeMaterialId = button.dataset.materialId;
  courseMaterialFile.value = "";
  materialTitle.value = "";
  savePlannerState();
  renderCourses();
});

$("#summarizeMaterial")?.addEventListener("click", summarizeActiveCourse);
$("#useMaterialForQuestions")?.addEventListener("click", useActiveMaterialForQuestions);

$("#deleteCourse")?.addEventListener("click", async () => {
  const active = getActiveCourse();
  if (state.courses.length === 1) {
    active.name = "새 과목";
    active.activeMaterialId = "";
    await Promise.all(active.materials.map((material) => deleteMaterialFile(material.id)));
    active.materials.forEach((material) => courseFiles.delete(material.id));
    active.materials = [];
  } else {
    state.courses = state.courses.filter((course) => course.id !== active.id);
    await Promise.all(active.materials.map((material) => deleteMaterialFile(material.id)));
    active.materials.forEach((material) => courseFiles.delete(material.id));
    state.activeCourseId = state.courses[0].id;
  }
  courseMaterialFile.value = "";
  materialTitle.value = "";
  savePlannerState();
  renderCourses();
});

$("#deleteMaterial")?.addEventListener("click", async () => {
  const active = getActiveCourse();
  const material = getActiveMaterial(active);

  if (!material) {
    summaryStatus.textContent = "삭제할 교안이 없습니다.";
    summaryStatus.className = "status error";
    return;
  }

  active.materials = active.materials.filter((item) => item.id !== material.id);
  await deleteMaterialFile(material.id);
  courseFiles.delete(material.id);
  active.activeMaterialId = active.materials[0]?.id || "";
  courseMaterialFile.value = "";
  materialTitle.value = "";
  savePlannerState();
  renderCourses();
  summaryStatus.textContent = `${material.title} 교안을 삭제했습니다.`;
  summaryStatus.className = "status ok";
});

copyJson?.addEventListener("click", async () => {
  if (!latestPayload) {
    setStatus("복사할 생성 결과가 없습니다.", "error");
    return;
  }
  await navigator.clipboard.writeText(JSON.stringify(latestPayload, null, 2));
  setStatus("생성 결과 JSON을 복사했습니다.", "ok");
});

results?.addEventListener("click", async (event) => {
  const button = event.target.closest(".grade-answer-button");
  if (!button) return;

  const index = Number(button.dataset.index);
  const parsed = renderedQuestions[index];
  const answerInput = $(`.student-answer[data-index="${index}"]`);
  const imageInput = $(`.student-answer-image[data-index="${index}"]`);
  const studentAnswer = answerInput?.value.trim() || "";
  const imageFile = imageInput?.files?.[0] || null;
  const box = $(`#gradingResult-${index}`);

  if (!studentAnswer && !imageFile) {
    box.className = "grading-result empty";
    box.textContent = "채점할 답안을 입력하거나 답안 사진을 올리세요.";
    return;
  }

  button.disabled = true;
  box.className = "grading-result empty";
  box.textContent = "Gemini가 답안을 채점하는 중입니다.";

  const payload = {
    question: parsed.question,
    modelAnswer: parsed.answer,
    rubric: parsed.rubric,
    keywords: parsed.keywords,
    studentAnswer
  };

  if (imageFile) {
    payload.studentAnswerImage = {
      mimeType: imageFile.type || "image/png",
      base64: await fileToBase64(imageFile),
      fileName: imageFile.name
    };
  }

  try {
    const grading = await requestAnswerGrading(payload);
    const course = findCourseForResult();
    const relatedChunks = await searchRelatedMaterialChunks({
      question: parsed.question,
      grading,
      course
    });
    grading.related_chunks = relatedChunks;
    const note = addWrongNote({ parsed, payload, grading, relatedChunks });
    renderGradingResult(index, grading);
    if (note) renderWrongNotes();

    try {
      const saved = await saveGradingToSupabase(payload, grading);
      const noteText = note ? " 과목 오답노트에도 추가했습니다." : "";
      setStatus(saved.skipped ? `채점 완료.${noteText} 로그인하면 Supabase에도 저장됩니다.` : `채점 완료.${noteText} Supabase에도 저장했습니다.`, "ok");
    } catch (error) {
      setStatus(`채점 완료. Supabase 저장 실패: ${error.message}`, "error");
    }
  } catch (error) {
    box.className = "grading-result empty";
    box.textContent = `채점 실패: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

loadHistory?.addEventListener("click", async () => {
  await initSupabase();
  if (!supabaseClient) {
    setStatus("Supabase URL과 anon key를 먼저 저장하세요.", "error");
    return;
  }

  let query = supabaseClient
    .from("generated_questions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  if (currentUser) query = query.eq("user_id", currentUser.id);

  const { data, error } = await query;

  if (error) {
    setStatus(`기록 불러오기 실패: ${error.message}`, "error");
    return;
  }

  renderHistory(data || []);
  setStatus("Supabase 기록을 불러왔습니다.", "ok");
});

$("#signInButton")?.addEventListener("click", async () => {
  await initSupabase();
  if (!supabaseClient) return updateAuthUi();
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: $("#authEmail").value.trim(),
    password: $("#authPassword").value
  });
  if (error) {
    $("#authStatus").textContent = `로그인 실패: ${error.message}`;
    $("#authStatus").className = "status error";
    return;
  }
  await initSupabase();
  await savePlannerStateToSupabase();
});

$("#signUpButton")?.addEventListener("click", async () => {
  await initSupabase();
  if (!supabaseClient) return updateAuthUi();
  const { error } = await supabaseClient.auth.signUp({
    email: $("#authEmail").value.trim(),
    password: $("#authPassword").value
  });
  if (error) {
    $("#authStatus").textContent = `가입 실패: ${error.message}`;
    $("#authStatus").className = "status error";
    return;
  }
  $("#authStatus").textContent = "가입 요청을 보냈습니다. 이메일 확인 설정이 켜져 있으면 메일을 확인하세요.";
  $("#authStatus").className = "status ok";
});

$("#signOutButton")?.addEventListener("click", async () => {
  await initSupabase();
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser = null;
  updateAuthUi();
});

if ($("#taskDate")) $("#taskDate").value = todayText();
async function boot() {
  await loadSettings();
  renderAll();
  await loadPendingGeneration();
}
boot();
