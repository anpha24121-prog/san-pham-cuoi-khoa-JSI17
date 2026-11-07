// Focus AI — Firebase AI Logic + Gemini
// Focus AI shares the Firebase app exported by firebase-config.js.

(function () {
  "use strict";

  // Use the same initialized Firebase app as authentication and workspace data.
  const SDK_VERSION = "13.1.0";

  let chatSession = null;
  let loadingSession = null;
  let isSending = false;

  // Tạo khung chat.
  const root = document.createElement("div");
  root.id = "ff-ai-root";

  root.innerHTML = `
    <button
      id="ff-ai-toggle"
      type="button"
      aria-expanded="false"
      aria-controls="ff-ai-panel"
    >
      <span class="ff-ai-spark">✦</span>
      <span>Hỏi Focus AI</span>
    </button>

    <section
      id="ff-ai-panel"
      role="dialog"
      aria-label="Trợ lý Focus AI"
      aria-modal="false"
    >
      <header class="ff-ai-head">
        <div class="ff-ai-avatar">✦</div>

        <div class="ff-ai-head-main">
          <div class="ff-ai-title">Focus AI</div>
          <div class="ff-ai-subtitle">
            <span class="ff-ai-status"></span>
            <span id="ff-ai-status-text">Trợ lý học tập</span>
          </div>
        </div>

        <button id="ff-ai-new" class="ff-ai-new" type="button">
          Chat mới
        </button>

        <button
          id="ff-ai-close"
          class="ff-ai-iconbtn"
          type="button"
          aria-label="Đóng chatbot"
        >
          ×
        </button>
      </header>

      <div class="ff-ai-tools">
        <button
          class="ff-ai-chip"
          type="button"
          data-prompt="Hãy lập cho tôi kế hoạch học tập trong 2 giờ."
        >
          📚 Lập kế hoạch
        </button>

        <button
          class="ff-ai-chip"
          type="button"
          data-prompt="Hãy giải thích một khái niệm khó theo cách dễ hiểu, từng bước một."
        >
          💡 Giải thích bài học
        </button>

        <button
          class="ff-ai-chip"
          type="button"
          data-prompt="Hãy giúp tôi chia nhiệm vụ thành những bước nhỏ dễ bắt đầu."
        >
          ✅ Chia nhỏ nhiệm vụ
        </button>
      </div>

      <div id="ff-ai-messages" aria-live="polite">
        <div class="ff-ai-bubble ff-ai-bot">
          Chào bạn! Mình là Focus AI ✦

          Mình có thể giúp bạn lập kế hoạch học tập,
          giải thích bài học và chia nhiệm vụ lớn thành
          những bước nhỏ hơn.

          Bạn muốn bắt đầu từ đâu?
        </div>
      </div>

      <form id="ff-ai-form" class="ff-ai-form">
        <textarea
          id="ff-ai-input"
          class="ff-ai-input"
          rows="1"
          maxlength="2000"
          placeholder="Hỏi về việc học của bạn…"
          aria-label="Nhập câu hỏi"
          required
        ></textarea>

        <button
          id="ff-ai-send"
          class="ff-ai-send"
          type="submit"
        >
          Gửi ↑
        </button>
      </form>

      <div class="ff-ai-foot">
        AI có thể mắc lỗi. Không gửi mật khẩu hoặc thông tin nhạy cảm.
      </div>
    </section>
  `;

  document.body.appendChild(root);

  // Lấy các phần tử giao diện.
  const toggleButton = document.getElementById("ff-ai-toggle");
  const panel = document.getElementById("ff-ai-panel");
  const closeButton = document.getElementById("ff-ai-close");
  const newChatButton = document.getElementById("ff-ai-new");
  const messages = document.getElementById("ff-ai-messages");
  const form = document.getElementById("ff-ai-form");
  const input = document.getElementById("ff-ai-input");
  const sendButton = document.getElementById("ff-ai-send");
  const statusText = document.getElementById("ff-ai-status-text");

  // Mở cửa sổ chat.
  function openChat() {
    panel.classList.add("ff-ai-open");
    toggleButton.setAttribute("aria-expanded", "true");
    input.focus();
  }

  // Đóng cửa sổ chat.
  function closeChat() {
    panel.classList.remove("ff-ai-open");
    toggleButton.setAttribute("aria-expanded", "false");
  }

  toggleButton.addEventListener("click", function () {
    if (panel.classList.contains("ff-ai-open")) {
      closeChat();
    } else {
      openChat();
    }
  });

  closeButton.addEventListener("click", closeChat);

  // Tạo bong bóng tin nhắn.
  // textContent giúp hiển thị văn bản an toàn,
  // không coi câu trả lời của AI là HTML.
  function addMessage(text, sender, extraClass) {
    const bubble = document.createElement("div");

    bubble.className =
      "ff-ai-bubble " +
      (sender === "user" ? "ff-ai-user" : "ff-ai-bot");

    if (extraClass) {
      bubble.classList.add(extraClass);
    }

    bubble.textContent = text;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;

    return bubble;
  }

  // Khởi tạo Firebase AI Logic và phiên chat.
  async function getChatSession() {
    if (chatSession) {
      return chatSession;
    }

    // Tránh tạo nhiều phiên khởi tạo đồng thời.
    if (loadingSession) {
      return loadingSession;
    }

    loadingSession = (async function () {
      const firebaseModule = await import("./firebase-config.js");
      const aiSdk = await import(
        "https://www.gstatic.com/firebasejs/" +
        SDK_VERSION +
        "/firebase-ai.js"
      );

      const ai = aiSdk.getAI(firebaseModule.app, {
        backend: new aiSdk.GoogleAIBackend()
      });

      const model = aiSdk.getGenerativeModel(ai, {
        model: "gemini-3.8-flash",

        systemInstruction: `
          Bạn là Focus AI, trợ lý học tập của FocusForge.

          Hãy trả lời chủ yếu bằng tiếng Việt, thân thiện,
          rõ ràng, có cấu trúc và dễ hiểu.

          Nhiệm vụ của bạn:
          - Giúp học sinh lập kế hoạch học tập thực tế.
          - Chia nhiệm vụ lớn thành những bước nhỏ.
          - Giải thích kiến thức theo từng bước.
          - Gợi ý cách học và duy trì sự tập trung.
          - Hỏi lại nếu câu hỏi thiếu thông tin cần thiết.

          Với bài tập, hãy giải thích cách làm thay vì
          chỉ nêu đáp án. Không tự bịa thông tin.
        `
      });

      return model.startChat();
    })();

    try {
      chatSession = await loadingSession;
      return chatSession;
    } finally {
      loadingSession = null;
    }
  }

  // Nếu người dùng hỏi về nhiệm vụ, đính kèm
  // danh sách nhiệm vụ đang có nếu home.js cung cấp.
  function addTaskContext(question) {
    const asksAboutTasks =
      /nhiệm vụ|việc cần|to-do|task|lịch học|kế hoạch hôm nay|công việc hôm nay/i
        .test(question);

    if (!asksAboutTasks || /nhiệm vụ chưa hoàn thành:|nhiệm vụ của tôi:/i.test(question)) {
      return question;
    }

    try {
      const getTasks = window.focusForgeGetTasks;
      const currentTasks = typeof getTasks === "function" ? getTasks() : [];
      if (Array.isArray(currentTasks) && currentTasks.length > 0) {
        const taskLines = currentTasks.slice(0, 15).map(function (task, index) {
          const state = task.done ? "Đã xong" : "Chưa xong";
          const due = task.dueDate ? ", hạn " + task.dueDate : "";
          return (index + 1) + ". [" + state + "] " + String(task.text || "").slice(0, 120) +
            " (" + String(task.subject || "Khác") + ", ưu tiên " + String(task.priority || "Vừa") +
            ", " + String(task.minutes || 15) + " phút" + due + ")";
        });
        return question + "\n\nDanh sách nhiệm vụ hiện có trong FocusForge:\n" + taskLines.join("\n");
      }
    } catch (error) {
      console.debug("Không đọc được danh sách nhiệm vụ.", error);
    }

    return question;
  }

  // Thông báo lỗi dễ hiểu cho người dùng.
  function getFriendlyError(error) {
    const detail = String(
      (error && (error.code || error.message)) ||
      error ||
      "Unknown error"
    );

    console.error("Focus AI error:", error);

    if (/app.?check|attestation/i.test(detail)) {
      return (
        "Firebase đang yêu cầu App Check cho AI Logic. " +
        "Hãy kiểm tra cấu hình App Check và debug token " +
        "của môi trường localhost."
      );
    }

    if (/api.?key|configuration|project.?id|app.?id/i.test(detail)) {
      return (
        "Cấu hình Firebase có vẻ chưa đúng. " +
        "Hãy kiểm tra apiKey, projectId và appId."
      );
    }

    if (/quota|429|resource_exhausted|rate.?limit/i.test(detail)) {
      return (
        "Dự án có thể đã chạm hạn mức yêu cầu. " +
        "Hãy kiểm tra hạn mức Firebase AI Logic."
      );
    }

    if (/403|permission|unauthenticated/i.test(detail)) {
      return (
        "Firebase chưa cho phép yêu cầu này. " +
        "Kiểm tra AI Logic và App Check trong Firebase Console."
      );
    }

    return (
      "Chưa thể kết nối Gemini. Hãy kiểm tra Internet, " +
      "sau đó mở F12 → Console để xem lỗi."
    );
  }

  // Gửi câu hỏi tới Gemini.
  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const question = input.value.trim();

    if (!question || isSending) {
      return;
    }

    isSending = true;
    sendButton.disabled = true;
    input.value = "";

    addMessage(question, "user");
    statusText.textContent = "Đang suy nghĩ…";

    const pending = addMessage(
      "Focus AI đang suy nghĩ…",
      "bot",
      "ff-ai-loading"
    );

    try {
      const session = await getChatSession();

      const result = await session.sendMessage(
        addTaskContext(question)
      );

      const answer = result.response.text();

      pending.textContent =
        answer || "Mình chưa tạo được câu trả lời. Hãy thử lại nhé.";

      pending.classList.remove("ff-ai-loading");
      statusText.textContent = "Đang hỗ trợ bạn";
    } catch (error) {
      pending.textContent = getFriendlyError(error);
      pending.classList.remove("ff-ai-loading");
      pending.classList.add("ff-ai-error");
      statusText.textContent = "Chưa kết nối được";
    } finally {
      isSending = false;
      sendButton.disabled = false;
      input.focus();
      messages.scrollTop = messages.scrollHeight;
    }
  });

  // Nút gợi ý điền sẵn câu hỏi.
  root.querySelectorAll("[data-prompt]").forEach(function (button) {
    button.addEventListener("click", function () {
      input.value = button.getAttribute("data-prompt") || "";
      input.focus();
    });
  });

  // Enter gửi câu hỏi; Shift + Enter xuống dòng.
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      if (form.requestSubmit) {
        form.requestSubmit();
      }
    }
  });

  // Bắt đầu cuộc trò chuyện mới.
  newChatButton.addEventListener("click", function () {
    chatSession = null;
    loadingSession = null;
    messages.textContent = "";

    addMessage(
      "Mình đã mở cuộc trò chuyện mới. " +
      "Hôm nay bạn muốn giải quyết việc gì?",
      "bot"
    );

    statusText.textContent = "Cuộc trò chuyện mới";
  });

  // Allow the dashboard's "plan with AI" actions to open the chat with real task context.
  window.addEventListener("focusforge:ask-ai", function (event) {
    const prompt = event && event.detail && typeof event.detail.prompt === "string"
      ? event.detail.prompt
      : "Hãy giúp tôi lập kế hoạch học tập hôm nay.";
    input.value = prompt;
    openChat();
    if (form.requestSubmit) form.requestSubmit();
  });

})();