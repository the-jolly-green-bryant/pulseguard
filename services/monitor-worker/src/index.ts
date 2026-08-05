import { deliverAlerts } from "./alerts";
import { finishGoogleLogin, getSession, logout, startGoogleLogin } from "./auth";
import { isOverdue, normalizeAddress, safeEqual, utcDayKey } from "./domain";
import { findMatchingGmailMessage } from "./gmail";
import type { EmailMessage, Env, ExecutionContext, Monitor, Recipient } from "./types";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "pulseguard-monitor" });
    }
    if (request.method === "GET" && url.pathname === "/auth/google") return startGoogleLogin(request, env);
    if (request.method === "GET" && url.pathname === "/auth/google/callback") return finishGoogleLogin(request, env);
    if (request.method === "GET" && url.pathname === "/auth/logout") return logout();
    if (request.method === "GET" && url.pathname === "/api/session") return Response.json({ user: await getSession(request, env) });
    if (request.method === "POST" && url.pathname === "/hooks/aws-ses") {
      return receiveSesEvent(request, env);
    }
    if (!(await isAuthorized(request, env))) return Response.json({ error: "unauthorized" }, { status: 401 });

    if (request.method === "POST" && url.pathname === "/v1/monitors") {
      return createMonitor(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/monitors") {
      return listMonitors(request, env);
    }
    if (request.method === "POST" && url.pathname === "/v1/check-now") {
      await checkAllMonitors(env, new Date());
      return Response.json({ ok: true });
    }
    const heartbeatMatch = url.pathname.match(/^\/v1\/heartbeats\/([a-zA-Z0-9_-]+)$/);
    if (request.method === "POST" && heartbeatMatch) {
      return recordHeartbeat(env, heartbeatMatch[1]);
    }
    return env.ASSETS.fetch(request);
  },

  async email(message: EmailMessage, env: Env): Promise<void> {
    const inbox = normalizeAddress(message.to);
    const monitor = await env.DB.prepare(
      "SELECT id FROM monitors WHERE inbox_address = ? AND enabled = 1 LIMIT 1",
    ).bind(inbox).first<{ id: string }>();
    if (!monitor) {
      message.setReject("Unknown Pulseguard inbox");
      return;
    }
    await recordReceipt(env, monitor.id, message.from, message.headers.get("message-id"));
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkAllMonitors(env, new Date()));
  },
};

