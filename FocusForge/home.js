import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_SETTINGS = Object.freeze({
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  sound: true,
  ambient: false,
  autoBreak: false,
  theme: "dark"
});
const SUBJECTS = ["Toán", "Tiếng Anh", "Lập trình", "Vật lý", "Khác"];
const PRIORITIES = ["high", "medium", "low"];
const PRIORITY_LABELS = { high: "Cao", medium: "Vừa", low: "Thấp" };
const MODE_LABELS = { focus: "TẬP TRUNG", short: "NGHỈ NGẮN", long: "NGHỈ DÀI" };
const MODE_SUBTITLES = { focus: "một việc tại một thời điểm", short: "đứng dậy và thả lỏng", long: "nghỉ ngơi trước khi quay lại" };

let currentUser = null;
let data = { tasks: [], sessions: [], settings: { ...DEFAULT_SETTINGS }, updatedAt: 0 };
let isHydrating = false;
let cloudSaveTimer = null;
let cloudSyncChain = Promise.resolve();
let taskFilter = "all";
let editingTaskId = null;
let activeTaskId = null;
let plannerSelectedDate = dateKey(new Date());
let timerMode = "focus";
let secondsLeft = DEFAULT_SETTINGS.focusMinutes * 60;
let timerTotalSeconds = secondsLeft;
let timerTargetAt = null;
let timerInterval = null;
let timerStartedAt = null;
let toastTimeout = null;
let autoTransitionTimeout = null;
let ambientContext = null;
let ambientSource = null;
let ambientGain = null;

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDate(value, options = { day: "numeric", month: "short" }) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", options).format(date);
}

function defaultTasks() {
  return [
    { id: "task-1", text: "Ôn lại ghi chú buổi học", subject: "Khác", priority: "medium", minutes: 15, dueDate: "", done: false, completedAt: null, createdAt: Date.now() },
    { id: "task-2", text: "Hoàn thành một bài tập", subject: "Toán", priority: "high", minutes: 25, dueDate: "", done: false, completedAt: null, createdAt: Date.now() + 1 },
    { id: "task-3", text: "Tóm tắt điều vừa học", subject: "Tiếng Anh", priority: "low", minutes: 10, dueDate: "", done: false, completedAt: null, createdAt: Date.now() + 2 }
  ];
}

function normalizeTask(task, index = 0) {
  const safe = task && typeof task === "object" ? task : {};
  const subject = SUBJECTS.includes(safe.subject) ? safe.subject : "Khác";
  const priority = PRIORITIES.includes(safe.priority) ? safe.priority : "medium";
  const minutes = Number(safe.minutes);
  return {
    id: String(safe.id || `task-${Date.now()}-${index}`),
    text: String(safe.text || "Nhiệm vụ chưa đặt tên").trim().slice(0, 120),
    subject,
    priority,
    minutes: Number.isFinite(minutes) ? Math.max(1, Math.min(180, Math.round(minutes))) : 15,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(safe.dueDate || "")) ? String(safe.dueDate) : "",
    done: Boolean(safe.done),
    completedAt: Number.isFinite(Number(safe.completedAt)) && Number(safe.completedAt) > 0 ? Number(safe.completedAt) : null,
    createdAt: Number(safe.createdAt) || Date.now() + index
  };
}

function normalizeSession(session, index = 0) {
  const safe = session && typeof session === "object" ? session : {};
  const completedAt = Number(safe.completedAt) || Date.now();
  const parsedMinutes = Number(safe.minutes);
  return {
    id: String(safe.id || `session-${completedAt}-${index}`),
    startedAt: Number(safe.startedAt) || completedAt - 25 * 60 * 1000,
    completedAt,
    minutes: Number.isFinite(parsedMinutes) ? Math.max(1, Math.min(180, Math.round(parsedMinutes))) : 25,
    mode: "focus",
    taskId: safe.taskId ? String(safe.taskId) : "",
    taskText: String(safe.taskText || "Phiên tập trung").slice(0, 120)
  };
}

function normalizeData(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rawTasks = Array.isArray(raw) ? raw : source.tasks;
  const rawSessions = Array.isArray(source.sessions) ? source.sessions : [];
  const rawSettings = source.settings && typeof source.settings === "object" ? source.settings : {};
  const settings = {
    focusMinutes: [15, 25, 30, 45, 50].includes(Number(rawSettings.focusMinutes)) ? Number(rawSettings.focusMinutes) : DEFAULT_SETTINGS.focusMinutes,
    shortBreakMinutes: [3, 5, 10].includes(Number(rawSettings.shortBreakMinutes)) ? Number(rawSettings.shortBreakMinutes) : DEFAULT_SETTINGS.shortBreakMinutes,
    longBreakMinutes: [10, 15, 20, 30].includes(Number(rawSettings.longBreakMinutes)) ? Number(rawSettings.longBreakMinutes) : DEFAULT_SETTINGS.longBreakMinutes,
    longBreakEvery: 4,
    sound: rawSettings.sound !== false,
    ambient: Boolean(rawSettings.ambient),
    autoBreak: Boolean(rawSettings.autoBreak),
    theme: rawSettings.theme === "light" ? "light" : "dark"
  };
  return {
    tasks: (Array.isArray(rawTasks) ? rawTasks : defaultTasks()).slice(0, 200).map(normalizeTask),
    sessions: rawSessions.slice(-250).map(normalizeSession),
    settings,
    updatedAt: Number(source.updatedAt) || 0
  };
}

function storageKey(user = currentUser) {
  return user ? `focusforge_data_${user.uid}` : "focusforge_data_guest";
}

function legacyStorageKey(user = currentUser) {
  return user ? `focusforge_tasks_${user.uid}` : "focusforge_tasks_guest";
}

function readLocalData(user) {
  try {
    const saved = localStorage.getItem(storageKey(user));
    if (saved) return normalizeData(JSON.parse(saved));
    // Migrate the original version, which stored only a task array.
    const legacy = localStorage.getItem(legacyStorageKey(user));
    if (legacy) return normalizeData({ tasks: JSON.parse(legacy), sessions: [], settings: { ...DEFAULT_SETTINGS }, updatedAt: 1 });
  } catch (error) {
    console.warn("Could not read FocusForge local data:", error);
  }
  return normalizeData({ tasks: defaultTasks(), sessions: [], settings: { ...DEFAULT_SETTINGS }, updatedAt: 1 });
}

