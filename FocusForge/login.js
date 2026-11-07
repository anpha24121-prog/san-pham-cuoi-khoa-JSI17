import { auth } from "./firebase-config.js";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const message = document.getElementById("form-message");
const submitButton = document.getElementById("submit-btn");
function showMessage(text, success = false) {
  message.textContent = text;
  message.classList.toggle("success", success);
}
function friendlyError(code) {
  const errors = {
    "auth/invalid-email": "Email không hợp lệ. Hãy kiểm tra lại.",
    "auth/invalid-credential": "Email hoặc mật khẩu không chính xác.",
    "auth/user-not-found": "Không tìm thấy tài khoản này.",
    "auth/wrong-password": "Mật khẩu không chính xác.",
    "auth/too-many-requests": "Bạn đã thử quá nhiều lần. Hãy đợi rồi thử lại.",
    "auth/network-request-failed": "Lỗi mạng. Hãy kiểm tra kết nối Internet.",
    "auth/unauthorized-domain": "Tên miền chưa được cho phép trong Firebase Authentication."
  };
  return errors[code] || `Đăng nhập chưa thành công (${code}). Kiểm tra cấu hình Firebase.`;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) { showMessage("Hãy nhập cả email và mật khẩu."); return; }
  submitButton.disabled = true; submitButton.textContent = "Đang đăng nhập...";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    showMessage("Đăng nhập thành công! Đang mở không gian học...", true);
    window.location.href = "index.html";
  } catch (error) {
    showMessage(friendlyError(error.code));
    console.error("Firebase login error:", error.code, error.message);
  } finally {
    submitButton.disabled = false; submitButton.innerHTML = 'Đăng nhập <span aria-hidden="true">→</span>';
  }
});
document.getElementById("google-btn").addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    window.location.href = "index.html";
  } catch (error) { showMessage(friendlyError(error.code)); console.error(error); }
});
document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.togglePassword);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Ẩn" : "Hiện";
  });
});