async function createMonitor(request: Request, env: Env): Promise<Response> {
  const input = await request.json<{
    name?: string;
    inboxAddress?: string;
    scheduleHourUtc?: number;
    graceMinutes?: number;
    recipients?: Array<{ channel: "email" | "sms"; destination: string }>;
    monitorType?: "gmail" | "inbox";
    senderFilter?: string;
    subjectFilter?: string;
  }>();
  const monitorType = input.monitorType ?? "gmail";
  if (!input.name || !Number.isInteger(input.scheduleHourUtc) || (monitorType === "gmail" && !input.senderFilter && !input.subjectFilter) || (monitorType === "inbox" && !input.inboxAddress)) {
    return Response.json({ error: "name, schedule, and a Gmail filter or inbox address are required" }, { status: 400 });
  }
  if (input.scheduleHourUtc! < 0 || input.scheduleHourUtc! > 23) {
    return Response.json({ error: "scheduleHourUtc must be between 0 and 23" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const session = await getSession(request, env);
  const ownerEmail = session?.email ?? null;
  const inboxAddress = monitorType === "inbox" ? normalizeAddress(input.inboxAddress!) : `gmail:${id}`;
  const statements = [
    env.DB.prepare(
      "INSERT INTO monitors (id, name, inbox_address, monitor_type, owner_email, sender_filter, subject_filter, schedule_hour_utc, grace_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, input.name.trim(), inboxAddress, monitorType, ownerEmail, input.senderFilter?.trim() ?? null, input.subjectFilter?.trim() ?? null, input.scheduleHourUtc, input.graceMinutes ?? 15),
  ];
  for (const recipient of input.recipients ?? []) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO recipients (id, monitor_id, channel, destination) VALUES (?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), id, recipient.channel, recipient.destination.trim()),
    );
  }
  await env.DB.batch(statements);
  return new Response(JSON.stringify({ id }), { status: 201, headers: jsonHeaders });
}

async function receiveSesEvent(request: Request, env: Env): Promise<Response> {
  const supplied = request.headers.get("x-pulseguard-secret") ?? "";
  if (!env.SES_WEBHOOK_SECRET || !safeEqual(supplied, env.SES_WEBHOOK_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const input = await request.json<{ recipient?: string; sender?: string; messageId?: string }>();
  if (!input.recipient || !input.sender) {
    return Response.json({ error: "recipient and sender are required" }, { status: 400 });
  }
  const monitor = await env.DB.prepare(
    "SELECT id FROM monitors WHERE inbox_address = ? AND enabled = 1 LIMIT 1",
  ).bind(normalizeAddress(input.recipient)).first<{ id: string }>();
  if (!monitor) return Response.json({ error: "monitor_not_found" }, { status: 404 });
  await recordReceipt(env, monitor.id, input.sender, input.messageId ?? null);
  return Response.json({ ok: true });
}

async function listMonitors(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  const query = "SELECT id, name, inbox_address AS inboxAddress, monitor_type AS monitorType, owner_email AS ownerEmail, sender_filter AS senderFilter, subject_filter AS subjectFilter, schedule_hour_utc AS scheduleHourUtc, grace_minutes AS graceMinutes, enabled, last_received_at AS lastReceivedAt FROM monitors";
  const result = session
    ? await env.DB.prepare(`${query} WHERE owner_email = ? ORDER BY created_at DESC`).bind(session.email).all()
    : await env.DB.prepare(`${query} ORDER BY created_at DESC`).all();
  const monitors = await Promise.all(result.results.map(async (monitor) => {
    const recipients = await env.DB.prepare("SELECT channel, destination FROM recipients WHERE monitor_id = ? AND enabled = 1 ORDER BY created_at").bind(String(monitor.id)).all();
    return { ...monitor, recipients: recipients.results };
  }));
  return Response.json({ monitors });
}

async function recordHeartbeat(env: Env, monitorId: string): Promise<Response> {
  const result = await recordReceipt(env, monitorId, "webhook", null);
  return result ? Response.json({ ok: true }) : Response.json({ error: "monitor_not_found" }, { status: 404 });
}

async function recordReceipt(env: Env, monitorId: string, sender: string, messageId: string | null): Promise<boolean> {
  const now = new Date().toISOString();
  const update = await env.DB.prepare(
    "UPDATE monitors SET last_received_at = ?, updated_at = ? WHERE id = ? AND enabled = 1",
  ).bind(now, now, monitorId).run();
  if (!update.meta.changes) return false;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO receipts (id, monitor_id, received_at, sender, message_id) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), monitorId, now, sender, messageId).run();
  return true;
}

async function checkAllMonitors(env: Env, now: Date): Promise<void> {
  const result = await env.DB.prepare(
    "SELECT id, name, inbox_address AS inboxAddress, monitor_type AS monitorType, owner_email AS ownerEmail, sender_filter AS senderFilter, subject_filter AS subjectFilter, schedule_hour_utc AS scheduleHourUtc, grace_minutes AS graceMinutes, enabled, last_received_at AS lastReceivedAt FROM monitors WHERE enabled = 1",
  ).all<Monitor>();
  for (const monitor of result.results) {
    if (!isOverdue(monitor, now)) continue;
    if (monitor.monitorType === "gmail") {
      try {
        const messageId = await findMatchingGmailMessage(env, monitor, now);
        if (messageId) {
          await recordReceipt(env, monitor.id, monitor.senderFilter ?? "gmail", messageId);
          continue;
        }
      } catch {
        continue;
      }
    }
    const day = utcDayKey(now);
    const alertId = `${monitor.id}:${day}`;
    const claimed = await env.DB.prepare(
      "INSERT OR IGNORE INTO alert_runs (id, monitor_id, alert_day, status) VALUES (?, ?, ?, 'sending')",
    ).bind(alertId, monitor.id, day).run();
    if (!claimed.meta.changes) continue;
    const recipientResult = await env.DB.prepare(
      "SELECT id, channel, destination FROM recipients WHERE monitor_id = ? AND enabled = 1",
    ).bind(monitor.id).all<Recipient>();
    const deliveries = await deliverAlerts(env, monitor, recipientResult.results);
    const status = deliveries.every((delivery) => delivery.ok) ? "sent" : "partial_failure";
    await env.DB.prepare(
      "UPDATE alert_runs SET status = ?, detail = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(status, JSON.stringify(deliveries), alertId).run();
  }
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const value = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return (Boolean(env.ADMIN_API_KEY) && safeEqual(value, env.ADMIN_API_KEY)) || Boolean(await getSession(request, env));
}