function writeLocalData() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(data));
    return true;
  } catch (error) {
    console.warn("Could not save FocusForge local data:", error);
    setTaskSaveNote("Trình duyệt không cho phép lưu dữ liệu. Hãy kiểm tra dung lượng hoặc quyền riêng tư.");
    return false;
  }
}

function setSyncStatus(kind, message) {
  const root = $("sync-status");
  const text = $("sync-status-text");
  if (text) text.textContent = message;
  if (root) {
    root.classList.remove("is-local", "is-syncing", "is-connected", "is-warning");
    root.classList.add(kind);
  }
  const detail = $("data-status-detail");
  if (detail) detail.textContent = message;
}

function setTaskSaveNote(message) {
  const note = $("task-save-note");
  if (note) note.textContent = message;
}

async function syncToCloud(snapshot = data, userId = currentUser?.uid) {
  if (!userId || currentUser?.uid !== userId || isHydrating) return;
  const uidAtStart = userId;
  setSyncStatus("is-syncing", "Đang đồng bộ với Firebase…");
  try {
    const ref = doc(db, "users", uidAtStart, "focusforge", "workspace");
    await setDoc(ref, {
      tasks: snapshot.tasks.slice(0, 200),
      sessions: snapshot.sessions.slice(-250),
      settings: snapshot.settings,
      updatedAt: snapshot.updatedAt || Date.now(),
      serverUpdatedAt: serverTimestamp()
    }, { merge: true });
    if (currentUser?.uid === uidAtStart) {
      setSyncStatus("is-connected", "Đã đồng bộ với Firebase");
      setTaskSaveNote("Đã lưu trên thiết bị và đồng bộ với tài khoản Firebase này.");
    }
  } catch (error) {
    console.warn("FocusForge cloud sync unavailable; local save is still active:", error);
    if (currentUser?.uid === uidAtStart) {
      setSyncStatus("is-warning", "Đang lưu cục bộ · Firestore chưa sẵn sàng");
      setTaskSaveNote("Dữ liệu vẫn được lưu trên trình duyệt. Bật Firestore và cấu hình Rules để đồng bộ giữa các thiết bị.");
    }
  }
}

function queueCloudSave(delay = 700) {
  if (!currentUser || isHydrating) return;
  const userId = currentUser.uid;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    const snapshot = JSON.parse(JSON.stringify(data));
    // Keep writes ordered so a slow older request cannot overwrite a newer workspace snapshot.
    cloudSyncChain = cloudSyncChain.then(() => syncToCloud(snapshot, userId)).catch((error) => {
      console.warn("Unexpected cloud sync queue error:", error);
    });
  }, delay);
}

function saveData({ sync = true } = {}) {
  data.updatedAt = Date.now();
  writeLocalData();
  renderDashboard();
  renderPlanner();
  if (sync) queueCloudSave();
}

async function hydrateWorkspace(user) {
  isHydrating = true;
  clearTimeout(cloudSaveTimer);
  data = readLocalData(user);
  renderAll();
  applySettingsToUI();
  setSyncStatus(user ? "is-syncing" : "is-local", user ? "Đang kiểm tra dữ liệu Firebase…" : "Đang lưu trên thiết bị này");

  if (user) {
    try {
      const ref = doc(db, "users", user.uid, "focusforge", "workspace");
      const snapshot = await getDoc(ref);
      if (currentUser?.uid !== user.uid) return;
      if (snapshot.exists()) {
        const remoteData = normalizeData(snapshot.data());
        if (remoteData.updatedAt > data.updatedAt) {
          data = remoteData;
          writeLocalData();
        } else if (data.updatedAt > remoteData.updatedAt) {
          isHydrating = false;
          await syncToCloud(data);
          isHydrating = true;
        }
        setSyncStatus("is-connected", "Đã kết nối dữ liệu Firebase");
        setTaskSaveNote("Nhiệm vụ và lịch sử đang được lưu cho tài khoản của bạn.");
      } else {
        isHydrating = false;
        await syncToCloud(data);
        isHydrating = true;
      }
    } catch (error) {
      console.warn("Could not load Firestore data; continuing with local data:", error);
      setSyncStatus("is-warning", "Đang lưu cục bộ · Firestore chưa sẵn sàng");
      setTaskSaveNote("Đăng nhập thành công. Dữ liệu hiện lưu trên trình duyệt cho đến khi Firestore được bật và cấp quyền.");
    }
  }
  if ((currentUser?.uid || null) !== (user?.uid || null)) return;
  isHydrating = false;
  if (!data.updatedAt) data.updatedAt = Date.now();
  writeLocalData();
  renderAll();
  applySettingsToUI();
  if (!user) setSyncStatus("is-local", "Đang lưu trên thiết bị này");
}

const navAuth = $("nav-auth");
const navUser = $("nav-user");
const navUserEmail = $("nav-user-email");
const heroGreeting = $("hero-greeting");
const logoutButton = $("logout-btn");

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;
  if (user) {
    navAuth?.classList.add("hidden");
    navUser?.classList.remove("hidden");
    navUserEmail.textContent = user.displayName || user.email || "Tài khoản";
    heroGreeting.textContent = `Chào ${user.displayName || "bạn"}, bắt đầu nhé!`;
    $("profile-name-label").textContent = user.displayName || user.email || "Tài khoản";
  } else {
    navUser?.classList.add("hidden");
    navAuth?.classList.remove("hidden");
    heroGreeting.textContent = "Sẵn sàng vào guồng?";
    $("profile-name-label").textContent = "Chưa đăng nhập — đăng nhập để đồng bộ dữ liệu";
  }
  void hydrateWorkspace(currentUser);
});

logoutButton?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    showToast("Bạn đã đăng xuất. Dữ liệu cục bộ vẫn được giữ nguyên.");
  } catch (error) {
    showToast("Không thể đăng xuất. Vui lòng thử lại.");
    console.error("Sign-out error:", error);
  }
});

