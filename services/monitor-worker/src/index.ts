import { deliverAlerts } from "./alerts";
import { isOverdue, normalizeAddress, safeEqual, utcDayKey } from "./domain";
import type { EmailMessage, Env, ExecutionContext, Monitor, Recipient } from "./types";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "pulseguard-monitor" });
    }
    if (!isAuthorized(request, env)) return Response.json({ error: "unauthorized" }, { status: 401 });

    if (request.method === "POST" && url.pathname === "/v1/monitors") {
      return createMonitor(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/monitors") {
      return listMonitors(env);
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
  }>();
  if (!input.name || !input.inboxAddress || !Number.isInteger(input.scheduleHourUtc)) {
    return Response.json({ error: "name, inboxAddress, and scheduleHourUtc are required" }, { status: 400 });
  }
  if (input.scheduleHourUtc! < 0 || input.scheduleHourUtc! > 23) {
    return Response.json({ error: "scheduleHourUtc must be between 0 and 23" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      "INSERT INTO monitors (id, name, inbox_address, schedule_hour_utc, grace_minutes) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, input.name.trim(), normalizeAddress(input.inboxAddress), input.scheduleHourUtc, input.graceMinutes ?? 15),
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

async function listMonitors(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    "SELECT id, name, inbox_address AS inboxAddress, schedule_hour_utc AS scheduleHourUtc, grace_minutes AS graceMinutes, enabled, last_received_at AS lastReceivedAt FROM monitors ORDER BY created_at DESC",
  ).all();
  return Response.json({ monitors: result.results });
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
    "SELECT id, name, inbox_address AS inboxAddress, schedule_hour_utc AS scheduleHourUtc, grace_minutes AS graceMinutes, enabled, last_received_at AS lastReceivedAt FROM monitors WHERE enabled = 1",
  ).all<Monitor>();
  for (const monitor of result.results) {
    if (!isOverdue(monitor, now)) continue;
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

function isAuthorized(request: Request, env: Env): boolean {
  const value = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(env.ADMIN_API_KEY) && safeEqual(value, env.ADMIN_API_KEY);
}
