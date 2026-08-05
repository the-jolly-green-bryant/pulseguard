import type { Env } from "./types";
import { storeGoogleRefreshToken } from "./gmail";

export type SessionUser = { email: string; name: string; picture?: string; exp: number };

const sessionCookie = "pulseguard_session";
const stateCookie = "pulseguard_oauth_state";

export async function startGoogleLogin(request: Request, env: Env): Promise<Response> {
  requireGoogleConfig(env);
  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: callbackUrl(request),
    response_type: "code",
    scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
    state,
    prompt: "consent",
    access_type: "offline",
    include_granted_scopes: "true",
    login_hint: "bryant@bryantjames.com",
  }).toString();
  return new Response(null, {
    status: 302,
    headers: { location: url.toString(), "set-cookie": cookie(stateCookie, state, 600) },
  });
}

export async function finishGoogleLogin(request: Request, env: Env): Promise<Response> {
  requireGoogleConfig(env);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== readCookie(request, stateCookie)) return textError("Invalid OAuth state", 400);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: callbackUrl(request),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) return textError("Google token exchange failed", 401);
  const tokens = await tokenResponse.json<{ id_token?: string; refresh_token?: string }>();
  if (!tokens.id_token) return textError("Google did not return an identity token", 401);
  const profileResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`);
  if (!profileResponse.ok) return textError("Google identity verification failed", 401);
  const profile = await profileResponse.json<{ aud: string; email: string; email_verified: string; name?: string; picture?: string }>();
  if (profile.aud !== env.GOOGLE_CLIENT_ID || profile.email_verified !== "true") return textError("Unverified Google identity", 401);

  const allowlist = (env.ALLOWED_GOOGLE_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (allowlist.length && !allowlist.includes(profile.email.toLowerCase())) return textError("This Google account is not allowed", 403);
  if (tokens.refresh_token) await storeGoogleRefreshToken(env, profile.email, tokens.refresh_token);
  const session: SessionUser = { email: profile.email, name: profile.name ?? profile.email, picture: profile.picture, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 };
  const token = await signSession(session, env.SESSION_SECRET!);
  return new Response(null, { status: 302, headers: { location: "/", "set-cookie": cookie(sessionCookie, token, 60 * 60 * 24 * 7) } });
}

export async function getSession(request: Request, env: Env): Promise<SessionUser | null> {
  if (!env.SESSION_SECRET) return null;
  const value = readCookie(request, sessionCookie);
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !(await verify(payload, signature, env.SESSION_SECRET))) return null;
  try {
    const user = JSON.parse(decodeBase64Url(payload)) as SessionUser;
    return user.exp > Date.now() / 1000 ? user : null;
  } catch { return null; }
}

export function logout(): Response {
  return new Response(null, { status: 302, headers: { location: "/", "set-cookie": cookie(sessionCookie, "", 0) } });
}

function requireGoogleConfig(env: Env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET || !env.TOKEN_ENCRYPTION_KEY) throw new Error("Google OAuth is not configured");
}
function callbackUrl(request: Request) { return `${new URL(request.url).origin}/auth/google/callback`; }
function readCookie(request: Request, name: string) { return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null; }
function cookie(name: string, value: string, maxAge: number) { return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
function textError(message: string, status: number) { return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } }); }
async function signSession(user: SessionUser, secret: string) { const payload = encodeBase64Url(JSON.stringify(user)); return `${payload}.${await signature(payload, secret)}`; }
async function verify(payload: string, supplied: string, secret: string) { return supplied === await signature(payload, secret); }
async function signature(payload: string, secret: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return encodeBytes(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)))); }
function encodeBase64Url(value: string) { return encodeBytes(new TextEncoder().encode(value)); }
function encodeBytes(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function decodeBase64Url(value: string) { const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="); const binary = atob(base64); return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))); }
