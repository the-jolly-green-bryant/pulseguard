import type { Env, Monitor, Recipient } from "./types";

type Delivery = { recipientId: string; ok: boolean; detail: string };

export async function deliverAlerts(
  env: Env,
  monitor: Monitor,
  recipients: Recipient[],
): Promise<Delivery[]> {
  return Promise.all(recipients.map((recipient) => deliver(env, monitor, recipient)));
}

async function deliver(env: Env, monitor: Monitor, recipient: Recipient): Promise<Delivery> {
  try {
    if (recipient.channel === "email") {
      await sendEmail(env, monitor, recipient.destination);
    } else {
      await sendSms(env, monitor, recipient.destination);
    }
    return { recipientId: recipient.id, ok: true, detail: "accepted" };
  } catch (error) {
    return {
      recipientId: recipient.id,
      ok: false,
      detail: error instanceof Error ? error.message : "unknown delivery failure",
    };
  }
}

async function sendEmail(env: Env, monitor: Monitor, to: string): Promise<void> {
  if (env.AWS_SES_ALERT_URL && env.SES_WEBHOOK_SECRET) {
    const response = await fetch(env.AWS_SES_ALERT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pulseguard-secret": env.SES_WEBHOOK_SECRET },
      body: JSON.stringify({ to, subject: `Missing email: ${monitor.name}`, text: `Pulseguard did not receive “${monitor.name}” by its expected deadline. Check the source system and delivery path.` }),
    });
    if (!response.ok) throw new Error(`AWS SES alert service returned ${response.status}`);
    return;
  }
  if (!env.RESEND_API_KEY || !env.ALERT_FROM_EMAIL) {
    throw new Error("email provider is not configured");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `missing-${monitor.id}-${new Date().toISOString().slice(0, 10)}`,
    },
    body: JSON.stringify({
      from: env.ALERT_FROM_EMAIL,
      to: [to],
      subject: `Missing email: ${monitor.name}`,
      text: `Pulseguard did not receive “${monitor.name}” by its expected deadline. Check the source system and delivery path.`,
    }),
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}`);
}

async function sendSms(env: Env, monitor: Monitor, to: string): Promise<void> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    throw new Error("SMS provider is not configured");
  }
  const body = new URLSearchParams({
    To: to,
    From: env.TWILIO_FROM_NUMBER,
    Body: `Pulseguard: “${monitor.name}” did not arrive by its expected deadline.`,
  });
  const credentials = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );
  if (!response.ok) throw new Error(`Twilio returned ${response.status}`);
}
