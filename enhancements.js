(() => {
  "use strict";

  const plannerKey = "hakjum-planner-state";
  const timerKey = "hakjum-course-timer-v1";
  let ticker = null;

  const $ = (selector) => document.querySelector(selector);

  function toDateText(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function todayText() {
    return toDateText(new Date());
  }

  function loadPlanner() {
    try {
      return JSON.parse(localStorage.getItem(plannerKey) || "{}") || {};
    } catch {
      return {};
    }
  }

  function savePlanner(planner) {
    localStorage.setItem(plannerKey, JSON.stringify(planner));
  }

  function loadTimer() {
    let timer;
    try {
      timer = JSON.parse(localStorage.getItem(timerKey) || "null");
    } catch {
      timer = null;
    }
    if (!timer || timer.date !== todayText()) {
      timer = { date: todayText(), courseId: "", running: false, startedAt: 0, elapsedByCourse: {}, baseSeconds: Number(loadPlanner().studySeconds) || 0 };
    }
    timer.elapsedByCourse ||= {};
    if (!Number.isFinite(Number(timer.baseSeconds))) timer.baseSeconds = Number(loadPlanner().studySeconds) || 0;
    return timer;
  }

  function saveTimer(timer) {
    localStorage.setItem(timerKey, JSON.stringify(timer));
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function liveDelta(timer) {
    return timer.running && timer.startedAt ? Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000)) : 0;
  }

  function hydrateCourseSelect() {
    const select = $("#enhancedTimerCourse");
    if (!select) return;
    const planner = loadPlanner();
    const courses = Array.isArray(planner.courses) ? planner.courses : [];
    const timer = loadTimer();
    const previous = timer.courseId || planner.activeCourseId || courses[0]?.id || "";
    select.innerHTML = courses.length
      ? courses.map((course) => `<option value="${course.id}">${escapeText(course.name || "이름 없는 과목")}</option>`).join("")
      : '<option value="">등록된 과목이 없습니다</option>';
    select.value = courses.some((course) => course.id === previous) ? previous : courses[0]?.id || "";
    timer.courseId = select.value;
    select.disabled = timer.running || !courses.length;
    saveTimer(timer);
  }

  function escapeText(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function renderTimer() {
    const display = $("#enhancedTimerDisplay");
    if (!display) return;
    const timer = loadTimer();
    const courseId = timer.courseId || $("#enhancedTimerCourse")?.value || "";
    const courseSeconds = (Number(timer.elapsedByCourse[courseId]) || 0) + (timer.running && timer.courseId === courseId ? liveDelta(timer) : 0);
    const storedCourseSeconds = Object.values(timer.elapsedByCourse).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const totalSeconds = (Number(timer.baseSeconds) || 0) + storedCourseSeconds + liveDelta(timer);
    display.textContent = formatDuration(courseSeconds);
    const total = $("#enhancedStudyTotal");
    if (total) total.textContent = `오늘 전체 ${formatDuration(totalSeconds)} · 선택 과목 ${formatDuration(courseSeconds)}`;
    const dashboardTotal = $("#totalStudyTime");
    if (dashboardTotal) dashboardTotal.textContent = formatDuration(totalSeconds);
    const start = $("#enhancedStartTimer");
    const pause = $("#enhancedPauseTimer");
    const select = $("#enhancedTimerCourse");
    if (start) start.disabled = timer.running || !courseId;
    if (pause) pause.disabled = !timer.running;
    if (select) select.disabled = timer.running || !select.options.length || !select.value;
  }

  function startTimer() {
    const timer = loadTimer();
    if (timer.running) return;
    const courseId = $("#enhancedTimerCourse")?.value || timer.courseId;
    if (!courseId) return;
    timer.courseId = courseId;
    timer.running = true;
    timer.startedAt = Date.now();
    saveTimer(timer);
    if (!ticker) ticker = setInterval(renderTimer, 500);
    renderTimer();
  }

  function pauseTimer() {
    const timer = loadTimer();
    if (!timer.running) return;
    const delta = liveDelta(timer);
    const courseId = timer.courseId;
    timer.elapsedByCourse[courseId] = (Number(timer.elapsedByCourse[courseId]) || 0) + delta;
    timer.running = false;
    timer.startedAt = 0;
    saveTimer(timer);

    const planner = loadPlanner();
    planner.studyDate = todayText();
    const storedCourseSeconds = Object.values(timer.elapsedByCourse).reduce((sum, value) => sum + (Number(value) || 0), 0);
    planner.studySeconds = (Number(timer.baseSeconds) || 0) + storedCourseSeconds;
    const course = Array.isArray(planner.courses) ? planner.courses.find((item) => item.id === courseId) : null;
    if (course) course.studySeconds = (Number(course.studySeconds) || 0) + delta;
    savePlanner(planner);
    clearInterval(ticker);
    ticker = null;
    hydrateCourseSelect();
    renderTimer();
  }

  function setupTimer() {
    if (!$("#enhancedTimerDisplay")) return;
    hydrateCourseSelect();
    const timer = loadTimer();
    if (timer.running && !ticker) ticker = setInterval(renderTimer, 500);
    $("#enhancedStartTimer")?.addEventListener("click", startTimer);
    $("#enhancedPauseTimer")?.addEventListener("click", pauseTimer);
    $("#enhancedTimerCourse")?.addEventListener("change", (event) => {
      const current = loadTimer();
      if (current.running) return;
      current.courseId = event.target.value;
      saveTimer(current);
      renderTimer();
    });
    const courseTabs = $("#courseTabs");
    courseTabs?.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-course-id]");
      if (!tab) return;
      setTimeout(() => {
        const current = loadTimer();
        if (current.running) return;
        current.courseId = tab.dataset.courseId;
        saveTimer(current);
        hydrateCourseSelect();
        renderTimer();
      }, 0);
    });
    if (courseTabs) {
      new MutationObserver(() => {
        hydrateCourseSelect();
        renderTimer();
      }).observe(courseTabs, { childList: true });
    }
    renderTimer();
  }

  function parseDate(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function renderCompactDates(centerValue) {
    const carousel = $("#compactDateCarousel");
    if (!carousel) return;
    const center = parseDate(centerValue || $("#calendarDatePicker")?.value || todayText());
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    carousel.innerHTML = Array.from({ length: 5 }, (_, index) => {
      const offset = index - 2;
      const date = new Date(center);
      date.setDate(center.getDate() + offset);
      const value = toDateText(date);
      return `<button class="compact-date-item ${offset === 0 ? "active" : ""}" type="button" data-compact-date="${value}"><span>${weekdays[date.getDay()]}</span><strong>${date.getDate()}</strong><small>${date.getMonth() + 1}월</small></button>`;
    }).join("");
  }

  function chooseCalendarDate(value) {
    const picker = $("#calendarDatePicker");
    if (!picker) return;
    picker.value = value;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(() => renderCompactDates(value), 0);
  }

  function setupCompactCalendar() {
    const carousel = $("#compactDateCarousel");
    if (!carousel) return;
    renderCompactDates(todayText());
    carousel.addEventListener("click", (event) => {
      const button = event.target.closest("[data-compact-date]");
      if (button) chooseCalendarDate(button.dataset.compactDate);
    });
    $("#toggleCalendar")?.addEventListener("click", () => {
      setTimeout(() => {
        if (!$("#collapsedDateBar")?.hidden) chooseCalendarDate(todayText());
      }, 0);
    });
    $("#calendarDatePicker")?.addEventListener("change", (event) => renderCompactDates(event.target.value));
    $("#calendarGrid")?.addEventListener("click", (event) => {
      const day = event.target.closest("[data-date]");
      if (day) setTimeout(() => renderCompactDates(day.dataset.date), 0);
    });
  }

  setupTimer();
  setupCompactCalendar();
})();