function showToast(message) {
  const toast = $("app-toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

// --------------------------- Tasks ------------------------------------------
const taskList = $("task-list");
const taskCount = $("task-count");
const progressFill = $("task-progress-fill");
const progressText = $("task-progress-text");
const taskSaveNote = $("task-save-note");
const taskSearch = $("task-search");
const taskSubjectFilter = $("task-subject-filter");
const taskForm = $("add-task-form");
const taskInput = $("new-task");
const taskSubjectInput = $("new-task-subject");
const taskPriorityInput = $("new-task-priority");
const taskMinutesInput = $("new-task-minutes");
const taskDueInput = $("new-task-due");
const taskSubmitButton = $("task-submit");
const taskCancelButton = $("task-cancel-edit");

function priorityRank(priority) {
  return ({ high: 0, medium: 1, low: 2 })[priority] ?? 1;
}

function createTaskButton(label, className, action, title = label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", action);
  return button;
}

function renderTasks() {
  if (!taskList) return;
  taskList.replaceChildren();
  const query = (taskSearch?.value || "").trim().toLocaleLowerCase("vi");
  const subject = taskSubjectFilter?.value || "all";
  const filtered = data.tasks.filter((task) => {
    const filterMatch = taskFilter === "all" || (taskFilter === "active" && !task.done) || (taskFilter === "done" && task.done);
    const searchMatch = !query || `${task.text} ${task.subject}`.toLocaleLowerCase("vi").includes(query);
    const subjectMatch = subject === "all" || task.subject === subject;
    return filterMatch && searchMatch && subjectMatch;
  }).sort((a, b) => {
    if (a.done !== b.done) return Number(a.done) - Number(b.done);
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    const rankDiff = priorityRank(a.priority) - priorityRank(b.priority);
    return rankDiff || a.createdAt - b.createdAt;
  });

  filtered.forEach((task) => {
    const item = document.createElement("li");
    item.className = `task-item task-item-enhanced${task.done ? " is-done" : ""}${task.id === activeTaskId ? " is-selected" : ""}`;
    const main = document.createElement("div");
    main.className = "task-main-row";
    const label = document.createElement("label");
    label.className = "task-check-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `Hoàn thành: ${task.text}`);
    const check = document.createElement("span");
    check.className = "custom-check";
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      task.completedAt = task.done ? Date.now() : null;
      if (task.done && activeTaskId === task.id) activeTaskId = null;
      saveData();
      renderTasks();
      renderPlanner();
    });
    const textWrap = document.createElement("span");
    textWrap.className = "task-copy";
    const title = document.createElement("span");
    title.className = "task-text";
    title.textContent = task.text;
    const meta = document.createElement("span");
    meta.className = "task-meta";
    const subjectChip = document.createElement("span");
    subjectChip.className = "task-meta-chip subject-chip";
    subjectChip.textContent = task.subject;
    const priorityChip = document.createElement("span");
    priorityChip.className = `task-meta-chip priority-${task.priority}`;
    priorityChip.textContent = `Ưu tiên ${PRIORITY_LABELS[task.priority]}`;
    const durationChip = document.createElement("span");
    durationChip.className = "task-meta-chip";
    durationChip.textContent = `${task.minutes} phút`;
    meta.append(subjectChip, priorityChip, durationChip);
    if (task.dueDate) {
      const due = document.createElement("span");
      due.className = `task-meta-chip due-chip${!task.done && task.dueDate < dateKey(new Date()) ? " is-overdue" : ""}`;
      due.textContent = `Hạn ${formatDate(dateFromKey(task.dueDate))}`;
      meta.append(due);
    }
    textWrap.append(title, meta);
    label.append(checkbox, check, textWrap);
    main.append(label);

    const actions = document.createElement("div");
    actions.className = "task-actions";
    actions.append(
      createTaskButton("▶", "task-action-button task-focus-button", () => startTask(task.id), `Tập trung vào: ${task.text}`),
      createTaskButton("✎", "task-action-button", () => beginEditTask(task.id), `Chỉnh sửa: ${task.text}`),
      createTaskButton("×", "task-action-button task-delete-button", () => deleteTask(task.id), `Xóa: ${task.text}`)
    );
    item.append(main, actions);
    taskList.append(item);
  });

  $("empty-tasks").classList.toggle("hidden", filtered.length > 0);
  const completed = data.tasks.filter((task) => task.done).length;
  const percent = data.tasks.length ? Math.round(completed / data.tasks.length * 100) : 0;
  taskCount.textContent = `${completed}/${data.tasks.length}`;
  progressText.textContent = `${percent}% hoàn thành`;
  progressFill.style.width = `${percent}%`;
  progressFill.setAttribute("aria-valuenow", String(percent));
  $("task-form-heading").textContent = editingTaskId ? "Chỉnh sửa nhiệm vụ" : "Thêm nhiệm vụ mới";
  taskSubmitButton.textContent = editingTaskId ? "✓ Lưu thay đổi" : "＋ Thêm nhiệm vụ";
  taskCancelButton.classList.toggle("hidden", !editingTaskId);
  if (!isHydrating) renderDashboard();
  window.focusForgeGetTasks = () => data.tasks.map((task) => ({
    id: task.id, text: task.text, subject: task.subject, priority: PRIORITY_LABELS[task.priority],
    minutes: task.minutes, dueDate: task.dueDate, done: task.done
  }));
}

function resetTaskForm() {
  editingTaskId = null;
  taskForm.reset();
  taskSubjectInput.value = "Toán";
  taskPriorityInput.value = "medium";
  taskMinutesInput.value = "15";
  taskDueInput.value = "";
  $("task-form-heading").textContent = "Thêm nhiệm vụ mới";
  taskSubmitButton.textContent = "＋ Thêm nhiệm vụ";
  taskCancelButton.classList.add("hidden");
}

