// Auth token stored in localStorage — persists 30 days
const TOKEN_KEY = "rome_session_token";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
}

export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

// Attach token to every fetch going to /api/*
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { "x-session-token": token } : {};
}
