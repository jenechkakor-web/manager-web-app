(function () {
  const serverAuthHosts = new Set(["manager.verkup.ru", "localhost", "127.0.0.1"]);
  const usesServerAuth = serverAuthHosts.has(window.location.hostname);
  const state = { user: null };
  const SIDEBAR_COLLAPSED_KEY = "managerSidebarCollapsed";
  const NAV_ICONS = [
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M12 11v6M9 14h6"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11M15 9v11"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v17H7.5A3.5 3.5 0 0 0 4 22zM20 5.5A3.5 3.5 0 0 0 16.5 2H12v17h4.5A3.5 3.5 0 0 1 20 22z"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M15 14h1.5a4.5 4.5 0 0 1 4.5 4.5V20"/></svg>',
  ];

  function setupSidebar() {
    const workspace = document.querySelector(".workspace");
    const sidebar = workspace?.querySelector(".sidebar");
    if (!workspace || !sidebar || sidebar.querySelector("[data-sidebar-toggle]")) return;

    sidebar.querySelectorAll(".nav-item").forEach((item, index) => {
      const label = item.textContent.trim();
      item.title = label;
      item.textContent = "";
      const icon = document.createElement("span");
      icon.className = "nav-icon";
      icon.innerHTML = NAV_ICONS[index] || NAV_ICONS[1];
      const labelElement = document.createElement("span");
      labelElement.className = "nav-label";
      labelElement.textContent = label;
      item.append(icon, labelElement);
    });

    const toggle = document.createElement("button");
    toggle.className = "sidebar-toggle";
    toggle.type = "button";
    toggle.dataset.sidebarToggle = "";
    sidebar.append(toggle);

    const applyState = (collapsed) => {
      workspace.classList.toggle("sidebar-collapsed", collapsed);
      toggle.textContent = collapsed ? "›" : "‹";
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", collapsed ? "Развернуть левое меню" : "Свернуть левое меню");
      toggle.title = collapsed ? "Развернуть меню" : "Свернуть меню";
    };

    applyState(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
    toggle.addEventListener("click", () => {
      const collapsed = !workspace.classList.contains("sidebar-collapsed");
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
      applyState(collapsed);
      window.dispatchEvent(new Event("resize"));
    });
  }

  function loginUrl() {
    const next = `${window.location.pathname}${window.location.search}`;
    return `login.html?next=${encodeURIComponent(next)}`;
  }

  function applyUser(user) {
    state.user = user;
    setupSidebar();
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
