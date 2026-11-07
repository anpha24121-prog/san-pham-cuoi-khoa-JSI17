import { auth } from "./firebase-config.js";
import { createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

const form = document.getElementById("register-form");
const nameInput = document.getElementById("display-name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const confirmInput = document.getElementById("confirm-password");
const message = document.getElementById("form-message");
const submitButton = document.getElementById("submit-btn");
function showMessage(text, success = false) {
  message.textContent = text;
  message.classList.toggle("success", success);
}
function friendlyError(code) {
  const errors = {
    "auth/email-already-in-use": "Email này đã được đăng ký. Hãy đăng nhập hoặc dùng email khác.",
    "auth/invalid-email": "Email không hợp lệ. Hãy kiểm tra lại.",
    "auth/weak-password": "Mật khẩu quá yếu. Hãy đặt mật khẩu mạnh hơn.",
    "auth/operation-not-allowed": "Email/Password chưa được bật trong Firebase Console.",
    "auth/network-request-failed": "Lỗi mạng. Hãy kiểm tra kết nối Internet.",
    "auth/unauthorized-domain": "Tên miền chưa được cho phép trong Firebase Authentication."
  };
  return errors[code] || `Đăng ký chưa thành công (${code}). Kiểm tra cấu hình Firebase.`;
}
function validate(name, email, password, confirmation) {
  if (!name) return "Hãy nhập tên của bạn.";
  if (!email || !email.includes("@") || email.startsWith("@")) return "Hãy nhập địa chỉ email hợp lệ.";
  if (password.length < 6) return "Mật khẩu phải có ít nhất 6 ký tự.";
  if (!/[A-Z]/.test(password)) return "Mật khẩu cần có ít nhất một chữ cái viết hoa.";
  if (!/[a-z]/.test(password)) return "Mật khẩu cần có ít nhất một chữ cái viết thường.";
  if (!/[0-9]/.test(password)) return "Mật khẩu cần có ít nhất một chữ số.";
  if (password !== confirmation) return "Hai mật khẩu chưa khớp nhau.";
  return "";
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const confirmation = confirmInput.value;
  const validationError = validate(name, email, password, confirmation);
  if (validationError) { showMessage(validationError); return; }
  submitButton.disabled = true; submitButton.textContent = "Đang tạo tài khoản...";
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName: name });
    showMessage("Tạo tài khoản thành công! Đang mở không gian học...", true);
    window.location.href = "index.html";
  } catch (error) {
    showMessage(friendlyError(error.code));
    console.error("Firebase registration error:", error.code, error.message);
  } finally {
    submitButton.disabled = false; submitButton.innerHTML = 'Tạo tài khoản <span aria-hidden="true">→</span>';
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
