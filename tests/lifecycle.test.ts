import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldStop, type Activity } from "../src/core/contracts";
const now = 2_000_000;
const idle: Activity = {
  lastSeen: now - 30_000,
  lastActivity: now - 31 * 60_000,
  activeJobs: 0,
  activeConnections: 0,
  idleMinutes: 30,
};
test("idle shutdown only uses fresh, inactive observations", () => {
  assert.equal(shouldStop(idle, now), true);
  for (const change of [
    { lastSeen: now - 121_000 },
    { lastSeen: now + 1 },
    { activeJobs: 1 },
    { activeConnections: 1 },
    { idleMinutes: 0 },
    { lastActivity: now - 100 },
  ])
    assert.equal(shouldStop({ ...idle, ...change }, now), false);
});
test("explicit lifetime expires even with activity or lost heartbeat", () => {
  assert.equal(
    shouldStop({ ...idle, lastSeen: 0, activeJobs: 2, stopAt: now }, now),
    true,
  );
  assert.equal(
    shouldStop({ ...idle, activeJobs: 2, stopAt: now + 1 }, now),
    false,
  );
});
