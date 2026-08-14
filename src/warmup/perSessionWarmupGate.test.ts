import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PerSessionWarmupGate } from './perSessionWarmupGate';
import { WarmupSchedule } from './warmupSchedule';
import { WarmupTracker } from './warmupTracker';

function tempDir(t: import('node:test').TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'per-session-warmup-gate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function buildGate(
  t: import('node:test').TestContext,
  dir: string,
  sessionId = 'session-1',
  fullAllotment = 100,
) {
  const schedule = new WarmupSchedule({ warmupDays: 10, startFraction: 0.1 });
  const tracker = new WarmupTracker(join(dir, 'warmup-activations.json'));
  const gate = new PerSessionWarmupGate(
    sessionId,
    fullAllotment,
    schedule,
    tracker,
    join(dir, `warmup-gate-${sessionId}.json`),
  );
  return { gate, tracker };
}

test('day 0 limits sends to the ramp start fraction', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  t.mock.timers.setTime(Date.parse('2026-08-13T10:00:00Z'));

  const dir = tempDir(t);
  const { gate, tracker } = buildGate(t, dir);
  tracker.recordActivation('session-1');

  for (let i = 0; i < 10; i += 1) {
    assert.equal(gate.hasCapacity(), true);
    gate.recordSend();
  }
  assert.equal(gate.hasCapacity(), false);
});

test('once warmupDays have elapsed, the full allotment is released', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  t.mock.timers.setTime(Date.parse('2026-08-13T10:00:00Z'));

  const dir = tempDir(t);
  const { gate, tracker } = buildGate(t, dir);
  tracker.recordActivation('session-1');

  t.mock.timers.setTime(Date.parse('2026-08-24T10:00:00Z')); // 11 days later

  for (let i = 0; i < 100; i += 1) {
    assert.equal(gate.hasCapacity(), true);
    gate.recordSend();
  }
  assert.equal(gate.hasCapacity(), false);
});

test('persists the count across restarts (same file, new instance)', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  t.mock.timers.setTime(Date.parse('2026-08-13T10:00:00Z'));

  const dir = tempDir(t);
  const { gate: first, tracker } = buildGate(t, dir);
  tracker.recordActivation('session-1');
  first.recordSend();
  first.recordSend();
  first.recordSend();

  const schedule = new WarmupSchedule({ warmupDays: 10, startFraction: 0.1 });
  const restartedTracker = new WarmupTracker(join(dir, 'warmup-activations.json'));
  const afterRestart = new PerSessionWarmupGate(
    'session-1',
    100,
    schedule,
    restartedTracker,
    join(dir, 'warmup-gate-session-1.json'),
  );

  // day 0 allotment is 10; 3 already sent, so 7 more should fit before saturating.
  for (let i = 0; i < 7; i += 1) {
    assert.equal(afterRestart.hasCapacity(), true);
    afterRestart.recordSend();
  }
  assert.equal(afterRestart.hasCapacity(), false);
});

test('resets the count once the day rolls over', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  t.mock.timers.setTime(Date.parse('2026-08-13T10:00:00Z'));

  const dir = tempDir(t);
  const { gate, tracker } = buildGate(t, dir);
  tracker.recordActivation('session-1');

  for (let i = 0; i < 10; i += 1) {
    gate.recordSend();
  }
  assert.equal(gate.hasCapacity(), false);

  t.mock.timers.setTime(Date.parse('2026-08-14T00:30:00Z'));
  assert.equal(gate.hasCapacity(), true);
});
