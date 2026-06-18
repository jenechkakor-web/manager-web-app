(function () {
  const serverAuthHosts = new Set(["manager.verkup.ru", "localhost", "127.0.0.1"]);
  const usesServerAuth = serverAuthHosts.has(window.location.hostname);
  const state = { user: null };

  function loginUrl() {
    const next = `${window.location.pathname}${window.location.search}`;
    return `login.html?next=${encodeURIComponent(next)}`;
  }

  function applyUser(user) {
    state.user = user;
    document.querySelectorAll("[data-auth-login]").forEach((element) => {
      element.textContent = user?.login || "";
    });
    document.querySelectorAll("[data-auth-role]").forEach((element) => {
      element.textContent = user?.role === "admin" ? "Администратор" : "Пользователь";
    });
    document.querySelectorAll("[data-admin-only]").forEach((element) => {
      element.classList.toggle("hidden", user?.role !== "admin");
    });
    document.querySelectorAll("[data-logout]").forEach((button) => {
      button.addEventListener("click", logout);
    });
    document.documentElement.classList.remove("auth-pending");
    return user;
  }

  async function logout() {
    if (usesServerAuth) {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    }
    window.location.replace("login.html");
  }

  async function restoreSession() {
    if (!usesServerAuth) {
      return applyUser({ id: 0, login: "Локальная версия", role: "user" });
    }
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const result = response.ok ? await response.json() : {};
      if (result.authenticated && result.user) return applyUser(result.user);
    } catch {
      // The login page reports connection errors in a form the user can act on.
    }
    window.location.replace(loginUrl());
    return new Promise(() => {});
  }

  const ready = restoreSession();
  window.ManagerAuth = {
    ready,
    usesServerAuth,
    get user() {
      return state.user;
    },
    get isAdmin() {
      return state.user?.role === "admin";
    },
    storageKey(key) {
      return `${key}:${state.user?.login || "anonymous"}`;
    },
    logout,
  };
})();
