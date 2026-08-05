export interface Env {
  DB: D1Database;
  ADMIN_API_KEY: string;
  RESEND_API_KEY?: string;
  ALERT_FROM_EMAIL?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
}

export type Monitor = {
  id: string;
  name: string;
  inboxAddress: string;
  scheduleHourUtc: number;
  graceMinutes: number;
  enabled: number;
  lastReceivedAt: string | null;
};

export type Recipient = {
  id: string;
  channel: "email" | "sms";
  destination: string;
};

export interface EmailMessage {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream;
  rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  reply(message: { from: string; to: string; subject: string; text: string }): Promise<void>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
