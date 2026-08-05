import type { Monitor } from "./types";

export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function deadlineFor(monitor: Monitor, now: Date): Date {
  const deadline = new Date(now);
  deadline.setUTCHours(monitor.scheduleHourUtc, monitor.graceMinutes, 0, 0);
  return deadline;
}

export function isOverdue(monitor: Monitor, now: Date): boolean {
  if (!monitor.enabled || now < deadlineFor(monitor, now)) return false;
  if (!monitor.lastReceivedAt) return true;
  return utcDayKey(new Date(monitor.lastReceivedAt)) !== utcDayKey(now);
}

export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
