const loginForm = document.querySelector("#loginForm");
const loginInput = document.querySelector("#loginInput");
const passwordInput = document.querySelector("#passwordInput");
const loginButton = document.querySelector("#loginButton");
const loginStatus = document.querySelector("#loginStatus");

function destinationAfterLogin() {
  const requested = new URLSearchParams(window.location.search).get("next") || "index.html";
  const destination = new URL(requested, window.location.origin);
  return destination.origin === window.location.origin ? `${destination.pathname}${destination.search}` : "index.html";
}

async function restoreLoginSession() {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const result = response.ok ? await response.json() : {};
    if (result.authenticated) window.location.replace(destinationAfterLogin());
  } catch {
    loginStatus.textContent = "Не удалось связаться с сервером. Попробуйте обновить страницу.";
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  loginStatus.textContent = "Выполняю вход...";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: loginInput.value.trim(), password: passwordInput.value }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Не удалось войти.");
    window.location.replace(destinationAfterLogin());
  } catch (error) {
    loginStatus.textContent = error.message || "Не удалось войти.";
    loginButton.disabled = false;
    passwordInput.select();
  }
});

restoreLoginSession();
