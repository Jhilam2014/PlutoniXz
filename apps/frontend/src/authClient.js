// Deliberately memory-only: a bearer credential must not be persisted in
// localStorage, sessionStorage, indexedDB, or a client-readable cookie.
let currentUser = null;
let bearerToken = "";
let developmentSubject = "";

const developmentAuthEnabled = import.meta.env.VITE_PLUTONIX_DEV_AUTH_ENABLED === "true";

function publicUser(user = {}) {
  if (!user || typeof user !== "object") return null;
  return {
    id: String(user.id || "").slice(0, 240),
    name: String(user.name || "Verified user").slice(0, 160),
    email: String(user.email || "").slice(0, 254),
    authProvider: String(user.authProvider || "oidc").slice(0, 48)
  };
}

function notify() {
  window.dispatchEvent(new CustomEvent("plutonix-user-updated", { detail: currentUser }));
}

export function getStoredUser() {
  return currentUser;
}

export function storeUser(user, { token } = {}) {
  const next = publicUser(user);
  if (!next?.id || !token) throw new Error("A verified identity profile and bearer token are required.");
  currentUser = next;
  bearerToken = String(token);
  developmentSubject = "";
  notify();
}

export function storeDevelopmentUser(user, { subject } = {}) {
  if (!developmentAuthEnabled) throw new Error("Development authentication is disabled.");
  const next = publicUser(user);
  const safeSubject = String(subject || "").trim();
  if (!next?.id || !safeSubject) throw new Error("A development identity subject is required.");
  currentUser = next;
  bearerToken = "";
  developmentSubject = safeSubject;
  notify();
}

export function clearUser() {
  currentUser = null;
  bearerToken = "";
  developmentSubject = "";
  notify();
}

export function authHeaders() {
  if (bearerToken) return { authorization: `Bearer ${bearerToken}` };
  if (developmentAuthEnabled && developmentSubject) return { "x-plutonix-dev-subject": developmentSubject };
  return {};
}

export function authFetch(pathOrUrl, options = {}) {
  const headers = {
    ...authHeaders(),
    ...(options.headers || {})
  };
  // This API uses authorization headers, never ambient cookie credentials.
  return fetch(pathOrUrl, { ...options, credentials: "omit", headers });
}