function beginEditTask(id) {
  const task = data.tasks.find((item) => item.id === id);
  if (!task) return;
  editingTaskId = id;
  taskInput.value = task.text;
  taskSubjectInput.value = task.subject;
  taskPriorityInput.value = task.priority;
  taskMinutesInput.value = String(task.minutes);
  taskDueInput.value = task.dueDate;
  renderTasks();
  taskInput.focus();
  taskForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function deleteTask(id) {
  const task = data.tasks.find((item) => item.id === id);
  if (!task) return;
  if (!window.confirm(`Xóa nhiệm vụ “${task.text}”?`)) return;
  data.tasks = data.tasks.filter((item) => item.id !== id);
  if (activeTaskId === id) activeTaskId = null;
  if (editingTaskId === id) resetTaskForm();
  saveData();
  renderTasks();
  renderPlanner();
  renderSelectedTask();
  showToast("Đã xóa nhiệm vụ.");
}

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = taskInput.value.trim();
  if (!text) {
    taskInput.focus();
    return;
  }
  const taskValues = {
    text: text.slice(0, 120),
    subject: SUBJECTS.includes(taskSubjectInput.value) ? taskSubjectInput.value : "Khác",
    priority: PRIORITIES.includes(taskPriorityInput.value) ? taskPriorityInput.value : "medium",
    minutes: Number(taskMinutesInput.value) || 15,
    dueDate: taskDueInput.value || ""
  };
  if (editingTaskId) {
    const task = data.tasks.find((item) => item.id === editingTaskId);
    if (task) Object.assign(task, taskValues);
    showToast("Đã cập nhật nhiệm vụ.");
  } else {
    if (data.tasks.length >= 200) {
      showToast("Bạn đã đạt giới hạn 200 nhiệm vụ trong danh sách. Hãy hoàn thành hoặc xóa bớt nhiệm vụ.");
      return;
    }
    data.tasks.push({ id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...taskValues, done: false, completedAt: null, createdAt: Date.now() });
    showToast("Đã thêm nhiệm vụ mới.");
  }
  saveData();
  resetTaskForm();
  renderTasks();
  renderPlanner();
});

taskCancelButton.addEventListener("click", resetTaskForm);
taskSearch.addEventListener("input", renderTasks);
taskSubjectFilter.addEventListener("change", renderTasks);
document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    taskFilter = button.dataset.filter || "all";
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderTasks();
  });
});

// --------------------------- Timer ------------------------------------------
const timerDisplay = $("timer-display");
const timerStartButton = $("timer-start");
const timerResetButton = $("timer-reset");
const timerNote = $("timer-note");
const timerCircle = $("timer-circle");

function minutesForMode(mode = timerMode) {
  if (mode === "short") return data.settings.shortBreakMinutes;
  if (mode === "long") return data.settings.longBreakMinutes;
  return data.settings.focusMinutes;
}

function renderSelectedTask() {
  const task = data.tasks.find((item) => item.id === activeTaskId && !item.done);
  $("selected-task-name").textContent = task ? task.text : "Chưa chọn nhiệm vụ";
  $("clear-selected-task").classList.toggle("hidden", !task);
}

function updateTimerDisplay() {
  const safeSeconds = Math.max(0, Math.ceil(secondsLeft));
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, "0");
  const seconds = (safeSeconds % 60).toString().padStart(2, "0");
  timerDisplay.textContent = `${minutes}:${seconds}`;
  $("hero-timer").textContent = `${minutes}:${seconds}`;
  const elapsed = Math.max(0, timerTotalSeconds - safeSeconds);
  const degrees = timerTotalSeconds ? Math.min(360, Math.round(elapsed / timerTotalSeconds * 360)) : 0;
  timerCircle?.style.setProperty("--timer-progress", `${degrees}deg`);
  $("hero-focus-ring")?.style.setProperty("--hero-timer-progress", `${degrees}deg`);
  document.title = timerInterval ? `${minutes}:${seconds} · FocusForge` : "FocusForge — Tập trung có chiến lược";
}

function setTimerMode(mode, reset = true) {
  clearTimeout(autoTransitionTimeout);
  autoTransitionTimeout = null;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  timerTargetAt = null;
  timerStartedAt = null;
  timerMode = ["focus", "short", "long"].includes(mode) ? mode : "focus";
  if (reset) {
    timerTotalSeconds = minutesForMode(timerMode) * 60;
    secondsLeft = timerTotalSeconds;
  }
  $("timer-mode").textContent = MODE_LABELS[timerMode];
  $("timer-subtitle").textContent = MODE_SUBTITLES[timerMode];
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === timerMode));
  timerStartButton.textContent = timerMode === "focus" ? "▶ Bắt đầu tập trung" : "▶ Bắt đầu nghỉ";
  updateTimerDisplay();
}

function setAmbientSound(enabled) {
  if (!enabled) {
    try {
      if (ambientGain && ambientContext) {
        ambientGain.gain.setTargetAtTime(0, ambientContext.currentTime, 0.12);
      }
      if (ambientSource) ambientSource.stop(ambientContext ? ambientContext.currentTime + 0.4 : undefined);
    } catch (_) { /* It may already have stopped. */ }
    ambientSource = null;
    ambientGain = null;
    if (ambientContext) {
      const contextToClose = ambientContext;
      ambientContext = null;
      setTimeout(() => contextToClose.close().catch(() => {}), 500);
    }
    return;
  }
  if (ambientSource) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      showToast("Trình duyệt này chưa hỗ trợ âm nền.");
      return;
    }
    ambientContext = new AudioContextClass();
    const sampleRate = ambientContext.sampleRate;
    const buffer = ambientContext.createBuffer(1, sampleRate * 3, sampleRate);
    const channel = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < channel.length; i += 1) {
      const white = Math.random() * 2 - 1;
      previous = (previous + 0.018 * white) / 1.018;
      channel[i] = previous * 3.5;
    }
    ambientSource = ambientContext.createBufferSource();
    ambientSource.buffer = buffer;
    ambientSource.loop = true;
    const lowPass = ambientContext.createBiquadFilter();
    lowPass.type = "lowpass";
    lowPass.frequency.value = 900;
    ambientGain = ambientContext.createGain();
    ambientGain.gain.value = 0.035;
    ambientSource.connect(lowPass);
    lowPass.connect(ambientGain);
    ambientGain.connect(ambientContext.destination);
    ambientSource.start();
    if (ambientContext.state === "suspended") void ambientContext.resume();
    showToast("Đã bật âm nền nhẹ. Bạn có thể tắt trong tùy chỉnh phiên học.");
  } catch (error) {
    console.warn("Could not start ambient audio:", error);
    ambientSource = null;
    ambientGain = null;
    showToast("Không thể phát âm nền trong trình duyệt này.");
  }
}

