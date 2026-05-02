const API_BASE = import.meta.env.PROD ? "/_/backend/api" : "http://localhost:4000/api";

async function request(path, options = {}, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const raw = await response.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    const fallback = `Could not reach the server (${response.status}). Refresh the page or try again in a moment.`;
    const msg =
      typeof data.message === "string" && data.message.trim() ? data.message.trim() : fallback;
    throw new Error(msg);
  }
  return data;
}

export const api = { request };
