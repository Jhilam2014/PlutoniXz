// Deliberately memory-only: a bearer credential must not be persisted in
// localStorage, sessionStorage, indexedDB, or a client-readable cookie.
const hotAuthState = import.meta.hot?.data?.authState;
let currentUser = hotAuthState?.currentUser || null;
let bearerToken = hotAuthState?.bearerToken || "";
let developmentSubject = hotAuthState?.developmentSubject || "";

// Vite replaces this module during development without remounting the whole
// React tree. Carry credentials through that in-memory replacement so the UI
// cannot appear signed in while authFetch has silently lost its headers. This
// remains process-memory state and is never persisted in browser storage.
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.authState = { currentUser, bearerToken, developmentSubject };
  });
}

const developmentAuthEnabled = import.meta.env.VITE_PLUTOMIX_DEV_AUTH_ENABLED === "true";
const developmentAuthSubject = String(import.meta.env.VITE_PLUTOMIX_DEV_AUTH_SUBJECT || "local:local-plutomix-user").trim();

function publicUser(user = {}) {
  if (!user || typeof user !== "object") return null;
  const onboarding = user.onboarding && typeof user.onboarding === "object"
    ? {
        principalId: String(user.onboarding.principalId || "").slice(0, 240),
        tenantIds: [...new Set((Array.isArray(user.onboarding.tenantIds) ? user.onboarding.tenantIds : [])
          .map((tenantId) => String(tenantId || "").slice(0, 160))
          .filter(Boolean))],
        roles: [...new Set((Array.isArray(user.onboarding.roles) ? user.onboarding.roles : [])
          .map((role) => String(role || "").slice(0, 80))
          .filter(Boolean))],
        platformAdmin: user.onboarding.platformAdmin === true,
        provisioned: user.onboarding.provisioned === true
      }
    : null;
  return {
    id: String(user.id || "").slice(0, 240),
    name: String(user.name || "Verified user").slice(0, 160),
    email: String(user.email || "").slice(0, 254),
    picture: String(user.picture || "").slice(0, 2048),
    authProvider: String(user.authProvider || "oidc").slice(0, 48),
    onboarding
  };
}

function notify() {
  window.dispatchEvent(new CustomEvent("plutomix-user-updated", { detail: currentUser }));
}

export function getStoredUser() {
  return currentUser;
}

export function storeUser(user, { token, onboarding } = {}) {
  const next = publicUser({ ...user, onboarding: onboarding || user?.onboarding });
  if (!next?.id || !token) throw new Error("A verified identity profile and bearer token are required.");
  currentUser = next;
  bearerToken = String(token);
  // A local deployment may deliberately use its pre-provisioned development
  // membership after Google has verified the browser identity. Production
  // builds cannot enable this path and continue to send the bearer token.
  developmentSubject = developmentAuthEnabled ? developmentAuthSubject : "";
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
  if (developmentAuthEnabled && developmentSubject) return { "x-plutomix-dev-subject": developmentSubject };
  if (bearerToken) return { authorization: `Bearer ${bearerToken}` };
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

// Platform administration must evaluate the verified OIDC email and must not
// inherit the local development membership compatibility subject.
export function verifiedIdentityFetch(pathOrUrl, options = {}) {
  const headers = {
    ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : authHeaders()),
    ...(options.headers || {})
  };
  return fetch(pathOrUrl, { ...options, credentials: "omit", headers });
}