function playCompletionSound() {
  if (!data.settings.sound) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    [659.25, 783.99, 987.77].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, context.currentTime + index * 0.13);
      gain.gain.exponentialRampToValueAtTime(0.13, context.currentTime + index * 0.13 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + index * 0.13 + 0.22);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime + index * 0.13);
      oscillator.stop(context.currentTime + index * 0.13 + 0.24);
    });
    setTimeout(() => context.close().catch(() => {}), 850);
  } catch (error) {
    console.debug("Completion sound was unavailable:", error);
  }
}

function todaySessions() {
  const today = dateKey(new Date());
  return data.sessions.filter((session) => dateKey(new Date(session.completedAt)) === today);
}

function recordCompletedFocusSession() {
  const task = data.tasks.find((item) => item.id === activeTaskId);
  data.sessions.push({
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    startedAt: timerStartedAt || (Date.now() - timerTotalSeconds * 1000),
    completedAt: Date.now(),
    minutes: Math.max(1, Math.round(timerTotalSeconds / 60)),
    mode: "focus",
    taskId: task?.id || "",
    taskText: task?.text || "Phiên tập trung"
  });
  data.sessions = data.sessions.slice(-250);
  saveData();
  renderSessionHistory();
  playCompletionSound();
  showToast("Hoàn thành một phiên tập trung. Làm tốt lắm!");
}

function finishTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerTargetAt = null;
  secondsLeft = 0;
  updateTimerDisplay();
  timerStartButton.textContent = "↻ Bắt đầu lại";
  if (timerMode === "focus") {
    recordCompletedFocusSession();
    const count = todaySessions().length;
    timerNote.textContent = count > 0 ? `Bạn vừa hoàn thành phiên tập trung thứ ${count} hôm nay. Hãy nghỉ một chút nhé.` : "Hoàn thành một phiên tập trung! Hãy nghỉ ngắn rồi tiếp tục.";
    window.dispatchEvent(new CustomEvent("focusforge:session-complete", { detail: { sessionsToday: count } }));
    if (data.settings.autoBreak) {
      const nextBreak = count > 0 && count % data.settings.longBreakEvery === 0 ? "long" : "short";
      autoTransitionTimeout = setTimeout(() => {
        setTimerMode(nextBreak, true);
        timerNote.textContent = nextBreak === "long" ? "Đã đến lúc nghỉ dài. Để mắt và đầu óc được thư giãn." : "Bắt đầu giờ nghỉ ngắn tự động. Đứng dậy và thả lỏng nhé.";
        startTimer();
      }, 1100);
    }
  } else {
    timerNote.textContent = "Thời gian nghỉ đã kết thúc. Khi sẵn sàng, hãy quay lại tập trung.";
    if (data.settings.autoBreak) {
      autoTransitionTimeout = setTimeout(() => {
        setTimerMode("focus", true);
        timerNote.textContent = "Giờ nghỉ đã xong. Sẵn sàng cho một phiên tập trung mới?";
        startTimer();
      }, 1100);
    }
    playCompletionSound();
  }
}

function tickTimer() {
  if (!timerTargetAt) return;
  secondsLeft = Math.max(0, Math.ceil((timerTargetAt - Date.now()) / 1000));
  updateTimerDisplay();
  if (secondsLeft <= 0) finishTimer();
}

function startTimer() {
  clearTimeout(autoTransitionTimeout);
  autoTransitionTimeout = null;
  if (timerInterval) {
    tickTimer();
    if (!timerInterval) return;
    clearInterval(timerInterval);
    timerInterval = null;
    timerTargetAt = null;
    timerStartButton.textContent = "▶ Tiếp tục";
    timerNote.textContent = "Đã tạm dừng. Tiếp tục khi bạn sẵn sàng.";
    updateTimerDisplay();
    return;
  }
  if (secondsLeft <= 0) {
    timerTotalSeconds = minutesForMode(timerMode) * 60;
    secondsLeft = timerTotalSeconds;
    timerStartedAt = null;
  }
  if (timerMode === "focus" && !timerStartedAt) timerStartedAt = Date.now();
  timerTargetAt = Date.now() + secondsLeft * 1000;
  timerInterval = setInterval(tickTimer, 250);
  timerStartButton.textContent = "Ⅱ Tạm dừng";
  timerNote.textContent = timerMode === "focus" ? "Bạn đang trong phiên tập trung. Hãy làm một việc tại một thời điểm." : "Hãy nghỉ ngơi thật sự; bạn đã làm việc chăm chỉ rồi.";
  updateTimerDisplay();
}

timerStartButton.addEventListener("click", startTimer);
timerResetButton.addEventListener("click", () => {
  setTimerMode(timerMode, true);
  timerNote.textContent = "Đã đặt lại bộ đếm. Bắt đầu khi bạn sẵn sàng.";
});

$("focus-mode-toggle").addEventListener("click", async () => {
  const panel = document.querySelector(".timer-panel");
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (panel?.requestFullscreen) {
      await panel.requestFullscreen();
      timerNote.textContent = "Chế độ toàn màn hình: chỉ giữ sự chú ý vào phiên hiện tại.";
    } else {
      document.body.classList.toggle("focus-mode-active");
    }
  } catch (error) {
    console.warn("Fullscreen unavailable:", error);
    document.body.classList.toggle("focus-mode-active");
  }
});
document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    if (timerInterval) {
      showToast("Hãy tạm dừng phiên hiện tại trước khi đổi chế độ.");
      return;
    }
    setTimerMode(button.dataset.mode, true);
    timerNote.textContent = timerMode === "focus" ? "Chọn một nhiệm vụ rồi bắt đầu tập trung." : "Một khoảng nghỉ ngắn cũng là một phần của tiến bộ.";
  });
});

