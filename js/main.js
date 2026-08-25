/* Restored monolithic runtime for behavior recovery. */
(function () {
  "use strict";

  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const DEFAULT_API_BASE = "https://dscauth.onrender.com";
  const REQUEST_TIMEOUT_MS = 60000;
  const SESSION_TIMEOUT_MS = 10 * 60 * 60 * 1000;
  const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
  const HELP_URL = "https://discord.gg/XB2Zjmsb7K";
  const USER_LOGIN_PAGE_NAME = "Ulogin.html";
  const ADMIN_LOGIN_PAGE_NAME = "Alogin.html";
  const USER_HOME_PAGE_NAME = "Udash.html";
  const ADMIN_HOME_PAGE_NAME = "Adash.html";
  const THEME_STORAGE_KEY = "siteTheme";
  const AUTH_STORAGE_KEY = "dscCurrentUser";
  const OWNER_ACCESS_CACHE_KEY = "dscOwnerAccessCache";
  const OWNER_ACCESS_TTL_MS = 5 * 60 * 1000;
  const ADMIN_PAGES = new Set([
    "Alogin.html",
    "Adash.html",
    "OwnerDB.html",
    "generateKey.html",
  ]);
  const PUBLIC_PAGES = new Set([
    "index.html",
    "Ulogin.html",
    "checkout.html",
    "freepanel.html",
  ]);
  const JWT_ROLE_KEYS = [
    "role",
    "roles",
    "Role",
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/role",
  ];
  const JWT_USERNAME_KEYS = [
    "unique_name",
    "preferred_username",
    "name",
    "sub",
    "username",
    "Username",
  ];

  function resolveApiBase() {
    const hostname = String(window.location.hostname || "").toLowerCase();
    const isLocalRuntime = hostname === "localhost" || hostname === "127.0.0.1";
    const candidate =
      isLocalRuntime &&
      typeof window.__API_BASE__ === "string" &&
      window.__API_BASE__.trim()
        ? window.__API_BASE__.trim()
        : DEFAULT_API_BASE;

    try {
      const parsed = new URL(candidate);
      if (!isLocalRuntime && parsed.protocol !== "https:")
        return DEFAULT_API_BASE;
      return parsed.origin.replace(/\/+$/, "");
    } catch (err) {
      return DEFAULT_API_BASE;
    }
  }

  const API_BASE = resolveApiBase();

  function getStoredValue(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function setStoredValue(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      /* Ignore storage write failures gracefully. */
    }
  }

  function removeStoredValue(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      /* Ignore storage removal failures gracefully. */
    }
  }

  function clearLegacyClientOverrides() {
    removeStoredValue("apiBase");
  }

  clearLegacyClientOverrides();

  const USER_LOGIN_PAGE = resolvePagePath(USER_LOGIN_PAGE_NAME);
  const ADMIN_LOGIN_PAGE = resolvePagePath(ADMIN_LOGIN_PAGE_NAME);
  const USER_HOME_PAGE = resolvePagePath(USER_HOME_PAGE_NAME);
  const ADMIN_HOME_PAGE = resolvePagePath(ADMIN_HOME_PAGE_NAME);

  function getCurrentPageName() {
    let filename = String(window.location.pathname || "")
      .split("/")
      .pop()
      .toLowerCase();
    filename = filename.split("?")[0].split("#")[0];

    if (
      !filename ||
      filename === "" ||
      filename === "index.html" ||
      filename === "index"
    )
      return "index.html";
    if (filename.includes("ulogin")) return "Ulogin.html";
    if (filename.includes("alogin")) return "Alogin.html";
    if (filename.includes("udash")) return "Udash.html";
    if (filename.includes("adash")) return "Adash.html";
    if (filename.includes("ownerdb")) return "OwnerDB.html";
    if (filename.includes("generatekey")) return "generateKey.html";
    if (filename.includes("checkout")) return "checkout.html";
    if (filename.includes("freepanel")) return "freepanel.html";
    if (filename.includes("change")) return "change.html";

    return "index.html";
  }

  function isPagesContext() {
    return /\/pages\//i.test(
      String(window.location.pathname || "").replace(/\\/g, "/"),
    );
  }

  function resolvePagePath(pageName) {
    const normalizedPage = String(pageName || "index.html")
      .replace(/^\.\/+/, "")
      .replace(/^pages\//i, "");

    if (normalizedPage.toLowerCase() === "index.html") {
      return isPagesContext() ? "../index.html" : "index.html";
    }

    return isPagesContext() ? normalizedPage : `pages/${normalizedPage}`;
  }

  function removePageGuardStyle() {
    const styleEl = document.getElementById("page-guard-style");
    if (styleEl) styleEl.remove();
  }

  function revealProtectedBody() {
    removePageGuardStyle();

    if (!document.body) return;

    document.body.style.display = "";
    document.body.style.opacity = "0";
    document.body.style.transform = "translateY(4px)";

    // 🔥 existing animation hook

    document.body.style.transition = "opacity 0.24s ease, transform 0.24s ease";

    requestAnimationFrame(() => {
      document.body.style.opacity = "1";
      document.body.style.transform = "translateY(0)";
    });
  }

  function redirectForRole(role) {
    if (role === "Admin") {
      window.location.replace(ADMIN_HOME_PAGE);
      return;
    }

    if (role === "User") {
      window.location.replace(USER_HOME_PAGE);
      return;
    }

    window.location.replace(resolvePagePath("index.html"));
  }

  function goTo(page, delayMs = 700) {
    const targetPath = resolvePagePath(page);
    window.setTimeout(() => {
      window.location.href = targetPath;
    }, delayMs);
  }

  function decodeJwtPayload(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length !== 3) return null;

      const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
      return JSON.parse(atob(padded));
    } catch (err) {
      return null;
    }
  }

  function getClaimValue(claims, keys) {
    if (!claims) return null;

    for (const key of keys) {
      const value = claims[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (Array.isArray(value) && value.length > 0) return value[0];
      if (typeof value === "boolean") return value;
    }

    return null;
  }

  function normalizePrimaryRole(rawRole) {
    const role = String(rawRole || "")
      .trim()
      .toLowerCase();
    if (!role) return null;
    if (["admin", "owner", "superadmin", "super-admin"].includes(role))
      return "Admin";
    if (["user", "member", "customer"].includes(role)) return "User";
    return null;
  }

  function getRoleFromClaims(claims) {
    return normalizePrimaryRole(getClaimValue(claims, JWT_ROLE_KEYS));
  }

  function getUsernameFromClaims(claims) {
    return String(getClaimValue(claims, JWT_USERNAME_KEYS) || "").trim();
  }

  function readStoredCurrentUser() {
    try {
      let raw = getStoredValue(AUTH_STORAGE_KEY);
      if (!raw) {
        raw = getStoredValue("currentUser");
        if (raw) {
          setStoredValue(AUTH_STORAGE_KEY, raw);
        }
      }
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function setOwnerAccessCache(isOwner) {
    setStoredValue(
      OWNER_ACCESS_CACHE_KEY,
      JSON.stringify({
        isOwner: Boolean(isOwner),
        checkedAt: Date.now(),
      }),
    );
  }

  function getOwnerAccessCache() {
    try {
      const raw = getStoredValue(OWNER_ACCESS_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function clearCurrentUser() {
    removeStoredValue(AUTH_STORAGE_KEY);
    removeStoredValue(OWNER_ACCESS_CACHE_KEY);
  }

  function persistCurrentUser(user) {
    const token = String(user && user.token ? user.token : "").trim();
    const claims = decodeJwtPayload(token);
    const role = getRoleFromClaims(claims);
    const usernameFromToken = getUsernameFromClaims(claims);

    if (!token || !claims || !role) {
      clearCurrentUser();
      return null;
    }

    const now = Date.now();
    const safeUser = {
      token,
      role,
      username: String(
        user.username || user.Username || usernameFromToken || "",
      ).trim(),
      plan: String(user.plan || user.Plan || "").trim(),
      expiry: user.expiry || user.expiryTime || user.ExpiryTime || null,
      loginTime: Number(user.loginTime) || now,
      lastActivityAt: now,
    };

    setStoredValue(AUTH_STORAGE_KEY, JSON.stringify(safeUser));
    return safeUser;
  }

  function touchCurrentUserActivity(user = null) {
    const existing = user || readStoredCurrentUser();
    if (!existing || !existing.token) return;

    existing.lastActivityAt = Date.now();
    setStoredValue(AUTH_STORAGE_KEY, JSON.stringify(existing));
  }

  function getCurrentUser() {
    const stored = readStoredCurrentUser();
    if (!stored || !stored.token) return null;

    const claims = decodeJwtPayload(stored.token);
    const role = getRoleFromClaims(claims);
    const issuedUsername = getUsernameFromClaims(claims);
    const loginTime = Number(stored.loginTime) || 0;
    const lastActivityAt = Number(stored.lastActivityAt) || loginTime;

    if (!claims || !role) {
      clearCurrentUser();
      return null;
    }

    if (claims.exp && Number(claims.exp) * 1000 <= Date.now()) {
      clearCurrentUser();
      return null;
    }

    if (lastActivityAt && Date.now() - lastActivityAt > SESSION_TIMEOUT_MS) {
      clearCurrentUser();
      return null;
    }

    return {
      ...stored,
      role,
      username: String(stored.username || issuedUsername || "").trim(),
    };
  }

  function showLoader(text) {
    let loader = document.getElementById("global-loader");
    if (!loader) {
      loader = document.createElement("div");
      loader.id = "global-loader";
      loader.innerHTML = `
      <div class="loader-circle"></div>
      <div class="loader-text" id="loader-text">Loading...</div>
    `;
      document.body.appendChild(loader);
    }

    const loaderText = document.getElementById("loader-text");
    if (loaderText) loaderText.textContent = text || "Loading...";
    loader.classList.add("active");
  }

  function hideLoader() {
    const loader = document.getElementById("global-loader");
    if (loader) loader.classList.remove("active");
  }

  function showMessage(message, type = "success") {
    let stack = document.getElementById("toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "toast-stack";
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = String(message || "");
    stack.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("toast-hide");
      window.setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

  async function copyTextToClipboard(text, buttonEl, defaultText = "Copy Key") {
    if (!text || text === "--") return;

    const originalLabel = buttonEl ? buttonEl.textContent : defaultText;
    const originalClass = buttonEl ? buttonEl.className : "";

    function showCopiedState() {
      if (!buttonEl) return;
      buttonEl.textContent = "Copied";
      if (originalClass.includes("btn-neutral")) {
        buttonEl.className = originalClass.replace(
          "btn-neutral",
          "btn-success",
        );
      } else {
        buttonEl.classList.add("btn-success");
      }

      window.setTimeout(() => {
        buttonEl.textContent = originalLabel || defaultText;
        buttonEl.className = originalClass;
      }, 1800);
    }

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        showCopiedState();
        return;
      } catch (err) {
        /* Fall through to the legacy copy fallback. */
      }
    }

    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.className = "hidden-textarea";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      showCopiedState();
    } catch (err) {
      showMessage("Copy failed. Please copy manually.", "error");
    }
  }

  function apiUrl(path) {
    const normalizedPath = String(path || "").startsWith("/")
      ? String(path)
      : `/${path}`;
    return `${API_BASE}${normalizedPath}`;
  }

  async function readJsonSafely(response) {
    try {
      return await response.json();
    } catch (err) {
      return {};
    }
  }

  async function readResponseBody(response) {
    const contentType = String(
      response.headers.get("content-type") || "",
    ).toLowerCase();
    if (contentType.includes("application/json"))
      return readJsonSafely(response);

    try {
      return await response.text();
    } catch (err) {
      return "";
    }
  }

  function extractErrorMessage(data, fallbackMessage) {
    if (typeof data === "string" && data.trim()) return data.trim();
    if (data && typeof data.error === "string" && data.error.trim())
      return data.error.trim();
    if (data && typeof data.message === "string" && data.message.trim())
      return data.message.trim();
    if (data && typeof data.title === "string" && data.title.trim())
      return data.title.trim();
    return fallbackMessage;
  }

  function isAbortError(err) {
    return Boolean(
      err &&
      (err.name === "AbortError" ||
        /abort|timed out/i.test(String(err.message || ""))),
    );
  }

  async function fetchWithTimeout(
    url,
    options = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
  ) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        cache: "no-store",
        ...options,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function requestJson(path, options = {}) {
    const {
      method = "GET",
      headers = {},
      body,
      timeoutMs = REQUEST_TIMEOUT_MS,
      retries,
    } = options;

    const normalizedMethod = String(method || "GET").toUpperCase();
    const retryCount =
      retries !== undefined ? retries : normalizedMethod === "GET" ? 1 : 0;
    const mergedHeaders = { Accept: "application/json", ...headers };
    const fetchOptions = {
      method: normalizedMethod,
      headers: mergedHeaders,
    };

    if (body !== undefined) {
      if (!mergedHeaders["Content-Type"])
        mergedHeaders["Content-Type"] = "application/json";
      fetchOptions.body =
        typeof body === "string" ? body : JSON.stringify(body);
    }

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const response = await fetchWithTimeout(
        apiUrl(path),
        fetchOptions,
        timeoutMs,
      );
      const data = await readResponseBody(response);

      if (
        !response.ok &&
        RETRYABLE_STATUS_CODES.has(response.status) &&
        attempt < retryCount
      ) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, 400 * (attempt + 1)),
        );
        continue;
      }

      if (response.ok) touchCurrentUserActivity();
      return { ok: response.ok, status: response.status, data, path };
    }

    return { ok: false, status: 0, data: {}, path };
  }

  function getAuthHeader() {
    const currentUser = getCurrentUser();
    if (currentUser && currentUser.token) {
      return { Authorization: `Bearer ${currentUser.token}` };
    }

    return {};
  }

  function isAuthFailureStatus(status) {
    return status === 401 || status === 403;
  }

  function handleUserAuthFailure(status) {
    if (!isAuthFailureStatus(status)) return false;
    showMessage("Session expired. Please login again.", "error");
    clearCurrentUser();
    window.setTimeout(() => window.location.replace(USER_LOGIN_PAGE), 850);
    return true;
  }

  function handleAdminAuthFailure(status) {
    if (status === 401) {
      showMessage("Admin session expired. Please login again.", "error");
      clearCurrentUser();
      window.setTimeout(() => window.location.replace(ADMIN_LOGIN_PAGE), 850);
      return true;
    }

    if (status === 403) {
      showMessage(
        "You do not have permission to access that admin resource.",
        "error",
      );
      return true;
    }

    return false;
  }

  function escapeHTML(value) {
    if (value === null || value === undefined) return "-";
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(String(value)));
    return div.innerHTML;
  }

  function safeOpenExternal(rawUrl) {
    const parsed = new URL(rawUrl, window.location.origin);
    if (parsed.protocol !== "https:") {
      throw new Error("Blocked non-HTTPS URL");
    }

    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
  }

  function toIsoOrNullFromDatetimeLocal(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function toDatetimeLocal(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const pad = (num) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
  }

  function normalizeListPayload(data, keys = []) {
    if (Array.isArray(data)) return data;

    for (const key of keys) {
      if (data && Array.isArray(data[key])) return data[key];
    }

    if (data && Array.isArray(data.data)) return data.data;
    return [];
  }

  function normalizeUsersPayload(data) {
    return normalizeListPayload(data, ["users", "Users"]);
  }

  function readObjectValue(source, keys, fallback = "") {
    for (const key of keys) {
      if (source && source[key] !== undefined && source[key] !== null)
        return source[key];
    }
    return fallback;
  }

  function getSettingsRecord(data) {
    if (Array.isArray(data)) return data[0] || {};
    if (data && Array.isArray(data.settings)) return data.settings[0] || {};
    if (data && Array.isArray(data.Settings)) return data.Settings[0] || {};
    if (
      data &&
      data.data &&
      !Array.isArray(data.data) &&
      typeof data.data === "object"
    )
      return data.data;
    if (data && typeof data === "object") return data;
    return {};
  }

  function toggleControlVisibility(
    element,
    shouldShow,
    visibleClass = "d-inline-flex",
  ) {
    if (!element) return;
    element.classList.toggle("d-none", !shouldShow);
    element.classList.toggle(visibleClass, shouldShow);
  }

  function getSavedTheme() {
    return getStoredValue(THEME_STORAGE_KEY);
  }

  function saveTheme(theme) {
    setStoredValue(THEME_STORAGE_KEY, theme);
  }

  function resolveInitialTheme() {
    const savedTheme = getSavedTheme();
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    )
      return "dark";
    return "light";
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const label = theme === "dark" ? "Light Mode" : "Dark Mode";
      button.textContent = label;
      button.setAttribute("aria-label", `Switch to ${label.toLowerCase()}`);
    });
  }

  function toggleTheme() {
    const currentTheme =
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "dark"
        : "light";
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    saveTheme(nextTheme);
  }

  function injectDeveloperFooter() {
    if (document.getElementById("dsc-footer")) return;

    const inPages = isPagesContext();
    const logoSrc = inPages ? "../images/dsclogo.png" : "images/dsclogo.png";
    const homeUrl = resolvePagePath("index.html");
    const appsUrl = resolvePagePath("apps.html");
    const productsUrl = resolvePagePath("products.html");
    const downloadsUrl = resolvePagePath("downloads.html");
    const aboutUrl = resolvePagePath("about.html");
    const contactUrl = resolvePagePath("contact.html");
    const privacyUrl = resolvePagePath("privacy-policy.html");
    const termsUrl = resolvePagePath("terms.html");

    const footer = document.createElement("footer");
    footer.id = "dsc-footer";
    footer.className = "developer-footer";
    footer.innerHTML = `
    <div class="footer-container">
      <div class="footer-grid">
        <div class="footer-col footer-brand-col">
          <a class="logo-mark" href="${homeUrl}">
            <img src="${logoSrc}" alt="Dark Skull Corporation" class="header-logo-img" />
            <span class="logo-text">Dark Skull Corporation</span>
          </a>
          <p class="footer-desc mt-10">
            Professional software studio crafting secure utilities, desktop tools, and future-ready digital experiences.
          </p>
        </div>
        <div class="footer-col">
          <h4 class="footer-col-title">Explore</h4>
          <ul class="footer-links">
            <li><a href="${appsUrl}">Applications</a></li>
            <li><a href="${productsUrl}">Products</a></li>
            <li><a href="${downloadsUrl}">Downloads</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4 class="footer-col-title">Company</h4>
          <ul class="footer-links">
            <li><a href="${aboutUrl}">About Us</a></li>
            <li><a href="${contactUrl}">Contact</a></li>
            <li><a href="${privacyUrl}">Privacy Policy</a></li>
            <li><a href="${termsUrl}">Terms of Use</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p class="footer-copyright">&copy; ${new Date().getFullYear()} DARK SKULL CORPORATION. ALL RIGHTS RESERVED.</p>
        <p class="footer-credit">Developer
          <a href="https://naveedmushtaq.tech/" target="_blank" rel="noopener noreferrer" class="footer-name tooltip-trigger" data-tooltip="Visit Portfolio">
            Naveed Mushtaq
          </a>
        </p>
      </div>
    </div>
  `;
    document.body.appendChild(footer);
  }

  function addHelpButtonToHeader() {
    const headerActions = document.querySelector(".header-actions");
    if (!headerActions) return;
    if (headerActions.querySelector(`a[href="${HELP_URL}"]`)) return;

    const helpLink = document.createElement("a");
    helpLink.className = "btn btn-outline";
    helpLink.href = HELP_URL;
    helpLink.textContent = "DISCORD";
    headerActions.appendChild(helpLink);
  }

  function bindCommonShell(handleLogout) {
    setTheme(resolveInitialTheme());
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", toggleTheme);
    });

    document.querySelectorAll(".js-logout").forEach((button) => {
      button.addEventListener("click", handleLogout);
    });

    addHelpButtonToHeader();
    injectDeveloperFooter();
  }

  const USER_ROUTE_GUARDS = {
    "Udash.html": {
      role: "User",
      probePath: "/api/auth/my-order",
      loginPage: USER_LOGIN_PAGE,
    },
    "change.html": {
      role: "User",
      probePath: "/api/auth/my-order",
      loginPage: USER_LOGIN_PAGE,
    },
  };

  const Core = {
    ADMIN_LOGIN_PAGE,
    OWNER_ACCESS_TTL_MS,
    clearCurrentUser,
    getAuthHeader,
    getCurrentUser,
    getOwnerAccessCache,
    handleAdminAuthFailure,
    redirectForRole,
    renderGuardFailure,
    requestJson,
    resolvePagePath,
    setOwnerAccessCache,
  };

  function renderGuardFailure(message, redirectPage) {
    revealProtectedBody();
    if (!document.body) return;

    document.body.innerHTML = `
    <main class="center-wrap">
      <section class="auth-card">
        <h1 class="auth-title title-danger">Access Verification Failed</h1>
        <p class="auth-subtitle">${escapeHTML(message)}</p>
        <div class="link-row">
          <a href="${escapeHTML(resolvePagePath(redirectPage || "index.html"))}">Return</a>
          <a href="${escapeHTML(HELP_URL)}" target="_blank" rel="noopener noreferrer">Support</a>
        </div>
      </section>
    </main>
  `;
  }

  async function ensureUserPageAccess(pageName) {
    const guard = USER_ROUTE_GUARDS[pageName];
    if (!guard) return null;

    const currentUser = getCurrentUser();
    if (!currentUser || currentUser.role !== guard.role) {
      clearCurrentUser();
      window.location.replace(guard.loginPage);
      return null;
    }

    try {
      const probe = await requestJson(guard.probePath, {
        method: "GET",
        headers: getAuthHeader(),
        retries: 0,
      });

      if (isAuthFailureStatus(probe.status)) {
        clearCurrentUser();
        window.location.replace(guard.loginPage);
        return null;
      }

      if (probe.status === 0) {
        renderGuardFailure(
          "Unable to verify your session right now. Please retry in a moment.",
          guard.loginPage,
        );
        return null;
      }

      touchCurrentUserActivity(currentUser);
      return currentUser;
    } catch (err) {
      renderGuardFailure(
        "The server could not verify your access. Please try again.",
        guard.loginPage,
      );
      return null;
    }
  }

  async function verifyOwnerAccess(forceRefresh = false) {
    const currentUser = Core.getCurrentUser();
    if (!currentUser || currentUser.role !== "Admin") return false;

    const cached = Core.getOwnerAccessCache();
    if (
      !forceRefresh &&
      cached &&
      Date.now() - Number(cached.checkedAt || 0) < Core.OWNER_ACCESS_TTL_MS
    ) {
      return Boolean(cached.isOwner);
    }

    try {
      const result = await Core.requestJson("/api/admin/owner/probe", {
        method: "GET",
        headers: Core.getAuthHeader(),
        retries: 0,
      });

      if (result.ok) {
        Core.setOwnerAccessCache(true);
        return true;
      }

      if (result.status === 403) {
        Core.setOwnerAccessCache(false);
        return false;
      }

      if (Core.handleAdminAuthFailure(result.status)) return false;
    } catch (err) {
      /* Ignore owner-check network failures here and let the caller decide UI state. */
    }

    return false;
  }

  async function ensureAdminPageAccess(pageName) {
    const currentUser = Core.getCurrentUser();
    if (!currentUser) {
      Core.clearCurrentUser();
      window.location.replace(Core.ADMIN_LOGIN_PAGE);
      return null;
    }

    if (currentUser.role !== "Admin") {
      Core.redirectForRole(currentUser.role);
      return null;
    }

    try {
      const probePath =
        pageName === "OwnerDB.html"
          ? "/api/admin/owner/probe"
          : "/api/admin/probe";
      const probe = await Core.requestJson(probePath, {
        method: "GET",
        headers: Core.getAuthHeader(),
        retries: 0,
      });

      if (probe.status === 401) {
        Core.clearCurrentUser();
        window.location.replace(Core.ADMIN_LOGIN_PAGE);
        return null;
      }

      if (pageName === "OwnerDB.html" && probe.status === 403) {
        Core.setOwnerAccessCache(false);
        Core.renderGuardFailure(
          "Owner access is required for this page.",
          "Adash.html",
        );
        window.setTimeout(
          () => window.location.replace(Core.resolvePagePath("Adash.html")),
          1200,
        );
        return null;
      }

      if (probe.status === 0) {
        Core.renderGuardFailure(
          "Unable to verify admin access right now. Please retry.",
          Core.ADMIN_LOGIN_PAGE,
        );
        return null;
      }

      if (pageName === "OwnerDB.html" && probe.ok) {
        // 🔥 FIX: Yahan se cachedSettingsRecord hata diya hai kyunki probe settings return nahi karta
        Core.setOwnerAccessCache(true);
      }

      return { user: currentUser, probe };
    } catch (err) {
      Core.renderGuardFailure(
        "Admin access could not be verified. Please try again.",
        Core.ADMIN_LOGIN_PAGE,
      );
      return null;
    }
  }

  async function checkSystemStatus() {
    try {
      const result = await requestJson("/api/admin/system-status", {
        method: "GET",
        retries: 0,
      });

      // 🔥 NAYA CODE: Home Page Download Button Logic 🔥
      const data = result.data || {};
      const homeBtn = document.getElementById("homeDownloadBtn");
      if (homeBtn) {
        // Backend se capital ya small 's' dono handle karne ke liye
        const showBtn =
          data.showHomeDownloadBtn === true ||
          data.ShowHomeDownloadBtn === true;
        homeBtn.style.removeProperty("display");
        if (showBtn) {
          homeBtn.classList.remove("d-none");
          homeBtn.href = data.freeLink || data.FreeLink || "#"; // Link wahi free panel wali hogi
        } else {
          homeBtn.classList.add("d-none");
        }
      }
      // 🔥 NAYA CODE END 🔥

      const isMaint =
        data &&
        (data.isMaintenanceMode === true || data.IsMaintenanceMode === true);
      if (!result.ok || !isMaint) return false;

      const page = getCurrentPageName().toLowerCase();
      const isAdminPage = [
        "alogin.html",
        "adash.html",
        "ownerdb.html",
        "generatekey.html",
      ].includes(page);
      if (isAdminPage) return false;

      revealProtectedBody();
      document.body.innerHTML = `
    <div class="maintenance-container">
      <div class="maintenance-icon">
        <svg width="45" height="45" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
        </svg>
      </div>
      <h1 class="auth-title text-xl mb-15">System Maintenance</h1>
      <p class="muted mb-25" style="max-width: 400px; margin: 0 auto 25px auto; line-height: 1.6;">
        ${escapeHTML(data.maintenanceReason || data.MaintenanceReason || "We are currently updating our systems. Please check back later.")}
      </p>
    </div>
  `;
      return true;
    } catch (err) {
      return false;
    }
  }

  async function handleUserLogin() {
    const username = String(document.getElementById("username")?.value || "")
      .trim()
      .toLowerCase();
    const password = document.getElementById("password")?.value || "";

    if (!username || !password) {
      showMessage("Username and password are required.", "error");
      return;
    }

    showLoader("Checking credentials...");

    const wakeTimeout = window.setTimeout(() => {
      const loaderText = document.getElementById("loader-text");
      if (loaderText && loaderText.textContent === "Checking credentials...") {
        loaderText.textContent =
          "Waking up server (this can take a few seconds)...";
      }
    }, 4000);

    try {
      const result = await requestJson("/api/auth/login", {
        method: "POST",
        body: { username, password, HWID: "WEB-CLIENT" },
      });

      window.clearTimeout(wakeTimeout);

      if (!result.ok) {
        hideLoader();
        showMessage(
          extractErrorMessage(result.data, "Invalid credentials."),
          "error",
        );
        return;
      }

      const token =
        result.data.token ||
        result.data.Token ||
        result.data.jwt ||
        result.data.accessToken ||
        "";
      const isExpired = result.data.IsExpired || false;
      const storedUser = persistCurrentUser({
        token,
        username: result.data.username,
        plan: result.data.plan,
        expiry: result.data.expiry,
        isExpired: isExpired,
      });

      if (!storedUser) {
        hideLoader();
        showMessage("Login token is missing a valid role claim.", "error");
        return;
      }

      if (storedUser.role !== "User") {
        hideLoader();
        clearCurrentUser();
        showMessage(
          "This account is not allowed on the user login page.",
          "error",
        );
        return;
      }

      const loaderText = document.getElementById("loader-text");
      if (loaderText)
        loaderText.textContent = "Login successful. Redirecting...";
      goTo(USER_HOME_PAGE);
    } catch (err) {
      window.clearTimeout(wakeTimeout);
      hideLoader();
      showMessage(
        isAbortError(err)
          ? "Request timed out. Try again."
          : "Please Check Your Internet.",
        "error",
      );
    }
  }

  function handleLogout() {
    showLoader("Logging out...");
    window.setTimeout(() => {
      clearCurrentUser();
      hideLoader();
      showMessage("Logged out successfully.", "success");
      window.location.replace(resolvePagePath("index.html"));
    }, 700);
  }

  async function handleChangePassword() {
    const currentUser = getCurrentUser();

    if (
      currentUser &&
      currentUser.plan &&
      currentUser.plan.toLowerCase() === "free"
    ) {
      showMessage("Free users cannot change password.", "error");
      return;
    }
    if (!currentUser || currentUser.role !== "User") {
      clearCurrentUser();
      window.location.replace(USER_LOGIN_PAGE);
      return;
    }

    const currentPassword =
      document.getElementById("currentPassword")?.value || "";
    const newPassword = document.getElementById("newPassword")?.value || "";

    if (!currentPassword || !newPassword) {
      showMessage("Current and new password are required.", "error");
      return;
    }

    if (newPassword.length < 3) {
      showMessage("New password must be at least 3 characters long.", "error");
      return;
    }

    if (currentPassword === newPassword) {
      showMessage(
        "New password must be different from the current password.",
        "error",
      );
      return;
    }

    showLoader("Updating password...");

    try {
      const result = await requestJson("/api/auth/change-password", {
        method: "POST",
        headers: getAuthHeader(),
        body: { currentPassword, newPassword },
      });

      hideLoader();

      if (handleUserAuthFailure(result.status)) return;
      if (!result.ok) {
        showMessage(
          extractErrorMessage(result.data, "Failed to change password."),
          "error",
        );
        return;
      }

      showMessage("Password updated successfully.", "success");
      goTo(USER_HOME_PAGE);
    } catch (err) {
      hideLoader();
      showMessage(
        isAbortError(err) ? "Request timed out. Try again." : "Server error.",
        "error",
      );
    }
  }

  function bindUserForms() {
    const userLoginForm = document.getElementById("userLoginForm");
    if (userLoginForm) {
      userLoginForm.addEventListener("submit", (event) => {
        event.preventDefault();
        handleUserLogin();
      });
    }

    const changePasswordForm = document.getElementById("changePasswordForm");
    if (changePasswordForm) {
      changePasswordForm.addEventListener("submit", (event) => {
        event.preventDefault();
        handleChangePassword();
      });
    }
  }

  function bindKeyboardShortcuts() {
    const page = getCurrentPageName();

    if (page === "Ulogin.html") {
      ["username", "password"].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          handleUserLogin();
        });
      });
    }

    if (page === "change.html") {
      ["currentPassword", "newPassword"].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          handleChangePassword();
        });
      });
    }
  }

  async function handleAdminLogin() {
    const username = String(
      document.getElementById("adminUsername")?.value || "",
    )
      .trim()
      .toLowerCase();
    const password = document.getElementById("adminPassword")?.value || "";

    if (!username || !password) {
      showMessage("Username and password are required.", "error");
      return;
    }

    showLoader("Checking admin credentials...");

    try {
      const result = await requestJson("/api/admin/login", {
        method: "POST",
        body: { username, password },
      });

      if (!result.ok) {
        hideLoader();
        showMessage(
          extractErrorMessage(result.data, "Invalid admin credentials."),
          "error",
        );
        return;
      }

      const token =
        result.data.token ||
        result.data.Token ||
        result.data.jwt ||
        result.data.accessToken ||
        "";
      const storedAdmin = persistCurrentUser({
        token,
        username: result.data.username || result.data.Username || username,
        loginTime: Date.now(),
      });

      if (!storedAdmin) {
        hideLoader();
        showMessage("Admin token is missing a valid role claim.", "error");
        return;
      }

      if (storedAdmin.role !== "Admin") {
        hideLoader();
        clearCurrentUser();
        showMessage(
          "This account is not authorized for admin access.",
          "error",
        );
        return;
      }

      setOwnerAccessCache(
        String(result.data.role || "")
          .trim()
          .toLowerCase() === "owner" || Boolean(result.data.isOwner),
      );
      hideLoader();
      showMessage("Admin login successful.", "success");
      goTo("Adash.html");
    } catch (err) {
      hideLoader();
      showMessage(
        isAbortError(err)
          ? "Request timed out. Try again."
          : "Please Check Your Internet.",
        "error",
      );
    }
  }

  function bindAdminLoginForm() {
    const form = document.getElementById("adminLoginForm");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        handleAdminLogin();
      });
    }

    ["adminUsername", "adminPassword"].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        handleAdminLogin();
      });
    });
  }

  async function loadUserDash() {
    const currentUser = getCurrentUser();
    if (!currentUser || currentUser.role !== "User") {
      clearCurrentUser();
      window.location.replace(USER_LOGIN_PAGE);
      return;
    }

    const nameEl = document.getElementById("dashUsername");
    const planEl = document.getElementById("dashPlan");
    const expiryEl = document.getElementById("dashExpiry");
    const statusEl = document.getElementById("dashOrderStatus");
    const keyEl = document.getElementById("dashOrderKey");
    const copyBtn = document.getElementById("copyDashKeyBtn");
    const keyStatusEl = document.getElementById("dashKeyStatus");
    const statusCard = document.getElementById("status-card");
    const keyCard = document.getElementById("key-card");
    const downloadBtn = document.getElementById("downloadPanelBtn");



    if (nameEl)
      nameEl.textContent = String(currentUser.username || "user").toUpperCase();
    if (planEl)
      planEl.textContent = String(currentUser.plan || "Temp").toUpperCase();
    // 🔒 HIDE CHANGE PASSWORD OPTION FOR FREE USERS
    if (currentUser.plan && currentUser.plan.toLowerCase() === "free") {
      const changeLink = document.querySelector('a[href="change.html"]');
      if (changeLink) changeLink.style.display = "none";
    }

    // yaha tak change password link hide karne ka code hai, iske baad expiry date set karne ka code hai
    if (expiryEl)
      expiryEl.textContent = currentUser.expiry
        ? formatDateTime(currentUser.expiry)
        : "N/A (Temp)";

    try {
      const result = await requestJson("/api/auth/my-order", {
        method: "GET",
        headers: getAuthHeader(),
        retries: 0,
      });

      if (handleUserAuthFailure(result.status)) return;
      if (!statusEl || !keyEl) return;

      if (result.status === 404) {
        statusEl.textContent = "NO ACTIVE ORDERS";
        statusEl.className = "stat-value text-xl muted";
        if (statusCard) statusCard.className = "stat-card border-surface";
        if (keyCard) keyCard.className = "stat-card border-surface";
        if (keyStatusEl) {
          keyStatusEl.textContent = "";
          keyStatusEl.className = "badge d-none";
        }
        if (copyBtn) {
          copyBtn.style.display = "none";
          copyBtn.onclick = null;
        }
        if (downloadBtn) {
          downloadBtn.style.display = "none";
          downloadBtn.onclick = null;
        }
        return;
      }

      if (!result.ok || !result.data) {
        statusEl.textContent = "SERVER ERROR";
        statusEl.className = "stat-value text-xl title-danger";
        if (statusCard) statusCard.className = "stat-card border-surface";
        if (keyCard) keyCard.className = "stat-card border-surface";
        if (keyStatusEl) {
          keyStatusEl.textContent = "";
          keyStatusEl.className = "badge d-none";
        }
        if (copyBtn) {
          copyBtn.style.display = "none";
          copyBtn.onclick = null;
        }
        if (downloadBtn) {
          downloadBtn.style.display = "none";
          downloadBtn.onclick = null;
        }
        showMessage(
          extractErrorMessage(
            result.data,
            "Unable to load your dashboard right now.",
          ),
          "error",
        );
        return;
      }

      const liveStatus = String(result.data.status || "Pending");
      const livePlan = String(result.data.plan || currentUser.plan || "Temp");
      const liveExpiry =
        result.data.expiry ||
        result.data.expiryTime ||
        currentUser.expiry ||
        null;
      const orderKey = String(result.data.key || "");
      const hasIssuedKey =
        Boolean(orderKey) && !/pending|contact/i.test(orderKey);
      const isApproved = liveStatus.toLowerCase() === "approved";
      const normalizedKeyStatus = Boolean(result.data.isKeyUsed)
        ? "USED"
        : "UNUSED";
      const persistedUser = persistCurrentUser({
        ...currentUser,
        token: currentUser.token,
        plan: livePlan,
        expiry: liveExpiry,
        loginTime: currentUser.loginTime,
      });

      // 🔥 Naya UI Logic Start 🔥
      const alertBox = document.getElementById("dashboardAlertBox");
      const expiryIcon = document.getElementById("expiryIcon");
      const statusIcon = document.getElementById("statusIcon");

      // 🔥 BUG FIX: Unused/Pending keys ko expired show hone se roko
      let isTempOrExpired = false;
      if (liveStatus.toLowerCase() === "pending" || normalizedKeyStatus === "UNUSED" || livePlan.toLowerCase() === "temp") {
        isTempOrExpired = false;
      } else {
        isTempOrExpired = !liveExpiry || new Date(liveExpiry).getFullYear() < 2000 || new Date(liveExpiry) < new Date();
      }

      if (persistedUser && planEl) planEl.textContent = livePlan.toUpperCase();

      if (expiryEl) {
        expiryEl.textContent = liveExpiry
          ? formatDateTime(liveExpiry)
          : "N/A (Pending/Temp)";
        if (expiryIcon) expiryIcon.textContent = isTempOrExpired ? "🔴" : "🟢";
        if (isTempOrExpired && expiryEl)
          expiryEl.className = "stat-value text-md text-danger";
        else if (expiryEl)
          expiryEl.className = "stat-value text-md text-success";
      }

      statusEl.textContent = liveStatus.toUpperCase();
      statusEl.className = "stat-value text-xl mb-0";
      keyEl.textContent = hasIssuedKey ? orderKey : "Pending Approval";

      if (statusCard)
        statusCard.className = `stat-card ${isApproved ? "status-approved-border" : "border-surface"}`;
      if (keyCard)
        keyCard.className = `stat-card ${isApproved ? "status-approved-border" : "border-surface"}`;
      statusEl.classList.add(
        isApproved ? "status-approved-text" : "text-warning",
      );

      if (statusIcon)
        statusIcon.textContent = isApproved
          ? "✅"
          : liveStatus.toLowerCase() === "rejected"
            ? "❌"
            : "⏳";

      // Alert Box Show/Hide Logic
      if (alertBox) {
        const alertHeading = document.getElementById("alertHeading");
        if (liveStatus.toLowerCase() === "pending") {
          alertBox.classList.remove("d-none");
          alertBox.className = "alert-box alert-warning";
          document.getElementById("dashboardAlertText").textContent =
            "Your payment is under review. Please wait for admin approval.";
          if (alertHeading) alertHeading.className = "text-warning mb-5 mt-0";
        } else if (isTempOrExpired && livePlan.toLowerCase() !== "free") {
          alertBox.classList.remove("d-none");
          alertBox.className = "alert-box alert-danger";
          document.getElementById("dashboardAlertText").textContent =
            "Your subscription has expired. Renew now to regain access.";
          if (alertHeading) alertHeading.className = "text-danger mb-5 mt-0";
        } else {
          alertBox.classList.add("d-none");
        }
      }
      // 🔥 Naya UI Logic End 🔥

      if (keyStatusEl && hasIssuedKey) {
        keyStatusEl.textContent = normalizedKeyStatus;
        // ... baaki ka code same rahega copy button aur download button wala
        keyStatusEl.className = `badge ${normalizedKeyStatus === "USED" ? "bad" : "good"} d-inline-flex`;
      } else if (keyStatusEl) {
        keyStatusEl.textContent = "";
        keyStatusEl.className = "badge d-none";
      }

     if (copyBtn && hasIssuedKey) {
        copyBtn.classList.remove("d-none", "hidden-default"); // 🔥 CSS se bhi hide hatana zaroori hai
        copyBtn.style.display = "block";
        copyBtn.onclick = () =>
          copyTextToClipboard(orderKey, copyBtn, "Copy Key");
      } else if (copyBtn) {
        copyBtn.classList.add("d-none"); // 🔥 CSS se proper hide karo
        copyBtn.style.display = "none";
        copyBtn.onclick = null;
      }

      const planSlug = String(result.data.plan || currentUser.plan || "")
        .trim()
        .toLowerCase();
      if (downloadBtn && planSlug && planSlug !== "temp" && isApproved) {
        downloadBtn.style.display = "inline-flex";
        downloadBtn.onclick = async (event) => {
          event.preventDefault();
          showLoader("Fetching secure download...");

          try {
            const downloadResult = await requestJson(
              `/api/auth/download?plan=${encodeURIComponent(planSlug)}`,
              {
                method: "GET",
                headers: getAuthHeader(),
                retries: 0,
              },
            );

            hideLoader();

            if (handleUserAuthFailure(downloadResult.status)) return;
            if (
              !downloadResult.ok ||
              !downloadResult.data ||
              !downloadResult.data.url
            ) {
              showMessage("Download is unavailable for this account.", "error");
              return;
            }

            safeOpenExternal(downloadResult.data.url);
          } catch (err) {
            hideLoader();
            showMessage("Download server is unavailable right now.", "error");
          }
        };
      } else if (downloadBtn) {
        downloadBtn.style.display = "none";
        downloadBtn.onclick = null;
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = "ERROR FETCHING";
        statusEl.className = "stat-value text-xl title-danger";
      }
      if (downloadBtn) {
        downloadBtn.style.display = "none";
        downloadBtn.onclick = null;
      }
    }
  }

  function initCheckoutPage() {
    if (getCurrentPageName() !== "checkout.html") return;

    // 🔥 1. Sabhi Panels ki Base Price ($ USD mein)
    const basePrices = {
      free: 0,
      sniper: 1,
      aimbot: 1,
      streamer: 2,
      special: 3,
      premium: 5,
      customised: 10,
    };

    const usdToInr = 90; // $1 = 90 INR
    const params = new URLSearchParams(window.location.search);
    const selectedPanel = String(params.get("panel") || "")
      .trim()
      .toLowerCase();

    const displayPanelName = document.getElementById("displayPanelName");
    const selectDays = document.getElementById("selectDays");
    const displayPrice = document.getElementById("displayPrice");
    const checkoutForm = document.getElementById("checkoutForm");
    const proofInput = document.getElementById("paymentProofImg");
    const proofGroup = document.getElementById("paymentProofGroup");
    const paymentBox = document.querySelector(".instruction-box");
    const allowedProofTypes = new Set(["image/png", "image/jpeg", "image/jpg"]);

    if (!selectedPanel || basePrices[selectedPanel] === undefined) {
      showMessage("No valid panel selected.", "error");
      goTo("index.html", 50);
      return;
    }

    // Is panel ka Base Price set karo
    const basePriceUSD = basePrices[selectedPanel];

    if (displayPanelName) {
      displayPanelName.textContent = `${selectedPanel.toUpperCase()} PANEL`;
    }

    function updatePaymentLinks(totalInr) {
      const upiUrl = `upi://pay?pa=naveedmushtaq@ptyes&pn=${encodeURIComponent("Dark Skull Corp")}&am=${totalInr}&cu=INR&tn=DSC-${selectedPanel}`;
      const upiPayBtn = document.getElementById("upiPayBtn");
      const qrImage = document.getElementById("qrImage");
      const qrLoading = document.getElementById("qrLoading");

      if (upiPayBtn) upiPayBtn.href = upiUrl;
      if (qrImage) {
        qrImage.style.display = "none";
        if (qrLoading) qrLoading.style.display = "block";

        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiUrl)}`;
        qrImage.onload = () => {
          qrImage.style.display = "block";
          if (qrLoading) qrLoading.style.display = "none";
        };
      }
    }

    function updatePrice() {
      if (!selectDays || !displayPrice) return;

      const days = parseInt(selectDays.value, 10);

      // 🔥 2. Days Multiplier (Jitne din, utna guna price)
      let multiplier = 1;
      if (days === 1) multiplier = 0.5;
      else if (days === 3) multiplier = 1;
      else if (days === 7) multiplier = 2;
      else if (days === 15) multiplier = 3;
      else if (days === 30) multiplier = 4;
      else if (days === 60) multiplier = 6;
      else if (days === 365) multiplier = 8;
      else {
        displayPrice.textContent = "Unsupported duration";
        return;
      }

      // 🔥 3. Yahan Ho Raha Hai BasePrice * Multiplier
      const totalUsd = basePriceUSD * multiplier;
      const totalInr = totalUsd * usdToInr;

      displayPrice.textContent = `USD ${totalUsd} (${totalInr} INR)`;

      if (totalInr === 0 || selectedPanel === "free") {
        paymentBox?.classList.add("d-none");
        proofGroup?.classList.add("d-none");
        if (proofInput) proofInput.value = "";
      } else {
        paymentBox?.classList.remove("d-none");
        proofGroup?.classList.remove("d-none");
        updatePaymentLinks(totalInr);
      }
    }

    if (selectDays) {
      selectDays.addEventListener("change", updatePrice);
      updatePrice();
    }
    // 🔥 NAYA LOGIC: Image Preview Setup 🔥
    const previewBox = document.getElementById("imagePreviewBox");
    const previewImg = document.getElementById("imagePreview");

    if (proofInput) {
      proofInput.addEventListener("change", function () {
        const file = this.files[0];
        if (file) {
          // File read karke preview mein show karo
          const reader = new FileReader();
          reader.onload = function (e) {
            if (previewImg) previewImg.src = e.target.result;
            if (previewBox) previewBox.classList.remove("d-none");
          };
          reader.readAsDataURL(file);
        } else {
          // Agar user ne file cancel kar di toh preview hata do
          if (previewImg) previewImg.src = "";
          if (previewBox) previewBox.classList.add("d-none");
        }
      });
    }
    if (!checkoutForm) return;

    checkoutForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const username = String(
        document.getElementById("regUsername")?.value || "",
      )
        .trim()
        .toLowerCase();
      const password = document.getElementById("regPassword")?.value || "";
      const regDiscord =
        String(document.getElementById("regDiscord")?.value || "").trim() ||
        "None";
      const days = parseInt(selectDays.value, 10);
      const requiresScreenshotProof = selectedPanel !== "free";
      const proofFile = proofInput?.files?.[0] ?? null;

      if (!username || !password) {
        showMessage("Username and password are required.", "error");
        return;
      }

      if (password.length < 3) {
        showMessage("Password must be at least 3 characters long.", "error");
        return;
      }

      // 🔥 FIX 1: Screenshot Image ko read karne wala code (Fixed)
      let base64String = "";

      if (requiresScreenshotProof && !proofFile) {
        showMessage("Screenshot proof is required.", "error");
        return;
      }

      if (proofFile) {
        if (
          !allowedProofTypes.has(String(proofFile.type || "").toLowerCase())
        ) {
          showMessage("Please upload a valid image file.", "error");
          return;
        }

        if (proofFile.size > 5 * 1024 * 1024) {
          showMessage("Image is too large! Max allowed is 5MB.", "error");
          return;
        }

        base64String = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(proofFile);
          reader.onload = () => resolve(reader.result);
          reader.onerror = (error) => reject(error);
        });
      }

      const orderData = {
        Username: username,
        PasswordHash: password,
        DiscordId: regDiscord,
        Plan: selectedPanel,
        Days: days,
        Amount:
          displayPrice.innerText ||
          displayPrice.textContent ||
          displayPrice.value ||
          "Amount Pending",
        TxnId: "SS_PROOF_ONLY",
        PaymentProofBase64: base64String,
      };

      const submitBtn = checkoutForm.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.textContent = requiresScreenshotProof
          ? "Uploading Proof & Processing..."
          : "Processing...";
        submitBtn.disabled = true;
      }

      showLoader("Submitting order for approval...");

      try {
        const result = await requestJson("/api/auth/checkout", {
          method: "POST",
          body: orderData,
        });
        hideLoader();

        if (!result.ok) {
          showMessage(
            extractErrorMessage(result.data, "Order submission failed."),
            "error",
          );
          if (submitBtn) {
            submitBtn.textContent = "Submit Order for Approval";
            submitBtn.disabled = false;
          }
          return;
        }

        showMessage(
          "Order placed successfully. Track it from the login dashboard.",
          "success",
        );
        goTo(USER_LOGIN_PAGE, 1200);
      } catch (err) {
        hideLoader();
        showMessage("Server error. Please try again.", "error");
        if (submitBtn) {
          submitBtn.textContent = "Submit Order for Approval";
          submitBtn.disabled = false;
        }
      }
    });
  }

  async function fetchFreePanelPageStatus() {
    if (getCurrentPageName() !== "freepanel.html") return;

    const loader = document.getElementById("freePanelLoader");
    const content = document.getElementById("freePanelContent");
    const availableBox = document.getElementById("freeAvailableBox");
    const fullMessage = document.getElementById("freeFullMsg");

    try {
      const result = await requestJson("/api/public/free-panel", {
        method: "GET",
        retries: 0,
      });

      // Loader hide karo cleanly
      if (loader) {
        loader.style.display = "none";
        loader.classList.add("d-none");
      }
      if (content) {
        content.style.display = "block";
        content.classList.remove("d-none");
      }

      const usedSlots = Number(
        result.data.usedSlots || result.data.UsedSlots || 0,
      );
      const maxSlots = Number(
        result.data.maxSlots || result.data.MaxSlots || 20,
      );

      // 🔥 FIX 1: API se aaye capital ya small letters dono ko pakadne ka logic
      const fUser =
        result.data.freeUser ||
        result.data.FreeUser ||
        result.data.freeUsername ||
        result.data.FreeUsername;
      const fPass =
        result.data.freePass ||
        result.data.FreePass ||
        result.data.freePassword ||
        result.data.FreePassword;
      const fLink = result.data.freeLink || result.data.FreeLink;

      const remaining = maxSlots - usedSlots;

      // 🔥 FIX 2: Hamesha user/pass show karo agar admin ne set kiya hai
      if (fUser && fPass) {
        if (availableBox) {
          // CSS d-none class ko remove karna zaroori hai
          availableBox.classList.remove("d-none");
          availableBox.style.display = "block";
        }

        document.getElementById("displayFreeUser").textContent = fUser;
        document.getElementById("displayFreePass").textContent = fPass;

        // Slot Text & Progress Bar Update
        const displayRemainingText = document.getElementById(
          "displayRemainingText",
        );
        const progressBar = document.getElementById("slotProgressBar");

        if (displayRemainingText)
          displayRemainingText.textContent = `${usedSlots} / ${maxSlots} Slots Used`;

        if (progressBar) {
          const percentage =
            maxSlots > 0 ? Math.min((usedSlots / maxSlots) * 100, 100) : 0;
          progressBar.style.width = `${percentage}%`;
          if (percentage > 85)
            progressBar.style.backgroundColor = "var(--danger)";
          else if (percentage > 60)
            progressBar.style.backgroundColor = "var(--warning)";
          else progressBar.style.backgroundColor = "var(--success)";
        }

        // Copy Buttons Bind
        const copyUserBtn = document.getElementById("copyUserBtn");
        const copyPassBtn = document.getElementById("copyPassBtn");

        if (copyUserBtn) {
          copyUserBtn.onclick = () => {
            navigator.clipboard.writeText(fUser);
            copyUserBtn.textContent = "Copied!";
            setTimeout(() => (copyUserBtn.textContent = "Copy"), 1500);
          };
        }

        if (copyPassBtn) {
          copyPassBtn.onclick = () => {
            navigator.clipboard.writeText(fPass);
            copyPassBtn.textContent = "Copied!";
            setTimeout(() => (copyPassBtn.textContent = "Copy"), 1500);
          };
        }

        // Download Button Setup
        const downloadBtn = document.getElementById("freePanelDownloadBtn");
        if (downloadBtn) {
          downloadBtn.href = fLink || "#";
        }

        // NAYA LOGIC: Agar slots full hain toh neechay "Slots Full" ka warning dikhao
        if (remaining <= 0) {
          if (fullMessage) {
            const title = fullMessage.querySelector("h3");
            const desc = fullMessage.querySelector("p");
            if (title) title.textContent = "Slots Full";
            if (desc)
              desc.textContent =
                "No Slot is Available . Existing users can still download.";
            fullMessage.classList.remove("d-none");
            fullMessage.style.display = "block";
          }
        } else {
          if (fullMessage) {
            fullMessage.classList.add("d-none");
            fullMessage.style.display = "none";
          }
        }
      } else {
        // Agar Admin ne credentials hata diye hain (Offline mode)
        if (availableBox) {
          availableBox.classList.add("d-none");
          availableBox.style.display = "none";
        }
        if (fullMessage) {
          const title =
            fullMessage.querySelector("h3") ||
            fullMessage.querySelector("p.text-danger.fw-bold");
          if (title) title.textContent = "Free Panel Not Available";

          const desc =
            fullMessage.querySelector("p.muted") ||
            fullMessage.querySelector("p.text-small");
          if (desc)
            desc.textContent =
              "The free panel is currently offline. Please check back later.";

          fullMessage.classList.remove("d-none");
          fullMessage.style.display = "block";
        }
      }
    } catch (err) {
      if (loader) {
        loader.style.display = "none";
        loader.classList.add("d-none");
      }
      if (fullMessage) {
        fullMessage.classList.remove("d-none");
        fullMessage.style.display = "block";
      }
    }
  }

  function startKeepAlivePing() {
    setInterval(
      async () => {
        if (document.hidden) return;
        try {
          await fetch(apiUrl("/api/public/free-panel"), {
            method: "GET",
            cache: "no-store",
          });
        } catch (e) {
          void e;
        }
      },
      2 * 60 * 1000,
    );
  }

  let pendingDeleteAction = null;
  let pendingOrderAction = null;

  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  function openDeleteConfirmation(targetLabel, action) {
    const targetLabelEl = document.getElementById("deleteTargetUsername");
    pendingDeleteAction = action;
    if (targetLabelEl) targetLabelEl.textContent = targetLabel;
    openModal("deleteConfirmModal");
  }

  function closeDeleteConfirmation() {
    pendingDeleteAction = null;
    closeModal("deleteConfirmModal");
  }

  async function executeDeleteConfirmation() {
    const action = pendingDeleteAction;
    closeDeleteConfirmation();
    if (typeof action === "function") {
      await action();
    }
  }

  function openOrderConfirmation(mode, action) {
    const modalCard = document.getElementById("orderModalCard");
    const iconContainer = document.getElementById("orderModalIcon");
    const titleEl = document.getElementById("orderModalTitle");
    const actionTextEl = document.getElementById("orderModalActionText");
    const confirmBtn = document.getElementById("confirmOrderBtn");

    pendingOrderAction = action;

    if (modalCard) modalCard.className = "modal-card modal-card-center";
    if (titleEl) titleEl.className = "modal-title modal-title-large";
    if (actionTextEl) {
      actionTextEl.className = "highlight-text";
      actionTextEl.textContent = mode.toUpperCase();
    }
    if (iconContainer) iconContainer.className = "modal-icon-box";

    if (mode === "approve") {
      if (modalCard) modalCard.classList.add("modal-approve-state");
      if (titleEl) titleEl.classList.add("text-approve-state");
      if (actionTextEl) actionTextEl.classList.add("text-approve-state");
      if (iconContainer) {
        iconContainer.classList.add("icon-approve-state");
        iconContainer.innerHTML = `<svg width="24" height="24" fill="none" stroke="var(--success)" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`;
      }
      if (confirmBtn) {
        confirmBtn.className = "btn btn-success";
        confirmBtn.textContent = "Yes, Approve!";
      }
    } else {
      if (modalCard) modalCard.classList.add("modal-reject-state");
      if (titleEl) titleEl.classList.add("text-reject-state");
      if (actionTextEl) actionTextEl.classList.add("text-reject-state");
      if (iconContainer) {
        iconContainer.classList.add("icon-reject-state");
        iconContainer.innerHTML = `<svg width="24" height="24" fill="none" stroke="var(--danger)" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>`;
      }
      if (confirmBtn) {
        confirmBtn.className = "btn btn-danger";
        confirmBtn.textContent = "Yes, Reject!";
      }
    }

    openModal("orderConfirmModal");
  }

  function closeOrderConfirmation() {
    pendingOrderAction = null;
    closeModal("orderConfirmModal");
  }

  async function executeOrderConfirmation() {
    const action = pendingOrderAction;
    closeOrderConfirmation();
    if (typeof action === "function") {
      await action();
    }
  }

  function bindSharedAdminModals() {
    const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
    const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
    const confirmOrderBtn = document.getElementById("confirmOrderBtn");
    const cancelOrderBtn = document.getElementById("cancelOrderBtn");
    const closeEditModalBtn = document.getElementById("closeEditModal");
    const closeCreateAdminBtn = document.getElementById(
      "closeCreateAdminModal",
    );
    const closeAdminPassBtn = document.getElementById("closeAdminPassModal");
    const closeOwnerEditBtn = document.getElementById("closeOwnerEdit");

    if (confirmDeleteBtn)
      confirmDeleteBtn.addEventListener("click", executeDeleteConfirmation);
    if (cancelDeleteBtn)
      cancelDeleteBtn.addEventListener("click", closeDeleteConfirmation);
    if (confirmOrderBtn)
      confirmOrderBtn.addEventListener("click", executeOrderConfirmation);
    if (cancelOrderBtn)
      cancelOrderBtn.addEventListener("click", closeOrderConfirmation);
    if (closeEditModalBtn)
      closeEditModalBtn.addEventListener("click", () =>
        closeModal("editModal"),
      );
    if (closeCreateAdminBtn)
      closeCreateAdminBtn.addEventListener("click", () =>
        closeModal("createAdminModal"),
      );
    if (closeAdminPassBtn)
      closeAdminPassBtn.addEventListener("click", () =>
        closeModal("adminPassModal"),
      );
    if (closeOwnerEditBtn)
      closeOwnerEditBtn.addEventListener("click", () =>
        closeModal("ownerEditModal"),
      );

    window.addEventListener("click", (event) => {
      [
        "editModal",
        "createAdminModal",
        "ownerEditModal",
        "adminPassModal",
      ].forEach((modalId) => {
        const modal = document.getElementById(modalId);
        if (modal && event.target === modal) closeModal(modalId);
      });

      const deleteModal = document.getElementById("deleteConfirmModal");
      if (deleteModal && event.target === deleteModal)
        closeDeleteConfirmation();

      const orderModal = document.getElementById("orderConfirmModal");
      if (orderModal && event.target === orderModal) closeOrderConfirmation();
    });
  }

  function createBadge(text, typeClass) {
    const span = document.createElement("span");
    span.className = `badge ${typeClass}`;
    span.textContent = text;
    return span;
  }

  function createCell(value, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent =
      value === null || value === undefined || value === ""
        ? "-"
        : String(value);
    return cell;
  }

  function updateOwnerUi(isOwner) {
    toggleControlVisibility(document.getElementById("OwnerDBBtn"), isOwner);
    toggleControlVisibility(
      document.getElementById("openCreateAdminBtn"),
      isOwner,
    );
  }

  function openUserEditModal(id, plan, expiryIso, isBanned, username) {
    const idField = document.getElementById("editUserId");
    const planField = document.getElementById("editPlan");
    const expiryField = document.getElementById("editExpiry");
    const banField = document.getElementById("editBanStatus");
    const form = document.getElementById("adminEditForm");
    const ownerCache = getOwnerAccessCache();

    if (idField) idField.value = String(id);
    if (planField) planField.value = String(plan || "");
    if (expiryField) expiryField.value = toDatetimeLocal(expiryIso);
    if (banField) banField.value = isBanned ? "true" : "false";

    let deleteBtn = document.getElementById("modalDeleteUserBtn");
    if (form && ownerCache && ownerCache.isOwner) {
      if (!deleteBtn) {
        deleteBtn = document.createElement("button");
        deleteBtn.id = "modalDeleteUserBtn";
        deleteBtn.type = "button";
        deleteBtn.className = "btn btn-outline btn-db-delete mt-15 btn-full";
        form.appendChild(deleteBtn);
      }

      deleteBtn.textContent = "Permanently Delete Record";
      deleteBtn.style.display = "block";
      deleteBtn.onclick = () => {
        closeModal("editModal");
        deleteUser(id, username);
      };
    } else if (deleteBtn) {
      deleteBtn.style.display = "none";
    }

    openModal("editModal");
  }

  async function saveUserEdit() {
    const userId = Number(document.getElementById("editUserId")?.value || 0);
    const plan = String(
      document.getElementById("editPlan")?.value || "",
    ).trim();
    const expiryTime = toIsoOrNullFromDatetimeLocal(
      document.getElementById("editExpiry")?.value || "",
    );
    const isBanned = document.getElementById("editBanStatus")?.value === "true";

    if (userId <= 0 || !plan) {
      showMessage("User ID and plan are required.", "error");
      return;
    }

    showLoader("Saving changes...");

    try {
      const result = await requestJson("/api/admin/user/update", {
        method: "PUT",
        headers: getAuthHeader(),
        body: { userId, plan, expiryTime, isBanned },
      });

      hideLoader();
      if (handleAdminAuthFailure(result.status)) return;
      if (!result.ok) {
        showMessage(
          extractErrorMessage(result.data, "Failed to update user."),
          "error",
        );
        return;
      }

      closeModal("editModal");
      showMessage("User updated successfully.", "success");
      await loadAdminDash();
    } catch (err) {
      hideLoader();
      showMessage(
        isAbortError(err) ? "Request timed out. Try again." : "Server error.",
        "error",
      );
    }
  }

  function deleteUser(userId, username) {
    openDeleteConfirmation(String(username || `User #${userId}`), async () => {
      showLoader("Deleting user...");

      try {
        const result = await requestJson(`/api/admin/user/delete/${userId}`, {
          method: "DELETE",
          headers: getAuthHeader(),
        });

        hideLoader();
        if (handleAdminAuthFailure(result.status)) return;
        if (!result.ok) {
          showMessage(
            extractErrorMessage(result.data, "Failed to delete user."),
            "error",
          );
          return;
        }

        showMessage(`User ${username} deleted successfully.`, "success");
        await loadAdminDash();
      } catch (err) {
        hideLoader();
        showMessage("Server error while deleting user.", "error");
      }
    });
  }

  function renderUsersTable(users) {
    const tbody = document.getElementById("OwnerDBBody");
    if (!tbody) return;
    tbody.innerHTML = "";
    const fragment = document.createDocumentFragment();

    users.forEach((user) => {
      const id = Number(readObjectValue(user, ["id", "Id"], 0));
      const username = String(
        readObjectValue(user, ["username", "Username"], ""),
      );
      const plan = String(readObjectValue(user, ["plan", "Plan"], "free"));
      const expiry = readObjectValue(user, ["expiryTime", "ExpiryTime"], null);
      const isBanned = Boolean(
        readObjectValue(user, ["isBanned", "IsBanned"], false),
      );

      const row = document.createElement("tr");
      row.appendChild(createCell(id > 0 ? `#${id}` : "-"));
      row.appendChild(createCell(username));
      row.appendChild(createCell(plan));
      row.appendChild(createCell(formatDateTime(expiry)));

      const statusCell = document.createElement("td");
      statusCell.appendChild(
        createBadge(isBanned ? "Banned" : "Active", isBanned ? "bad" : "good"),
      );
      row.appendChild(statusCell);

      const actionCell = document.createElement("td");
      actionCell.className = "row-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-danger";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () =>
        openUserEditModal(id, plan, expiry, isBanned, username),
      );
      actionCell.appendChild(editBtn);
      row.appendChild(actionCell);

      fragment.appendChild(row);
    });

    tbody.appendChild(fragment);
  }

  async function loadAdminDash() {
    const ordersSection = document.getElementById("ordersSection");
    if (ordersSection) ordersSection.style.display = "block";

    showLoader("Loading dashboard...");

    try {
      const isOwner = await verifyOwnerAccess();
      updateOwnerUi(isOwner);

      const result = await requestJson("/api/admin/users", {
        method: "GET",
        headers: getAuthHeader(),
      });

      if (handleAdminAuthFailure(result.status)) {
        hideLoader();
        return;
      }

      if (!result.ok) {
        hideLoader();
        showMessage(
          extractErrorMessage(result.data, "Failed to load users."),
          "error",
        );
        return;
      }

      renderUsersTable(normalizeUsersPayload(result.data));
      await loadPendingOrders();
      hideLoader();
    } catch (err) {
      hideLoader();
      showMessage(
        isAbortError(err)
          ? "Request timed out. Try again."
          : "Failed to load dashboard.",
        "error",
      );
    }
  }

  async function loadPendingOrders() {
    const tbody = document.getElementById("OrdersTableBody");
    if (!tbody) return;

    try {
      const result = await requestJson("/api/admin/orders/pending", {
        method: "GET",
        headers: getAuthHeader(),
      });

      if (handleAdminAuthFailure(result.status)) return;

      const orders = normalizeListPayload(result.data, [
        "orders",
        "Orders",
        "pendingOrders",
        "PendingOrders",
      ]);
      if (!result.ok || orders.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="7" class="text-center muted">No pending orders.</td></tr>';
        return;
      }

      tbody.innerHTML = "";
      const fragment = document.createDocumentFragment();
      orders.forEach((order) => {
        const row = document.createElement("tr");

        // 🔥 FIX: Ab JSON case-sensitive issue nahi aayega, sab data correctly fetch hoga
        const orderId = readObjectValue(order, ["id", "Id"]);

        row.appendChild(createCell(`#${orderId}`));
        row.appendChild(
          createCell(
            readObjectValue(order, ["username", "Username"]),
            "fw-bold text-white",
          ),
        );
        row.appendChild(
          createCell(
            readObjectValue(order, ["discordId", "DiscordId"], "None"),
          ),
        );

        const planStr = String(
          readObjectValue(order, ["plan", "Plan"], ""),
        ).toUpperCase();
        const daysVal = readObjectValue(order, ["days", "Days"], 0);
        row.appendChild(createCell(`${planStr} (${daysVal}D)`));

        row.appendChild(
          createCell(
            readObjectValue(order, ["amount", "Amount"], "-"),
            "text-gold fw-bold",
          ),
        );
        row.appendChild(
          createCell(
            readObjectValue(order, ["txnId", "TxnId"], "-"),
            "font-orbitron text-secondary",
          ),
        );

        const actionCell = document.createElement("td");
        actionCell.className = "row-actions";

        const approveBtn = document.createElement("button");
        approveBtn.type = "button";
        approveBtn.className = "btn-success";
        approveBtn.innerHTML = "✅ Approve"; // Emoji add kiya
        approveBtn.style.padding = "5px 12px";
        approveBtn.addEventListener("click", () =>
          processOrder(orderId, "approve"),
        );

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "btn-danger";
        rejectBtn.innerHTML = "❌ Reject"; // Emoji add kiya
        rejectBtn.style.padding = "5px 12px";
        rejectBtn.addEventListener("click", () =>
          processOrder(orderId, "reject"),
        );

        actionCell.appendChild(approveBtn);
        actionCell.appendChild(rejectBtn);
        row.appendChild(actionCell);
        fragment.appendChild(row);
      });
      tbody.appendChild(fragment);
    } catch (err) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-center title-danger">Failed to load orders.</td></tr>';
    }
  }

  function processOrder(orderId, mode) {
    openOrderConfirmation(mode, async () => {
      showLoader(`Processing order ${mode}...`);

      try {
        const result = await requestJson(
          `/api/admin/orders/${mode}/${orderId}`,
          {
            method: "POST",
            headers: getAuthHeader(),
            body: {},
          },
        );

        hideLoader();
        if (handleAdminAuthFailure(result.status)) return;
        if (!result.ok) {
          showMessage(
            extractErrorMessage(result.data, "Failed to process order."),
            "error",
          );
          return;
        }

        if (mode === "approve" && result.data && result.data.key) {
          showMessage(
            `Order approved for ${result.data.username}. Key: ${result.data.key}`,
            "success",
          );
        } else {
          showMessage(
            result.data.message || `Order ${mode}d successfully.`,
            "success",
          );
        }

        await loadPendingOrders();
      } catch (err) {
        hideLoader();
        showMessage("Server error while processing the order.", "error");
      }
    });
  }

  async function handleCreateAdmin() {
    const username = String(
      document.getElementById("newAdminUsername")?.value || "",
    )
      .trim()
      .toLowerCase();
    const password = document.getElementById("newAdminPassword")?.value || "";

    if (!username || !password) {
      showMessage("Username and password are required.", "error");
      return;
    }

    if (password.length < 6) {
      showMessage(
        "Admin passwords must be at least 6 characters long.",
        "error",
      );
      return;
    }

    showLoader("Creating admin...");

    try {
      const isOwner = await verifyOwnerAccess(true);
      if (!isOwner) {
        hideLoader();
        showMessage("Only the verified owner can create admins.", "error");
        return;
      }

      const result = await requestJson("/api/admin/create-admin", {
        method: "POST",
        headers: getAuthHeader(),
        body: { username, password },
      });

      hideLoader();
      if (handleAdminAuthFailure(result.status)) return;
      if (!result.ok) {
        showMessage(
          extractErrorMessage(result.data, "Failed to create admin."),
          "error",
        );
        return;
      }

      document.getElementById("createAdminForm")?.reset();
      closeModal("createAdminModal");
      showMessage(`Admin ${username} created successfully.`, "success");
    } catch (err) {
      hideLoader();
      showMessage(
        isAbortError(err) ? "Request timed out. Try again." : "Server error.",
        "error",
      );
    }
  }

  async function handleAdminPasswordChange() {
    const currentPassword =
      document.getElementById("adminOldPass")?.value || "";
    const newPassword = document.getElementById("adminNewPass")?.value || "";

    if (!currentPassword || !newPassword) {
      showMessage("Current and new password are required.", "error");
      return;
    }

    if (newPassword.length < 6) {
      showMessage(
        "Admin passwords must be at least 6 characters long.",
        "error",
      );
      return;
    }

    if (currentPassword === newPassword) {
      showMessage(
        "New password must be different from the current password.",
        "error",
      );
      return;
    }

    showLoader("Updating password...");

    try {
      const result = await requestJson("/api/admin/change-password", {
        method: "POST",
        headers: getAuthHeader(),
        body: { currentPassword, newPassword },
      });

      hideLoader();
      if (handleAdminAuthFailure(result.status)) return;
      if (!result.ok) {
        showMessage(
          extractErrorMessage(result.data, "Failed to update admin password."),
          "error",
        );
        return;
      }

      document.getElementById("adminChangePassForm")?.reset();
      closeModal("adminPassModal");
      showMessage("Admin password updated successfully.", "success");
    } catch (err) {
      hideLoader();
      showMessage("Please Check Your Internet.", "error");
    }
  }

  function bindDashboardControls() {
    document
      .getElementById("adminEditForm")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        saveUserEdit();
      });
    document
      .getElementById("refreshUsersBtn")
      ?.addEventListener("click", () => loadAdminDash());
    document
      .getElementById("refreshOrdersBtn")
      ?.addEventListener("click", () => loadPendingOrders());
    document
      .getElementById("openCreateAdminBtn")
      ?.addEventListener("click", () => openModal("createAdminModal"));
    document
      .getElementById("openAdminPassBtn")
      ?.addEventListener("click", () => openModal("adminPassModal"));
    document
      .getElementById("createAdminForm")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        handleCreateAdmin();
      });
    document
      .getElementById("adminChangePassForm")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        handleAdminPasswordChange();
      });
  }

  async function handleGenerateKey(event) {
    event.preventDefault();

    const plan = String(
      document.getElementById("planName")?.value || "",
    ).trim();
    const validDays = Number.parseInt(
      document.getElementById("validDays")?.value || "0",
      10,
    );
    const generatedKeyValue = document.getElementById("generatedKeyValue");
    const copyKeyBtn = document.getElementById("copyKeyBtn");

    if (!plan || validDays <= 0) {
      showMessage("Plan and valid days are required.", "error");
      return;
    }

    showLoader("Generating key...");

    try {
      const result = await requestJson("/api/admin/generate", {
        method: "POST",
        headers: getAuthHeader(),
        body: { plan, validDays },
      });

      hideLoader();
      if (handleAdminAuthFailure(result.status)) return;
      if (!result.ok) {
        showMessage(
          extractErrorMessage(result.data, "Failed to generate key."),
          "error",
        );
        return;
      }

      if (generatedKeyValue) {
        generatedKeyValue.textContent = String(result.data.key || "--");
        generatedKeyValue.classList.add("text-success");
      }
      if (copyKeyBtn) {
        copyKeyBtn.classList.remove("d-none", "hidden-default");
        copyKeyBtn.style.display = "block";
        copyKeyBtn.onclick = () =>
          copyTextToClipboard(
            generatedKeyValue?.textContent || "",
            copyKeyBtn,
            "Copy Key",
          );
      }

      document.getElementById("generateKeyForm")?.reset();
      showMessage("Key generated successfully.", "success");
    } catch (err) {
      hideLoader();
      showMessage(
        isAbortError(err) ? "Request timed out. Try again." : "Server error.",
        "error",
      );
    }
  }

  function bindGenerateKeyControls() {
    document
      .getElementById("generateKeyForm")
      ?.addEventListener("submit", handleGenerateKey);
  }

  const SETTINGS_LINK_FIELDS = [
    {
      inputId: "systemFreeLink",
      modalId: "dbSettingsFreeLink",
      key: "freeLink",
    },
    {
      inputId: "systemStreamerLink",
      modalId: "dbSettingsStreamerLink",
      key: "streamerLink",
    },
    {
      inputId: "systemSniperLink",
      modalId: "dbSettingsSniperLink",
      key: "sniperLink",
    },
    {
      inputId: "systemSpecialLink",
      modalId: "dbSettingsSpecialLink",
      key: "specialLink",
    },
    {
      inputId: "systemAimbotLink",
      modalId: "dbSettingsAimbotLink",
      key: "aimbotLink",
    },
    {
      inputId: "systemPremiumLink",
      modalId: "dbSettingsPremiumLink",
      key: "premiumLink",
    },
    {
      inputId: "systemCustomisedLink",
      modalId: "dbSettingsCustomisedLink",
      key: "customisedLink",
    },
  ];
  const DB_ENDPOINTS = {
    users: "/api/admin/users",
    keys: "/api/admin/keys",
    admins: "/api/admin/manage/admins",
    orders: "/api/admin/orders/all",
    settings: "/api/admin/settings/all",
    freeSettings: "/api/admin/settings/all", // ?? Naya option yahan add hua
    freeusers: "/api/admin/free-users",
    panelUpdates: "/api/auth/panel-updates",
  };
  const USER_COLUMN_ORDER = [
    "id",
    "Id",
    "username",
    "Username",
    "plan",
    "Plan",
    "keyValue",
    "KeyValue",
    "hwid",
    "HWID",
    "isBanned",
    "IsBanned",
    "failedLoginAttempts",
    "FailedLoginAttempts",
    "lockoutEnd",
    "LockoutEnd",
    "expiryTime",
    "ExpiryTime",
    "registrationTime",
    "RegistrationTime",
    "lastLoginTime",
    "LastLoginTime",
  ];
  const FREE_USER_COLUMN_ORDER = [
    "id",
    "Id",
    "username",
    "Username",
    "hwid",
    "HWID",
    "CaptchaToken",
    "CaptchaToken",
    "isBanned",
    "IsBanned",
    "failedLoginAttempts",
    "FailedLoginAttempts",
    "lockoutEnd",
    "LockoutEnd",
    "firstLoginTime",
    "FirstLoginTime",
    "lastLoginTime",
    "LastLoginTime",
  ];

  let cachedSettingsRecord = null;
  let currentDbTable = "users";
  let currentEditRecordId = 0;
  let currentPage = 1;
  let searchQuery = "";
  let globalDbData = [];
  const rowsPerPage = 15;

  function updateMaintenanceButtonUI(isOn) {
    const button = document.getElementById("maintenanceToggleBtn");
    if (!button) return;

    button.dataset.enabled = isOn ? "true" : "false";
    button.classList.remove("btn-maint-on", "btn-maint-off", "btn-neutral");
    button.classList.add(isOn ? "btn-maint-on" : "btn-maint-off");
    button.textContent = isOn ? "Maintenance: ON" : "Maintenance: OFF";
  }

  function buildSettingsPayload(overrides = {}) {
    const current = cachedSettingsRecord || {};

    // Hamesha purane data ko maintain rakhega jab tak overrides na aayein
    const payload = {
      id: readObjectValue(current, ["id", "Id"], 0),
      isMaintenanceMode:
        overrides.isMaintenanceMode ??
        readObjectValue(
          current,
          ["isMaintenanceMode", "IsMaintenanceMode"],
          false,
        ),
      maintenanceReason:
        overrides.maintenanceReason ??
        readObjectValue(
          current,
          ["maintenanceReason", "MaintenanceReason"],
          "",
        ),
      maxFreeSlots:
        overrides.maxFreeSlots ??
        readObjectValue(current, ["maxFreeSlots", "MaxFreeSlots"], 20),
      latestVersion:
        overrides.latestVersion ??
        readObjectValue(current, ["latestVersion", "LatestVersion"], "1.0"),
      updateUrl:
        overrides.updateUrl ??
        readObjectValue(current, ["updateUrl", "UpdateUrl"], ""),
      showHomeDownloadBtn:
        overrides.showHomeDownloadBtn ??
        readObjectValue(
          current,
          ["showHomeDownloadBtn", "ShowHomeDownloadBtn"],
          false,
        ),
      freeValidDays:
        overrides.freeValidDays ??
        readObjectValue(current, ["freeValidDays", "FreeValidDays"], 30),
      freeUsername:
        overrides.freeUsername ??
        readObjectValue(current, ["freeUsername", "FreeUsername"], ""),
      freePassword:
        overrides.freePassword ??
        readObjectValue(current, ["freePassword", "FreePassword"], ""),
      freeLink:
        overrides.freeLink ??
        readObjectValue(current, ["freeLink", "FreeLink"], ""),
      streamerLink:
        overrides.streamerLink ??
        readObjectValue(current, ["streamerLink", "StreamerLink"], ""),
      sniperLink:
        overrides.sniperLink ??
        readObjectValue(current, ["sniperLink", "SniperLink"], ""),
      specialLink:
        overrides.specialLink ??
        readObjectValue(current, ["specialLink", "SpecialLink"], ""),
      aimbotLink:
        overrides.aimbotLink ??
        readObjectValue(current, ["aimbotLink", "AimbotLink"], ""),
      premiumLink:
        overrides.premiumLink ??
        readObjectValue(current, ["premiumLink", "PremiumLink"], ""),
      customisedLink:
        overrides.customisedLink ??
        readObjectValue(current, ["customisedLink", "CustomisedLink"], ""),
    };

    return payload;
  }

  function populateSystemControlsForm(settings) {
    cachedSettingsRecord = settings || {};

    // populateSystemControlsForm() ke andar:
    const fUserInput = document.getElementById("systemFreeUser");
    const fPassInput = document.getElementById("systemFreePass");
    if (fUserInput)
      fUserInput.value = String(
        readObjectValue(settings, ["freeUsername", "FreeUsername"], ""),
      );
    if (fPassInput)
      fPassInput.value = String(
        readObjectValue(settings, ["freePassword", "FreePassword"], ""),
      );

    const maxFreeSlotsInput = document.getElementById("systemMaxFreeSlots");
    const latestVersionInput = document.getElementById("systemLatestVersion");
    const updateUrlInput = document.getElementById("systemUpdateUrl");
    const maintenanceReasonInput = document.getElementById(
      "systemMaintenanceReason",
    );

    if (maxFreeSlotsInput)
      maxFreeSlotsInput.value = String(
        readObjectValue(settings, ["maxFreeSlots", "MaxFreeSlots"], 20),
      );
    if (latestVersionInput)
      latestVersionInput.value = String(
        readObjectValue(settings, ["latestVersion", "LatestVersion"], "1.0"),
      );
    if (updateUrlInput)
      updateUrlInput.value = String(
        readObjectValue(settings, ["updateUrl", "UpdateUrl"], ""),
      );
    if (maintenanceReasonInput)
      maintenanceReasonInput.value = String(
        readObjectValue(
          settings,
          ["maintenanceReason", "MaintenanceReason"],
          "",
        ),
      );

    SETTINGS_LINK_FIELDS.forEach((field) => {
      const input = document.getElementById(field.inputId);
      if (input)
        input.value = String(
          readObjectValue(
            settings,
            [field.key, field.key.charAt(0).toUpperCase() + field.key.slice(1)],
            "",
          ),
        );
    });

    updateMaintenanceButtonUI(
      Boolean(
        readObjectValue(
          settings,
          ["isMaintenanceMode", "IsMaintenanceMode"],
          false,
        ),
      ),
    );
  }

  async function loadSystemControls() {
    try {
      const result = await requestJson("/api/admin/settings/all", {
        method: "GET",
        headers: getAuthHeader(),
        retries: 0,
      });

      if (handleAdminAuthFailure(result.status)) return;
      if (!result.ok) {
        showMessage(
          extractErrorMessage(result.data, "Failed to load system settings."),
          "error",
        );
        return;
      }

      populateSystemControlsForm(getSettingsRecord(result.data));
    } catch (err) {
      showMessage("Failed to load system controls.", "error");
    }
  }

  async function saveSystemControls() {
    const payload = buildSettingsPayload({
      maxFreeSlots: document.getElementById("systemMaxFreeSlots")?.value,
      latestVersion: document.getElementById("systemLatestVersion")?.value,
      updateUrl: document.getElementById("systemUpdateUrl")?.value,
      maintenanceReason: document.getElementById("systemMaintenanceReason")
        ?.value,
      isMaintenanceMode:
        document.getElementById("maintenanceToggleBtn")?.dataset.enabled ===
        "true",
    });
    // buildSettingsPayload() ke andar:
    payload.freeUsername = String(
      document.getElementById("systemFreeUser")?.value || "",
    ).trim();
    payload.freePassword = String(
      document.getElementById("systemFreePass")?.value || "",
    ).trim();

    SETTINGS_LINK_FIELDS.forEach((field) => {
      payload[field.key] = String(
        document.getElementById(field.inputId)?.value || "",
      ).trim();
    });

    showLoader("Saving system controls...");

    try {
      const result = await requestJson("/api/admin/settings/update", {
        method: "PUT",
        headers: getAuthHeader(),
        body: payload,
      });

      hideLoader();
      if (handleAdminAuthFailure(result.status)) return;
      if (!result.ok) {
        showMessage(
          extractErrorMessage(result.data, "Failed to update system controls."),
          "error",
        );
        return;
      }

      cachedSettingsRecord = { ...cachedSettingsRecord, ...payload };
      populateSystemControlsForm(cachedSettingsRecord);
      if (currentDbTable === "settings") await loadDbData();
      showMessage("System controls updated successfully.", "success");
    } catch (err) {
      hideLoader();
      showMessage("Server error while updating system controls.", "error");
    }
  }

  async function toggleMaintenanceMode() {
    const button = document.getElementById("maintenanceToggleBtn");
    const nextValue = button?.dataset.enabled !== "true";

    showLoader(
      nextValue ? "Enabling maintenance..." : "Disabling maintenance...",
    );

    try {
      const result = await requestJson("/api/admin/maintenance/toggle", {
        method: "POST",
        headers: getAuthHeader(),
        // 🔥 FIX: Backend ko dono formats bhej rahe hain taaki koi parsing fail na ho
        body: { isMaintenanceMode: nextValue, IsMaintenanceMode: nextValue },
      });

      hideLoader();
      if (handleAdminAuthFailure(result.status)) return;
      if (!result.ok) {
        showMessage(
          extractErrorMessage(
            result.data,
            "Failed to update maintenance mode.",
          ),
          "error",
        );
        return;
      }

      // 🔥 FIX: Response se sahi value uthayi ja rahi hai
      const isMaintNow = Boolean(
        result.data.isMaintenanceMode || result.data.IsMaintenanceMode,
      );

      cachedSettingsRecord = {
        ...(cachedSettingsRecord || {}),
        isMaintenanceMode: isMaintNow,
        IsMaintenanceMode: isMaintNow,
      };

      updateMaintenanceButtonUI(isMaintNow);
      if (currentDbTable === "settings") await loadDbData();
      showMessage(
        result.data.message || "Maintenance status updated.",
        "success",
      );
    } catch (err) {
      hideLoader();
      showMessage("Server error while toggling maintenance mode.", "error");
    }
  }

  function sortKeysForTable(keys) {
    const sorted = [...keys];

    if (currentDbTable === "users") {
      sorted.sort((left, right) => {
        const leftIndex = USER_COLUMN_ORDER.indexOf(left);
        const rightIndex = USER_COLUMN_ORDER.indexOf(right);
        return (
          (leftIndex === -1 ? 999 : leftIndex) -
          (rightIndex === -1 ? 999 : rightIndex)
        );
      });
    }

    if (currentDbTable === "freeusers") {
      sorted.sort((left, right) => {
        const leftIndex = FREE_USER_COLUMN_ORDER.indexOf(left);
        const rightIndex = FREE_USER_COLUMN_ORDER.indexOf(right);
        return (
          (leftIndex === -1 ? 999 : leftIndex) -
          (rightIndex === -1 ? 999 : rightIndex)
        );
      });
    }

    return sorted;
  }

  function bindBulkDeleteLogic() {
    const head = document.getElementById("dbTableHead");
    const body = document.getElementById("dbTableBody");
    const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");

    if (head && !head.dataset.bulkDelegateBound) {
      head.dataset.bulkDelegateBound = "true";
      head.addEventListener("change", (event) => {
        const target = event.target;
        if (
          !(target instanceof HTMLInputElement) ||
          target.id !== "selectAllCheckbox"
        )
          return;
        if (!body) return;

        body.querySelectorAll(".row-checkbox").forEach((checkbox) => {
          checkbox.checked = target.checked;
        });
        updateBulkDeleteState();
      });
    }

    if (body && !body.dataset.bulkDelegateBound) {
      body.dataset.bulkDelegateBound = "true";
      body.addEventListener("change", (event) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement &&
          target.classList.contains("row-checkbox")
        ) {
          updateBulkDeleteState();
        }
      });
    }

    if (bulkDeleteBtn) {
      bulkDeleteBtn.onclick = () => {
        const ids = Array.from(
          body ? body.querySelectorAll(".row-checkbox:checked") : [],
        )
          .map((checkbox) => checkbox.getAttribute("data-id"))
          .filter(Boolean);

        if (ids.length === 0) return;

        openDeleteConfirmation(
          `${ids.length} record(s) from ${currentDbTable.toUpperCase()}`,
          async () => {
            showLoader(`Deleting ${ids.length} record(s)...`);

            try {
              const requests = ids.map((id) => {
                const endpointMap = {
                  users: `/api/admin/user/delete/${id}`,
                  keys: `/api/admin/manage/key/delete/${id}`,
                  admins: `/api/admin/manage/admin/delete/${id}`,
                  orders: `/api/admin/orders/delete/${id}`,
                  freeusers: `/api/admin/manage/free-user/delete/${id}`,
                };

                return requestJson(endpointMap[currentDbTable], {
                  method: "DELETE",
                  headers: getAuthHeader(),
                });
              });

              const results = await Promise.all(requests);
              const failedCount = results.filter((item) => !item.ok).length;
              hideLoader();

              if (failedCount > 0) {
                showMessage(
                  `${failedCount} record(s) failed to delete.`,
                  "error",
                );
              } else {
                showMessage(
                  `Deleted ${ids.length} record(s) successfully.`,
                  "success",
                );
              }

              await loadDbData();
            } catch (err) {
              hideLoader();
              showMessage("Server error while deleting records.", "error");
            }
          },
        );
      };
    }

    updateBulkDeleteState();
  }

  function updateBulkDeleteState() {
    const body = document.getElementById("dbTableBody");
    const checkedRows = body
      ? body.querySelectorAll(".row-checkbox:checked").length
      : 0;
    const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");
    const bulkDeleteCount = document.getElementById("bulkDeleteCount");
    const selectAllCheckbox = document.getElementById("selectAllCheckbox");

    if (bulkDeleteCount) bulkDeleteCount.textContent = String(checkedRows);
    toggleControlVisibility(bulkDeleteBtn, checkedRows > 0);

    if (selectAllCheckbox) {
      const totalRows = body
        ? body.querySelectorAll(".row-checkbox").length
        : 0;
      selectAllCheckbox.checked = totalRows > 0 && checkedRows === totalRows;
    }
  }

  function renderDbTable(data) {
    const head = document.getElementById("dbTableHead");
    const body = document.getElementById("dbTableBody");
    if (!head || !body) return;

    head.innerHTML = "";
    body.innerHTML = "";

    const safeData = (data || []).filter(
      (row) => row !== null && row !== undefined,
    );
    if (safeData.length === 0) {
      const headerRow = document.createElement("tr");
      headerRow.appendChild(document.createElement("th")).textContent =
        "Status";
      head.appendChild(headerRow);

      const bodyRow = document.createElement("tr");
      const bodyCell = document.createElement("td");
      bodyCell.className = "text-center text-warning";
      bodyCell.textContent = "No records found in database.";
      bodyRow.appendChild(bodyCell);
      body.appendChild(bodyRow);
      return;
    }

    const uniqueKeys = new Set();
    safeData.forEach((row) =>
      Object.keys(row).forEach((key) => uniqueKeys.add(key)),
    );
    const keys = sortKeysForTable(Array.from(uniqueKeys));
    const bodyFragment = document.createDocumentFragment();

    const headerRow = document.createElement("tr");
    if (currentDbTable !== "settings" && currentDbTable !== "panelUpdates") {
      const checkboxHeader = document.createElement("th");
      checkboxHeader.className = "text-center";
      checkboxHeader.style.width = "40px";

      const selectAllCheckbox = document.createElement("input");
      selectAllCheckbox.type = "checkbox";
      selectAllCheckbox.id = "selectAllCheckbox";
      selectAllCheckbox.className = "scale-checkbox";
      checkboxHeader.appendChild(selectAllCheckbox);
      headerRow.appendChild(checkboxHeader);
    }

    keys.forEach((key) => {
      const th = document.createElement("th");
      th.textContent = key.toUpperCase();
      headerRow.appendChild(th);
    });

    const actionHeader = document.createElement("th");
    actionHeader.textContent = "ACTIONS";
    headerRow.appendChild(actionHeader);
    head.appendChild(headerRow);

    safeData.forEach((rowData) => {
      const row = document.createElement("tr");

      if (currentDbTable !== "settings" && currentDbTable !== "panelUpdates") {
        const checkCell = document.createElement("td");
        checkCell.className = "text-center";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "row-checkbox scale-checkbox";
        checkbox.setAttribute(
          "data-id",
          String(readObjectValue(rowData, ["id", "Id"], "")),
        );
        checkCell.appendChild(checkbox);
        row.appendChild(checkCell);
      }

      keys.forEach((key) => {
        const cell = document.createElement("td");
        const value = rowData[key];

        if (value === true) cell.appendChild(createBadge("True", "good"));
        else if (value === false) cell.appendChild(createBadge("False", "bad"));
        else if (String(key).toLowerCase() === "status") {
          // 🔥 NAYA LOGIC: Status Color Badges (Using existing classes)
          const statusStr = String(value).toLowerCase();
          if (statusStr === "approved")
            cell.appendChild(createBadge("Approved", "good"));
          else if (statusStr === "pending")
            cell.appendChild(createBadge("Pending", "warning")); // Note: "warning" might use text-warning color if no specific badge exists, or fallback to default
          else if (statusStr === "rejected")
            cell.appendChild(createBadge("Rejected", "bad"));
          else cell.textContent = value;
        } else if (String(key).toLowerCase().includes("time") && value)
          cell.textContent = new Date(value).toLocaleString();
        else
          cell.textContent =
            value === null || value === undefined || value === ""
              ? "-"
              : String(value);

        row.appendChild(cell);
      });

      const actionCell = document.createElement("td");
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-danger";
      editBtn.textContent = "Edit / Manage";
      editBtn.addEventListener("click", () => openOwnerEditModal(rowData));
      actionCell.appendChild(editBtn);
      row.appendChild(actionCell);

      bodyFragment.appendChild(row);
    });

    body.appendChild(bodyFragment);
    bindBulkDeleteLogic();
  }

  function applyFilterAndPagination() {
    let filteredData = globalDbData;

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      filteredData = globalDbData.filter((row) => {
        return Object.values(row).some((value) =>
          String(value).toLowerCase().includes(query),
        );
      });
    }

    const totalRows = filteredData.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const pageData = filteredData.slice(startIndex, startIndex + rowsPerPage);
    const pageInfoText = document.getElementById("pageInfoText");
    const prevPageBtn = document.getElementById("prevPageBtn");
    const nextPageBtn = document.getElementById("nextPageBtn");

    if (pageInfoText)
      pageInfoText.textContent = `Page ${currentPage} of ${totalPages} (${totalRows} Total)`;
    if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage === totalPages;

    renderDbTable(pageData);
  }

  async function loadDbData() {
    const endpoint = DB_ENDPOINTS[currentDbTable] || DB_ENDPOINTS.users;
    const body = document.getElementById("dbTableBody");
    const head = document.getElementById("dbTableHead");

    showLoader(`Fetching ${currentDbTable.toUpperCase()} data...`);

    try {
      const result = await requestJson(endpoint, {
        method: "GET",
        headers: getAuthHeader(),
      });

      hideLoader();
      if (handleAdminAuthFailure(result.status)) return;

      if (!result.ok) {
        if (head) head.innerHTML = "<tr><th>ERROR STATUS</th></tr>";
        if (body)
          body.innerHTML = `<tr><td class="text-center title-danger">API returned status ${result.status}.</td></tr>`;
        showMessage(
          extractErrorMessage(result.data, "Failed to load database data."),
          "error",
        );
        return;
      }

      let records = [];
      if (currentDbTable === "settings" || currentDbTable === "freeSettings") {
        // Backend dono table ka merged data bhejta hai, hum yahan usko split kar rahe hain
        const mergedData = getSettingsRecord(result.data);
        cachedSettingsRecord = mergedData;
        populateSystemControlsForm(cachedSettingsRecord);

        if (currentDbTable === "settings") {
          records = [
            {
              id: mergedData.id || 1,
              isMaintenanceMode:
                mergedData.isMaintenanceMode ?? mergedData.IsMaintenanceMode,
              latestVersion:
                mergedData.latestVersion || mergedData.LatestVersion,
              updateUrl: mergedData.updateUrl || mergedData.UpdateUrl,
              maintenanceReason:
                mergedData.maintenanceReason || mergedData.MaintenanceReason,

              // 🔥 FIX: Saari links yahan add kar di hain taaki purani links show hon aur save hon!
              freeLink: mergedData.freeLink || mergedData.FreeLink || "",
              streamerLink:
                mergedData.streamerLink || mergedData.StreamerLink || "",
              sniperLink: mergedData.sniperLink || mergedData.SniperLink || "",
              specialLink:
                mergedData.specialLink || mergedData.SpecialLink || "",
              aimbotLink: mergedData.aimbotLink || mergedData.AimbotLink || "",
              premiumLink:
                mergedData.premiumLink || mergedData.PremiumLink || "",
              customisedLink:
                mergedData.customisedLink || mergedData.CustomisedLink || "",
            },
          ];
        } else {
          records = [
            {
              id: mergedData.id || 1,
              freeUsername:
                mergedData.freeUsername || mergedData.FreeUsername || "",
              freePassword:
                mergedData.freePassword || mergedData.FreePassword || "",
              freeValidDays:
                mergedData.freeValidDays || mergedData.FreeValidDays || 30,
              maxFreeSlots:
                mergedData.maxFreeSlots || mergedData.MaxFreeSlots || 20,
              showHomeDownloadBtn:
                mergedData.showHomeDownloadBtn ??
                mergedData.ShowHomeDownloadBtn ??
                false,
            },
          ];
        }
      } else if (Array.isArray(result.data)) {
        records = result.data;
      } else if (result.data && typeof result.data === "object") {
        const arrayPayload = normalizeListPayload(result.data, [
          "users",
          "Users",
          "keys",
          "Keys",
          "admins",
          "Admins",
          "orders",
          "Orders",
          "freeUsers",
          "FreeUsers",
          "freeusers",
        ]);
        records = arrayPayload.length > 0 ? arrayPayload : [result.data];
      }

      globalDbData = records;
      currentPage = 1;
      applyFilterAndPagination();
    } catch (err) {
      hideLoader();
      if (head) head.innerHTML = "<tr><th>ERROR STATUS</th></tr>";
      if (body)
        body.innerHTML =
          '<tr><td class="text-center title-danger">Server disconnected. Check backend connectivity.</td></tr>';
    }
  }

  function getSettingsModalMarkup(settingsRow) {
    const markup = [
      `<div class="input-group"><label for="dbSettingsMaxFree">Max Free Panel Slots</label><input id="dbSettingsMaxFree" type="number" value="${escapeHTML(readObjectValue(settingsRow, ["maxFreeSlots", "MaxFreeSlots"], 20))}"></div>`,
      `<div class="input-group"><label for="dbSettingsVersion">Latest Panel Version</label><input id="dbSettingsVersion" type="text" value="${escapeHTML(readObjectValue(settingsRow, ["latestVersion", "LatestVersion"], "1.0"))}"></div>`,
      `<div class="input-group"><label for="dbSettingsUrl">Update Download Link</label><input id="dbSettingsUrl" type="url" placeholder="https://..." value="${escapeHTML(readObjectValue(settingsRow, ["updateUrl", "UpdateUrl"], ""))}"></div>`,
      `<div class="input-group"><label for="dbSettingsMaintenance">Maintenance Status</label><select id="dbSettingsMaintenance"><option value="true" ${readObjectValue(settingsRow, ["isMaintenanceMode", "IsMaintenanceMode"], false) ? "selected" : ""}>ON (Block Users)</option><option value="false" ${!readObjectValue(settingsRow, ["isMaintenanceMode", "IsMaintenanceMode"], false) ? "selected" : ""}>OFF (Live)</option></select></div>`,
      `<div class="input-group"><label for="dbSettingsReason">Custom Maintenance Reason</label><textarea id="dbSettingsReason" rows="2" style="width:100%; border-radius:8px; padding:8px;">${escapeHTML(readObjectValue(settingsRow, ["maintenanceReason", "MaintenanceReason"], ""))}</textarea></div>`,
    ];

    SETTINGS_LINK_FIELDS.forEach((field) => {
      const label = field.key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (char) => char.toUpperCase())
        .replace("Customised", "Customised");
      markup.push(
        `<div class="input-group"><label for="${field.modalId}">${escapeHTML(label)}</label><input id="${field.modalId}" type="url" placeholder="https://..." value="${escapeHTML(readObjectValue(settingsRow, [field.key, field.key.charAt(0).toUpperCase() + field.key.slice(1)], ""))}"></div>`,
      );
    });

    return markup.join("");
  }

  function openOwnerEditModal(rowData) {
    const fieldsContainer = document.getElementById("ownerEditFields");
    const title = document.getElementById("ownerEditTitle");
    if (!fieldsContainer || !title) return;

    currentEditRecordId = readObjectValue(rowData, ["id", "Id"], 0);
    title.textContent = `Edit ${currentDbTable.toUpperCase()} (ID: ${currentEditRecordId || "-"})`;

    let html = "";
    if (currentDbTable === "users") {
      html = `
      <div class="input-group"><label for="dbUserPlan">Plan</label><input id="dbUserPlan" type="text" value="${escapeHTML(readObjectValue(rowData, ["plan", "Plan"], ""))}"></div>
      <div class="input-group"><label for="dbUserExpiry">Expiry</label><input id="dbUserExpiry" type="datetime-local" value="${toDatetimeLocal(readObjectValue(rowData, ["expiryTime", "ExpiryTime"], ""))}"></div>
      <div class="input-group"><label for="dbUserBan">Ban Status</label><select id="dbUserBan"><option value="false" ${!readObjectValue(rowData, ["isBanned", "IsBanned"], false) ? "selected" : ""}>Active</option><option value="true" ${readObjectValue(rowData, ["isBanned", "IsBanned"], false) ? "selected" : ""}>Banned</option></select></div>
    `;
    } else if (currentDbTable === "keys") {
      html = `
      <div class="input-group"><label for="dbKeyPlan">Plan</label><input id="dbKeyPlan" type="text" value="${escapeHTML(readObjectValue(rowData, ["plan", "Plan"], ""))}"></div>
      <div class="input-group"><label for="dbKeyDays">Valid Days</label><input id="dbKeyDays" type="number" value="${escapeHTML(readObjectValue(rowData, ["validDays", "ValidDays"], 0))}"></div>
      <div class="input-group"><label for="dbKeyUsed">Key Used</label><select id="dbKeyUsed"><option value="false" ${!readObjectValue(rowData, ["isUsed", "IsUsed"], false) ? "selected" : ""}>False</option><option value="true" ${readObjectValue(rowData, ["isUsed", "IsUsed"], false) ? "selected" : ""}>True</option></select></div>
    `;
    } else if (currentDbTable === "admins") {
      html = `
      <div class="input-group"><label for="dbAdminRole">Role</label><input id="dbAdminRole" type="text" value="${escapeHTML(readObjectValue(rowData, ["role", "Role"], ""))}"></div>
      <div class="input-group"><label for="dbAdminActive">Is Active</label><select id="dbAdminActive"><option value="true" ${readObjectValue(rowData, ["isActive", "IsActive"], true) ? "selected" : ""}>True</option><option value="false" ${!readObjectValue(rowData, ["isActive", "IsActive"], true) ? "selected" : ""}>False</option></select></div>
    `;
    } else if (currentDbTable === "orders") {
      html = `
      <div class="input-group"><label for="dbOrderStatus">Order Status</label><select id="dbOrderStatus"><option value="Pending" ${readObjectValue(rowData, ["status", "Status"], "Pending") === "Pending" ? "selected" : ""}>Pending</option><option value="Approved" ${readObjectValue(rowData, ["status", "Status"], "Pending") === "Approved" ? "selected" : ""}>Approved</option><option value="Rejected" ${readObjectValue(rowData, ["status", "Status"], "Pending") === "Rejected" ? "selected" : ""}>Rejected</option></select></div>
    `;
    } else if (currentDbTable === "settings") {
      html = `
    <h4 class="mb-10 text-secondary" style="border-bottom: 1px solid var(--surface-border); padding-bottom: 5px;">System & Maintenance</h4>
    <div class="input-group"><label>Latest Panel Version</label><input id="dbSettingsVersion" type="text" value="${rowData.latestVersion || rowData.LatestVersion || "1.0"}"></div>
    <div class="input-group"><label>App Update URL</label><input id="dbSettingsUrl" type="url" value="${rowData.updateUrl || rowData.UpdateUrl || ""}"></div>
    <div class="input-group"><label>Custom Maintenance Reason</label><textarea id="dbSettingsReason" rows="2" style="width:100%; border-radius:8px; padding:8px;">${rowData.maintenanceReason || rowData.MaintenanceReason || ""}</textarea></div>

    <h4 class="mt-15 mb-10 text-secondary" style="border-bottom: 1px solid var(--surface-border); padding-bottom: 5px;">Panel Download Links</h4>
    <div class="input-group"><label>Free Panel Link</label><input id="dbSettingsFreeLink" type="url" value="${rowData.freeLink || rowData.FreeLink || ""}"></div>
    <div class="input-group"><label>Streamer Panel Link</label><input id="dbSettingsStreamerLink" type="url" value="${rowData.streamerLink || rowData.StreamerLink || ""}"></div>
    <div class="input-group"><label>Sniper Panel Link</label><input id="dbSettingsSniperLink" type="url" value="${rowData.sniperLink || rowData.SniperLink || ""}"></div>
    <div class="input-group"><label>Special Panel Link</label><input id="dbSettingsSpecialLink" type="url" value="${rowData.specialLink || rowData.SpecialLink || ""}"></div>
    <div class="input-group"><label>Aimbot Panel Link</label><input id="dbSettingsAimbotLink" type="url" value="${rowData.aimbotLink || rowData.AimbotLink || ""}"></div>
    <div class="input-group"><label>Premium Panel Link</label><input id="dbSettingsPremiumLink" type="url" value="${rowData.premiumLink || rowData.PremiumLink || ""}"></div>
    <div class="input-group"><label>Customised Panel Link</label><input id="dbSettingsCustomLink" type="url" value="${rowData.customisedLink || rowData.CustomisedLink || ""}"></div>
    `;
    } // Isko openOwnerEditModal function ke andar add karna hai
      else if (currentDbTable === "panelUpdates") {
        html = `
          <h4 class="mb-10 text-secondary">Update Panel Status</h4>
          <div class="input-group">
            <label>Aimbot Status</label>
            <input id="dbUpd1" type="text" value="${escapeHTML(rowData.update1 || rowData.Update1 || '')}">
          </div>
          <div class="input-group">
            <label>Sniper Status</label>
            <input id="dbUpd2" type="text" value="${escapeHTML(rowData.update2 || rowData.Update2 || '')}">
          </div>
          <div class="input-group">
            <label>Bypass Status</label>
            <input id="dbUpd3" type="text" value="${escapeHTML(rowData.update3 || rowData.Update3 || '')}">
          </div>
          <div class="input-group">
            <label>General Status</label>
            <input id="dbUpd4" type="text" value="${escapeHTML(rowData.update4 || rowData.Update4 || '')}">
          </div>
        `;
      }else if (currentDbTable === "freeSettings") {
      html = `
    <h4 class="mb-10 text-success" style="border-bottom: 1px solid var(--surface-border); padding-bottom: 5px;">Free Panel Configurations</h4>
    <div class="input-group">
      <label class="text-success">Global Free Username (Blank = Delete/OFF)</label>
      <input id="dbSettingsFreeUser" type="text" value="${rowData.freeUsername || rowData.FreeUsername || ""}">
    </div>
    <div class="input-group">
      <label class="text-success">Global Free Password</label>
      <input id="dbSettingsFreePass" type="text" value="${rowData.freePassword || rowData.FreePassword || ""}">
    </div>
    <div class="input-group">
      <label class="text-success">Free User Valid Days</label>
      <input id="dbSettingsFreeDays" type="number" min="1" value="${rowData.freeValidDays || rowData.FreeValidDays || 30}">
    </div>
    <div class="input-group">
      <label>Max Free Panel Slots</label>
      <input id="dbSettingsMaxFree" type="number" value="${rowData.maxFreeSlots || rowData.MaxFreeSlots || 20}">
    </div>
    <div class="input-group">
      <label class="checkbox-label" style="display: flex; gap: 8px; color: var(--success); cursor: pointer; font-weight: bold; margin-top: 5px;">
        <input type="checkbox" id="dbSettingsShowHomeBtn" ${rowData.showHomeDownloadBtn || rowData.ShowHomeDownloadBtn ? "checked" : ""} style="width: 18px; height: 18px;">
        Show Download Button on Home Page
      </label>
    </div>
    `;
    } else if (currentDbTable === "freeusers") {
      html = `
      <div class="input-group"><label for="dbFreeUser">Username</label><input id="dbFreeUser" type="text" value="${escapeHTML(readObjectValue(rowData, ["username", "Username"], ""))}"></div>
      <div class="input-group"><label for="dbFreeHwid">HWID Lock</label><input id="dbFreeHwid" type="text" value="${escapeHTML(readObjectValue(rowData, ["hwid", "HWID"], ""))}"></div>
      <div class="input-group"><label for="dbFreeEnv">PC Name</label><input id="dbFreeEnv" type="text" value="${escapeHTML(readObjectValue(rowData, ["CaptchaToken", "CaptchaToken"], ""))}"></div>
      <div class="input-group"><label for="dbFreeBan">Ban Status</label><select id="dbFreeBan"><option value="false" ${!readObjectValue(rowData, ["isBanned", "IsBanned"], false) ? "selected" : ""}>Active</option><option value="true" ${readObjectValue(rowData, ["isBanned", "IsBanned"], false) ? "selected" : ""}>Banned</option></select></div>
      <div class="input-group"><label for="dbFreeAttempts">Failed Attempts</label><input id="dbFreeAttempts" type="number" value="${escapeHTML(readObjectValue(rowData, ["failedLoginAttempts", "FailedLoginAttempts"], 0))}"></div>
    `;
    }

    if (currentDbTable !== "settings") {
      html += `
      <div class="mt-15 pt-15 border-t">
        <button type="button" id="ownerDeleteRecordBtn" class="btn btn-outline btn-db-delete btn-full">Permanently Delete Record</button>
      </div>
    `;
    }

    fieldsContainer.innerHTML = html;
    document
      .getElementById("ownerDeleteRecordBtn")
      ?.addEventListener("click", () => {
        closeModal("ownerEditModal");
        deleteDbRecord(currentEditRecordId);
      });

    openModal("ownerEditModal");
  }

  async function handleOwnerDBSave() {
    let endpoint = "";
    let payload = { id: currentEditRecordId, userId: currentEditRecordId };

    if (currentDbTable === "users") {
      endpoint = "/api/admin/user/update";
      payload.plan = document.getElementById("dbUserPlan")?.value || "";
      payload.expiryTime = toIsoOrNullFromDatetimeLocal(
        document.getElementById("dbUserExpiry")?.value || "",
      );
      payload.isBanned = document.getElementById("dbUserBan")?.value === "true";
    } else if (currentDbTable === "keys") {
      endpoint = "/api/admin/manage/key";
      payload.plan = document.getElementById("dbKeyPlan")?.value || "";
      payload.validDays =
        Number.parseInt(
          document.getElementById("dbKeyDays")?.value || "0",
          10,
        ) || 0;
      payload.isUsed = document.getElementById("dbKeyUsed")?.value === "true";
    } else if (currentDbTable === "admins") {
      endpoint = "/api/admin/manage/admin";
      payload.role = document.getElementById("dbAdminRole")?.value || "";
      payload.isActive =
        document.getElementById("dbAdminActive")?.value === "true";
    } else if (currentDbTable === "orders") {
      endpoint = "/api/admin/orders/update";
      payload.status =
        document.getElementById("dbOrderStatus")?.value || "Pending";
    } else if (currentDbTable === "settings") {
      endpoint = "/api/admin/settings/update";

      const overrides = {
        latestVersion: document.getElementById("dbSettingsVersion")?.value,
        updateUrl: document.getElementById("dbSettingsUrl")?.value,
        maintenanceReason: document.getElementById("dbSettingsReason")?.value,

        // 🔥 FIX: Saari links ko direct ID se pakad liya taaki spelling mismatch ka koi chance hi na rahe
        freeLink: document.getElementById("dbSettingsFreeLink")?.value,
        streamerLink: document.getElementById("dbSettingsStreamerLink")?.value,
        sniperLink: document.getElementById("dbSettingsSniperLink")?.value,
        specialLink: document.getElementById("dbSettingsSpecialLink")?.value,
        aimbotLink: document.getElementById("dbSettingsAimbotLink")?.value,
        premiumLink: document.getElementById("dbSettingsPremiumLink")?.value,
        customisedLink: document.getElementById("dbSettingsCustomLink")?.value,
      };

      // Array loop ab optional hai, isliye agar purana code yahan hai toh usko rehne dein
      if (typeof SETTINGS_LINK_FIELDS !== "undefined") {
        SETTINGS_LINK_FIELDS.forEach((field) => {
          const el = document.getElementById(field.modalId);
          if (el && !overrides[field.key])
            overrides[field.key] = el.value.trim();
        });
      }

      payload = buildSettingsPayload(overrides);
    } else if (currentDbTable === "freeSettings") {
      endpoint = "/api/admin/settings/update";

      const overrides = {
        maxFreeSlots: document.getElementById("dbSettingsMaxFree")?.value,
        freeValidDays: document.getElementById("dbSettingsFreeDays")?.value,
        showHomeDownloadBtn: document.getElementById("dbSettingsShowHomeBtn")
          ?.checked,
        freeUsername: document.getElementById("dbSettingsFreeUser")?.value,
        freePassword: document.getElementById("dbSettingsFreePass")?.value,
      };

      payload = buildSettingsPayload(overrides);
    } else if (currentDbTable === "panelUpdates") {
        endpoint = "/api/auth/panel-updates/save";
        payload = {
          update1: document.getElementById("dbUpd1")?.value || "",
          update2: document.getElementById("dbUpd2")?.value || "",
          update3: document.getElementById("dbUpd3")?.value || "",
          update4: document.getElementById("dbUpd4")?.value || ""
        };
      }else if (currentDbTable === "panelUpdates") {
      html = `
          <h4 class="mb-10 text-secondary">Update Panel Status</h4>
          <div class="input-group"><label>Aimbot Status</label><input id="dbUpd1" type="text" value="${escapeHTML(rowData.update1 || rowData.Update1 || "")}"></div>
          <div class="input-group"><label>Sniper Status</label><input id="dbUpd2" type="text" value="${escapeHTML(rowData.update2 || rowData.Update2 || "")}"></div>
          <div class="input-group"><label>Bypass Status</label><input id="dbUpd3" type="text" value="${escapeHTML(rowData.update3 || rowData.Update3 || "")}"></div>
          <div class="input-group"><label>General Status</label><input id="dbUpd4" type="text" value="${escapeHTML(rowData.update4 || rowData.Update4 || "")}"></div>
        `;
    } else if (currentDbTable === "freeusers") {
      endpoint = "/api/admin/manage/free-user/update";
      payload.Username = document.getElementById("dbFreeUser")?.value || "";
      payload.HWID = document.getElementById("dbFreeHwid")?.value || "";
      payload.CaptchaToken = document.getElementById("dbFreeEnv")?.value || "";
      payload.IsBanned = document.getElementById("dbFreeBan")?.value === "true";
      payload.FailedLoginAttempts =
        Number.parseInt(
          document.getElementById("dbFreeAttempts")?.value || "0",
          10,
        ) || 0;
    }

    showLoader("Saving changes...");

    try {
      const result = await requestJson(endpoint, {
        method: "PUT",
        headers: getAuthHeader(),
        body: payload,
      });

      hideLoader();
      if (handleAdminAuthFailure(result.status)) return;
      if (!result.ok) {
        showMessage(
          extractErrorMessage(result.data, "Update failed."),
          "error",
        );
        return;
      }

      if (currentDbTable === "settings") {
        cachedSettingsRecord = { ...cachedSettingsRecord, ...payload };
        populateSystemControlsForm(cachedSettingsRecord);
      }

      closeModal("ownerEditModal");
      showMessage("Record updated successfully.", "success");
      await loadDbData();
    } catch (err) {
      hideLoader();
      showMessage("Server error while saving changes.", "error");
    }
  }

  function deleteDbRecord(id) {
    openDeleteConfirmation(
      `Record #${id} from ${currentDbTable.toUpperCase()}`,
      async () => {
        const endpointMap = {
          users: `/api/admin/user/delete/${id}`,
          keys: `/api/admin/manage/key/delete/${id}`,
          admins: `/api/admin/manage/admin/delete/${id}`,
          orders: `/api/admin/orders/delete/${id}`,
          freeusers: `/api/admin/manage/free-user/delete/${id}`,
        };

        showLoader("Deleting record...");

        try {
          const result = await requestJson(endpointMap[currentDbTable], {
            method: "DELETE",
            headers: getAuthHeader(),
          });

          hideLoader();
          if (handleAdminAuthFailure(result.status)) return;
          if (!result.ok) {
            showMessage(
              extractErrorMessage(result.data, "Failed to delete record."),
              "error",
            );
            return;
          }

          showMessage("Record deleted successfully.", "success");
          await loadDbData();
        } catch (err) {
          hideLoader();
          showMessage("Server error while deleting the record.", "error");
        }
      },
    );
  }

  function bindOwnerDatabaseControls() {
    const dbSearchInput = document.getElementById("dbSearchInput");
    let searchTimer = null;

    document
      .getElementById("systemControlsForm")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        saveSystemControls();
      });
    document
      .getElementById("maintenanceToggleBtn")
      ?.addEventListener("click", toggleMaintenanceMode);
    document
      .getElementById("ownerEditForm")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        handleOwnerDBSave();
      });
    document
      .getElementById("dbTableSelect")
      ?.addEventListener("change", (event) => {
        currentDbTable = event.target.value;
        loadDbData();
      });
    dbSearchInput?.addEventListener("input", (event) => {
      searchQuery = event.target.value;
      currentPage = 1;

      if (searchTimer) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        applyFilterAndPagination();
      }, 120);
    });
    document.getElementById("prevPageBtn")?.addEventListener("click", () => {
      currentPage -= 1;
      applyFilterAndPagination();
    });
    document.getElementById("nextPageBtn")?.addEventListener("click", () => {
      currentPage += 1;
      applyFilterAndPagination();
    });
  }

  window.renderDbTable = renderDbTable;

  window.DSCCore = {
    API_BASE,
    HELP_URL,
    USER_LOGIN_PAGE,
    ADMIN_LOGIN_PAGE,
    USER_HOME_PAGE,
    ADMIN_HOME_PAGE,
    OWNER_ACCESS_TTL_MS,
    getCurrentPageName,
    resolvePagePath,
    getCurrentUser,
    persistCurrentUser,
    clearCurrentUser,
    touchCurrentUserActivity,
    requestJson,
    getAuthHeader,
    extractErrorMessage,
    isAbortError,
    showLoader,
    hideLoader,
    showMessage,
    escapeHTML,
    formatDateTime,
    toDatetimeLocal,
    toIsoOrNullFromDatetimeLocal,
    normalizeListPayload,
    normalizeUsersPayload,
    revealProtectedBody,
    renderGuardFailure,
    isAuthFailureStatus,
    handleUserAuthFailure,
    handleAdminAuthFailure,
    redirectForRole,
    goTo,
    safeOpenExternal,
    copyTextToClipboard,
    setOwnerAccessCache,
    getOwnerAccessCache,
    decodeJwtPayload,
    getRoleFromClaims,
    readObjectValue,
    getSettingsRecord,
    toggleControlVisibility,
    verifyOwnerAccess,
    ensureAdminPageAccess,
    checkSystemStatus,
    openModal,
    closeModal,
    openDeleteConfirmation,
    closeDeleteConfirmation,
    openOrderConfirmation,
    closeOrderConfirmation,
    bindSharedAdminModals,
    createBadge,
    createCell,
  };

  function bootstrapPublicPage(pageName) {
    return (async () => {
      revealProtectedBody();
      const maintenanceActive = await checkSystemStatus();
      if (maintenanceActive) return;
      if (pageName === "freepanel.html") {
        await fetchFreePanelPageStatus();
        return;
      }
      if (pageName === "checkout.html") {
        initCheckoutPage();
      }
    })();
  }

  function bootstrapUserProtectedPage(pageName) {
    return (async () => {
      if (pageName === "change.html") {
        const currentUser = getCurrentUser();
        if (
          currentUser &&
          currentUser.plan &&
          currentUser.plan.toLowerCase() === "free"
        ) {
          showMessage("Upgrade required to change password.", "error");
          window.location.replace(resolvePagePath("Udash.html"));
          return;
        }
      }
      const session = await ensureUserPageAccess(pageName);
      if (!session) return;
      revealProtectedBody();
      const maintenanceActive = await checkSystemStatus();
      if (maintenanceActive) return;
      if (pageName === "Udash.html") {
        await loadUserDash();
      }
    })();
  }

  function bootstrapUserLoginPage() {
    return (async () => {
      const currentUser = getCurrentUser();
      if (currentUser) {
        redirectForRole(currentUser.role);
        return;
      }
      revealProtectedBody();
      await checkSystemStatus();
    })();
  }

  function bootstrapAdminPlaceholderPage(pageName) {
    if (pageName === "Alogin.html") {
      revealProtectedBody();
    }
  }

  function bootstrapCoreApp() {
    return (async () => {
      const pageName = getCurrentPageName();
      bindCommonShell(handleLogout);
      bindUserForms();
      bindKeyboardShortcuts();
      if (pageName === "Ulogin.html") {
        await bootstrapUserLoginPage();
        return;
      }
      if (USER_ROUTE_GUARDS[pageName]) {
        await bootstrapUserProtectedPage(pageName);
        return;
      }
      if (ADMIN_PAGES.has(pageName)) {
        bootstrapAdminPlaceholderPage(pageName);
        return;
      }
      if (PUBLIC_PAGES.has(pageName)) {
        await bootstrapPublicPage(pageName);
        return;
      }
      revealProtectedBody();
    })();
  }

  function bootstrapAdminApp() {
    return (async () => {
      const pageName = getCurrentPageName();
      if (
        !["Alogin.html", "Adash.html", "OwnerDB.html", "generateKey.html"].includes(
          pageName,
        )
      )
        return;

      bindSharedAdminModals();
      if (pageName === "Alogin.html") {
        const currentUser = getCurrentUser();
        if (currentUser) {
          redirectForRole(currentUser.role);
          return;
        }
        bindAdminLoginForm();
        return;
      }
      const access = await ensureAdminPageAccess(pageName);
      if (!access) return;
      revealProtectedBody();
      if (pageName === "Adash.html") {
        bindDashboardControls();
        await loadAdminDash();
        return;
      }
      if (pageName === "generateKey.html") {
        bindGenerateKeyControls();
        return;
      }
      if (pageName === "OwnerDB.html") {
        bindOwnerDatabaseControls();
        await loadSystemControls();
        await loadDbData();
      }
    })();
  }

  function startPageAnimation() {
    requestAnimationFrame(() => {
      document.body.classList.add("page-loaded");
    });
  }

  function runBootstraps() {
    bootstrapCoreApp();
    startPageAnimation();
    bootstrapAdminApp();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runBootstraps);
  } else {
    runBootstraps();
  }
  startKeepAlivePing();
})();
