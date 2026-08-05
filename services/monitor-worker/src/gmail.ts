import type { Env, Monitor } from "./types";

export async function storeGoogleRefreshToken(env: Env, email: string, refreshToken: string): Promise<void> {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const encrypted = await encrypt(refreshToken, env.TOKEN_ENCRYPTION_KEY);
  await env.DB.prepare(
    "INSERT INTO google_connections (email, encrypted_refresh_token, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(email) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token, updated_at = CURRENT_TIMESTAMP",
  ).bind(email.toLowerCase(), encrypted).run();
}

export async function findMatchingGmailMessage(env: Env, monitor: Monitor, now: Date): Promise<string | null> {
  if (!monitor.ownerEmail || !env.TOKEN_ENCRYPTION_KEY || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const connection = await env.DB.prepare(
    "SELECT encrypted_refresh_token AS encryptedRefreshToken FROM google_connections WHERE email = ? LIMIT 1",
  ).bind(monitor.ownerEmail.toLowerCase()).first<{ encryptedRefreshToken: string }>();
  if (!connection) return null;
  const refreshToken = await decrypt(connection.encryptedRefreshToken, env.TOKEN_ENCRYPTION_KEY);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!tokenResponse.ok) throw new Error(`Google token refresh returned ${tokenResponse.status}`);
  const token = await tokenResponse.json<{ access_token: string }>();
  const day = now.toISOString().slice(0, 10).replaceAll("-", "/");
  const query = [`after:${day}`, monitor.senderFilter ? `from:(${monitor.senderFilter})` : "", monitor.subjectFilter ? `subject:(${monitor.subjectFilter})` : ""].filter(Boolean).join(" ");
  const searchUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  searchUrl.search = new URLSearchParams({ q: query, maxResults: "1" }).toString();
  const searchResponse = await fetch(searchUrl, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!searchResponse.ok) throw new Error(`Gmail search returned ${searchResponse.status}`);
  const result = await searchResponse.json<{ messages?: Array<{ id: string }> }>();
  return result.messages?.[0]?.id ?? null;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), new TextEncoder().encode(value));
  return `${encode(iv)}.${encode(new Uint8Array(cipher))}`;
}
async function decrypt(value: string, secret: string): Promise<string> {
  const [iv, cipher] = value.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(iv).buffer as ArrayBuffer }, await encryptionKey(secret), decode(cipher).buffer as ArrayBuffer);
  return new TextDecoder().decode(plain);
}
function encode(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function decode(value: string): Uint8Array { const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="); return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)); }