function startTask(id) {
  const task = data.tasks.find((item) => item.id === id && !item.done);
  if (!task) return;
  const switchingTask = id !== activeTaskId;
  const focusSessionInProgress = timerMode === "focus" && Boolean(timerStartedAt) && secondsLeft > 0;

  if (switchingTask && focusSessionInProgress) {
    const proceed = window.confirm("Bạn đang ở giữa một phiên tập trung. Đặt lại bộ đếm để chuyển sang nhiệm vụ mới?");
    if (!proceed) return;
    setTimerMode("focus", true);
  } else if (timerInterval && switchingTask) {
    clearInterval(timerInterval);
    timerInterval = null;
    timerTargetAt = null;
  } else if (timerInterval && !switchingTask && timerMode === "focus") {
    showToast("Bạn đang tập trung vào nhiệm vụ này rồi.");
    return;
  }

  activeTaskId = id;
  renderSelectedTask();
  renderTasks();
  if (timerMode !== "focus") setTimerMode("focus", true);
  if (secondsLeft <= 0) setTimerMode("focus", true);
  timerNote.textContent = `Mục tiêu hiện tại: ${task.text}. Bạn làm được!`;
  startTimer();
  $("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("clear-selected-task").addEventListener("click", () => {
  activeTaskId = null;
  renderSelectedTask();
  renderTasks();
});

// --------------------------- Settings ---------------------------------------
function applyTheme() {
  document.documentElement.dataset.theme = data.settings.theme === "light" ? "light" : "dark";
  const icon = $("theme-toggle-icon");
  if (icon) icon.textContent = data.settings.theme === "light" ? "☾" : "☼";
  const label = data.settings.theme === "light" ? "Chuyển sang giao diện tối" : "Chuyển sang giao diện sáng";
  $("theme-toggle")?.setAttribute("aria-label", label);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", data.settings.theme === "light" ? "#f4f6fb" : "#0b1020");
}

function applySettingsToUI() {
  $("setting-focus").value = String(data.settings.focusMinutes);
  $("setting-short").value = String(data.settings.shortBreakMinutes);
  $("setting-long").value = String(data.settings.longBreakMinutes);
  $("setting-sound").checked = Boolean(data.settings.sound);
  $("setting-ambient").checked = Boolean(data.settings.ambient);
  $("setting-auto-break").checked = Boolean(data.settings.autoBreak);
  // Browsers generally block autoplay. Ambient sound is enabled only after an explicit user action.
  if (data.settings.ambient && !ambientSource) {
    data.settings.ambient = false;
    $("setting-ambient").checked = false;
  }
  applyTheme();
  if (!timerInterval) setTimerMode(timerMode, true);
}

function settingsChanged(event) {
  data.settings = {
    ...data.settings,
    focusMinutes: Number($("setting-focus").value) || 25,
    shortBreakMinutes: Number($("setting-short").value) || 5,
    longBreakMinutes: Number($("setting-long").value) || 15,
    sound: $("setting-sound").checked,
    ambient: $("setting-ambient").checked,
    autoBreak: $("setting-auto-break").checked
  };
  if (!timerInterval) setTimerMode(timerMode, true);
  if (event?.target?.id === "setting-ambient") setAmbientSound(data.settings.ambient);
  saveData();
  showToast("Đã lưu tùy chỉnh của bạn.");
}

["setting-focus", "setting-short", "setting-long", "setting-sound", "setting-ambient", "setting-auto-break"].forEach((id) => $(id).addEventListener("change", settingsChanged));

function toggleTheme() {
  data.settings.theme = data.settings.theme === "light" ? "dark" : "light";
  applyTheme();
  saveData();
}
$("theme-toggle").addEventListener("click", toggleTheme);
$("settings-theme-toggle").addEventListener("click", toggleTheme);

