import assert from "node:assert/strict";
import test from "node:test";
import { deadlineFor, isOverdue, normalizeAddress, safeEqual } from "../services/monitor-worker/src/domain.ts";

const monitor = {
  id: "monitor-1",
  name: "Daily revenue",
  inboxAddress: "revenue@example.com",
  scheduleHourUtc: 14,
  graceMinutes: 20,
  enabled: 1,
  lastReceivedAt: null,
};

test("deadline includes the grace period", () => {
  assert.equal(deadlineFor(monitor, new Date("2026-08-05T18:00:00Z")).toISOString(), "2026-08-05T14:20:00.000Z");
});

test("monitor is overdue only after today's deadline without today's receipt", () => {
  assert.equal(isOverdue(monitor, new Date("2026-08-05T14:19:00Z")), false);
  assert.equal(isOverdue(monitor, new Date("2026-08-05T14:21:00Z")), true);
  assert.equal(isOverdue({ ...monitor, lastReceivedAt: "2026-08-05T13:00:00Z" }, new Date("2026-08-05T14:21:00Z")), false);
});

test("addresses normalize and secret comparison checks exact values", () => {
  assert.equal(normalizeAddress(" Daily@Example.COM "), "daily@example.com");
  assert.equal(safeEqual("secret", "secret"), true);
  assert.equal(safeEqual("secret", "secrex"), false);
  assert.equal(safeEqual("short", "longer"), false);
});