$("profile-settings").addEventListener("click", () => {
  const settings = $("account-settings").querySelector("details");
  settings.open = true;
  $("account-settings").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("change-display-name").addEventListener("click", async () => {
  if (!currentUser) {
    showToast("Hãy đăng nhập để thay đổi tên hiển thị.");
    return;
  }
  const name = window.prompt("Tên hiển thị mới của bạn:", currentUser.displayName || "");
  if (name === null) return;
  const cleaned = name.trim().slice(0, 60);
  if (!cleaned) {
    showToast("Tên hiển thị không được để trống.");
    return;
  }
  try {
    await updateProfile(currentUser, { displayName: cleaned });
    navUserEmail.textContent = cleaned;
    heroGreeting.textContent = `Chào ${cleaned}, bắt đầu nhé!`;
    $("profile-name-label").textContent = cleaned;
    showToast("Đã cập nhật tên hiển thị.");
  } catch (error) {
    console.error("Profile update error:", error);
    showToast("Không thể cập nhật tên. Hãy thử đăng nhập lại rồi tiếp tục.");
  }
});

$("export-data").addEventListener("click", () => {
  const exportObject = {
    app: "FocusForge",
    exportedAt: new Date().toISOString(),
    profile: currentUser ? { uid: currentUser.uid, displayName: currentUser.displayName || "", email: currentUser.email || "" } : null,
    tasks: data.tasks,
    sessions: data.sessions,
    settings: data.settings
  };
  const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `focusforge-backup-${dateKey(new Date())}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Đã xuất bản sao dữ liệu JSON.");
});

// --------------------------- Dashboard / Analytics --------------------------
function minutesToday() {
  return todaySessions().reduce((sum, session) => sum + session.minutes, 0);
}

function calculateStreak() {
  const recordedDays = new Set(data.sessions.map((session) => dateKey(new Date(session.completedAt))));
  const today = new Date();
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!recordedDays.has(dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!recordedDays.has(dateKey(cursor))) return 0;
  }
  let streak = 0;
  while (recordedDays.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function sessionsForDate(key) {
  return data.sessions.filter((session) => dateKey(new Date(session.completedAt)) === key);
}

function renderWeeklyChart() {
  const chart = $("weekly-chart");
  chart.replaceChildren();
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = dateKey(date);
    const minutes = sessionsForDate(key).reduce((sum, session) => sum + session.minutes, 0);
    days.push({ date, key, minutes });
  }
  const maxMinutes = Math.max(25, ...days.map((day) => day.minutes));
  days.forEach((day) => {
    const column = document.createElement("div");
    column.className = `chart-day${day.key === dateKey(new Date()) ? " is-today" : ""}`;
    const value = document.createElement("span");
    value.className = "chart-day-value";
    value.textContent = day.minutes ? `${day.minutes}m` : "–";
    const track = document.createElement("div");
    track.className = "chart-bar-track";
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${day.minutes ? Math.max(8, day.minutes / maxMinutes * 100) : 4}%`;
    bar.title = `${formatDate(day.date, { weekday: "long", day: "numeric", month: "long" })}: ${day.minutes} phút`;
    track.append(bar);
    const label = document.createElement("span");
    label.className = "chart-day-label";
    label.textContent = new Intl.DateTimeFormat("vi-VN", { weekday: "short" }).format(day.date).replace("Th ", "T");
    column.append(value, track, label);
    chart.append(column);
  });
  const total = days.reduce((sum, day) => sum + day.minutes, 0);
  $("weekly-total").textContent = `${total} phút trong 7 ngày`;
  return total;
}

function renderSessionHistory() {
  const container = $("mini-history");
  container.replaceChildren();
  const recent = [...data.sessions].sort((a, b) => b.completedAt - a.completedAt).slice(0, 3);
  if (!recent.length) {
    const empty = document.createElement("p");
    empty.className = "muted small-note";
    empty.textContent = "Chưa có phiên hoàn thành. Một phiên tập trung đầu tiên sẽ xuất hiện tại đây.";
    container.append(empty);
    return;
  }
  recent.forEach((session) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const icon = document.createElement("span");
    icon.className = "history-check";
    icon.textContent = "✓";
    const copy = document.createElement("div");
    copy.className = "history-copy";
    const title = document.createElement("strong");
    title.textContent = session.taskText || "Phiên tập trung";
    const date = document.createElement("small");
    date.textContent = formatDate(new Date(session.completedAt), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    copy.append(title, date);
    const duration = document.createElement("span");
    duration.className = "history-duration";
    duration.textContent = `${session.minutes}m`;
    row.append(icon, copy, duration);
    container.append(row);
  });
}

function renderDashboard() {
  const mins = minutesToday();
  const sessionCount = todaySessions().length;
  const done = data.tasks.filter((task) => task.done).length;
  const totalTasks = data.tasks.length;
  const streak = calculateStreak();
  $("metric-focus-time").innerHTML = `${mins} <small>phút</small>`;
  $("metric-sessions").textContent = String(sessionCount);
  $("metric-tasks").innerHTML = `${done} <small>/ ${totalTasks}</small>`;
  $("metric-streak").innerHTML = `${streak} <small>ngày</small>`;
  $("metric-focus-foot").textContent = mins >= data.settings.focusMinutes ? `Bạn đã đạt ${Math.floor(mins / data.settings.focusMinutes)} phiên tương đương hôm nay` : `Còn ${Math.max(0, data.settings.focusMinutes - mins)} phút đến mốc ${data.settings.focusMinutes} phút`;
  $("metric-task-foot").textContent = totalTasks ? `${Math.round(done / totalTasks * 100)}% nhiệm vụ đã hoàn thành` : "Thêm một nhiệm vụ đầu tiên";
  $("hero-today-minutes").innerHTML = `${mins}<span class="tiny-unit">m</span>`;
  $("hero-today-tasks").textContent = String(done);
  $("hero-streak").textContent = String(streak);
  const goalPercent = Math.min(100, Math.round(mins / Math.max(1, data.settings.focusMinutes * 4) * 100));
  $("hero-goal-progress").style.width = `${goalPercent}%`;
  $("hero-goal-label").textContent = mins >= data.settings.focusMinutes * 4 ? "Đã đạt mục tiêu" : `${goalPercent}% mục tiêu`;
  const nextTask = data.tasks.find((task) => !task.done);
  if (nextTask) {
    $("insight-title").textContent = nextTask.priority === "high" ? "Ưu tiên việc quan trọng trước" : "Chọn một việc có thể bắt đầu ngay";
    $("insight-description").textContent = `Tiếp theo: ${nextTask.text}. Dự kiến ${nextTask.minutes} phút${nextTask.dueDate ? ` · hạn ${formatDate(dateFromKey(nextTask.dueDate))}` : ""}.`;
  } else {
    $("insight-title").textContent = totalTasks ? "Bạn đã hoàn thành danh sách!" : "Thêm một nhiệm vụ nhỏ";
    $("insight-description").textContent = totalTasks ? "Hãy nghỉ một chút hoặc thêm mục tiêu tiếp theo." : "Viết ra một việc cụ thể bạn muốn hoàn thành hôm nay.";
  }
  renderWeeklyChart();
  renderSessionHistory();
}

// --------------------------- Weekly planner ---------------------------------
function renderPlanner() {
  const daysContainer = $("planner-days");
  if (!daysContainer) return;
  daysContainer.replaceChildren();
  const selected = dateFromKey(plannerSelectedDate) || new Date();
  const today = dateKey(new Date());
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let index = 0; index < 7; index += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const key = dateKey(day);
    const dueCount = data.tasks.filter((task) => task.dueDate === key && !task.done).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `planner-day${key === plannerSelectedDate ? " is-selected" : ""}${key === today ? " is-today" : ""}`;
    button.setAttribute("aria-pressed", String(key === plannerSelectedDate));
    const weekday = document.createElement("span");
    weekday.className = "planner-weekday";
    weekday.textContent = key === today ? "Hôm nay" : new Intl.DateTimeFormat("vi-VN", { weekday: "short" }).format(day);
    const number = document.createElement("strong");
    number.textContent = String(day.getDate());
    const dot = document.createElement("span");
    dot.className = `planner-day-dot${dueCount ? " has-tasks" : ""}`;
    dot.textContent = dueCount ? String(dueCount) : "";
    button.append(weekday, number, dot);
    button.addEventListener("click", () => {
      plannerSelectedDate = key;
      renderPlanner();
    });
    daysContainer.append(button);
  }

  const date = dateFromKey(plannerSelectedDate) || new Date();
  $("agenda-title").textContent = plannerSelectedDate === today ? "Việc đến hạn hôm nay" : `Việc đến hạn · ${formatDate(date, { weekday: "long", day: "numeric", month: "long" })}`;
  const dueTasks = data.tasks.filter((task) => task.dueDate === plannerSelectedDate).sort((a, b) => Number(a.done) - Number(b.done) || priorityRank(a.priority) - priorityRank(b.priority));
  const overdue = plannerSelectedDate === today ? data.tasks.filter((task) => task.dueDate && task.dueDate < today && !task.done) : [];
  const items = [...overdue, ...dueTasks.filter((task) => !overdue.some((overdueTask) => overdueTask.id === task.id))];
  $("agenda-count").textContent = `${items.length} việc`;
  const list = $("planner-agenda-list");
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "agenda-empty";
    const title = document.createElement("strong");
    title.textContent = "Lịch đang thoáng";
    const desc = document.createElement("p");
    desc.textContent = "Không có nhiệm vụ nào đến hạn trong ngày này. Bạn có thể thêm hạn hoàn thành khi tạo hoặc chỉnh sửa nhiệm vụ.";
    empty.append(title, desc);
    list.append(empty);
    return;
  }
  items.forEach((task) => {
    const row = document.createElement("div");
    row.className = `agenda-task${task.done ? " is-done" : ""}`;
    const status = document.createElement("span");
    status.className = "agenda-task-status";
    status.textContent = task.done ? "✓" : "•";
    const textWrap = document.createElement("div");
    textWrap.className = "agenda-task-copy";
    const title = document.createElement("strong");
    title.textContent = task.text;
    const note = document.createElement("small");
    note.textContent = `${task.subject} · ${task.minutes} phút · Ưu tiên ${PRIORITY_LABELS[task.priority]}`;
    textWrap.append(title, note);
    const action = createTaskButton(task.done ? "Đã xong" : "Tập trung", "btn btn-outline btn-small agenda-focus-button", () => {
      if (task.done) beginEditTask(task.id);
      else startTask(task.id);
    }, task.done ? "Xem nhiệm vụ" : `Tập trung: ${task.text}`);
    if (task.done) action.disabled = true;
    row.append(status, textWrap, action);
    list.append(row);
  });
}

// --------------------------- AI integration ---------------------------------
function askFocusAI(prompt) {
  window.dispatchEvent(new CustomEvent("focusforge:ask-ai", { detail: { prompt } }));
}
function buildStudyPlanPrompt() {
  const pending = data.tasks.filter((task) => !task.done).sort((a, b) => {
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return priorityRank(a.priority) - priorityRank(b.priority);
  });
  const shown = pending.slice(0, 8);
  const list = shown.length ? shown.map((task, index) => `${index + 1}. ${task.text.slice(0, 80)} — ${task.subject}, ưu tiên ${PRIORITY_LABELS[task.priority]}, ${task.minutes} phút${task.dueDate ? `, hạn ${task.dueDate}` : ""}`).join("\n") : "Hiện không có nhiệm vụ chưa hoàn thành.";
  const more = pending.length > shown.length ? `\nCòn ${pending.length - shown.length} nhiệm vụ khác chưa được liệt kê; hãy dựa trên các nhiệm vụ trên và không tự bịa chi tiết.` : "";
  return `Hãy lập kế hoạch học tập thực tế cho hôm nay dựa trên dữ liệu FocusForge. Đã tập trung hôm nay: ${minutesToday()} phút. Dùng Pomodoro và nghỉ hợp lý, ưu tiên việc gấp/quan trọng, tránh lịch quá dày. Nêu thứ tự và thời lượng.\n\nNhiệm vụ chưa hoàn thành:\n${list}${more}`;
}
$("hero-ai-plan").addEventListener("click", () => askFocusAI(buildStudyPlanPrompt()));
$("planner-ai").addEventListener("click", () => askFocusAI(buildStudyPlanPrompt()));
$("insight-ai").addEventListener("click", () => askFocusAI(buildStudyPlanPrompt()));
$("weekly-ai-review").addEventListener("click", () => {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 6);
  const recent = data.sessions.filter((session) => session.completedAt >= cutoff.getTime());
  const total = recent.reduce((sum, session) => sum + session.minutes, 0);
  const days = new Map();
  recent.forEach((session) => {
    const key = dateKey(new Date(session.completedAt));
    days.set(key, (days.get(key) || 0) + session.minutes);
  });
  const breakdown = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, minutes]) => `${day}: ${minutes} phút`).join("\n") || "Chưa có phiên hoàn thành trong 7 ngày gần nhất.";
  askFocusAI(`Hãy phân tích thói quen học tập của tôi trong 7 ngày gần nhất dựa trên dữ liệu thực tế này. Tổng thời gian tập trung: ${total} phút; số phiên hoàn thành: ${recent.length}; chuỗi hiện tại: ${calculateStreak()} ngày. Phân bố theo ngày:\n${breakdown}\n\nHãy nêu nhận xét cân bằng, xác định một điểm tốt, một cơ hội cải thiện và đề xuất kế hoạch có thể thực hiện trong tuần tới. Đừng phán xét hoặc bịa thêm số liệu.`);
});

$("insight-start").addEventListener("click", () => {
  const next = data.tasks.find((task) => !task.done);
  if (next) startTask(next.id);
  else {
    $("new-task").focus();
    $("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Thêm một nhiệm vụ nhỏ để bắt đầu nhé.");
  }
});

function renderAll() {
  renderTasks();
  renderDashboard();
  renderPlanner();
  renderSelectedTask();
}

// Initial visual defaults; auth state will load the proper per-user settings.
applyTheme();
setTimerMode("focus", true);
resetTaskForm();
