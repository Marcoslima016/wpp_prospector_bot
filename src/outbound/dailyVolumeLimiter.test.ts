import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DailyVolumeLimiter } from './dailyVolumeLimiter';

function tempLimiterFile(t: import('node:test').TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-volume-limiter-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'daily-volume.json');
}

test('starts with full capacity when no prior state exists', (t) => {
  const limiter = new DailyVolumeLimiter(100, tempLimiterFile(t));
  assert.equal(limiter.hasCapacity(), true);
  assert.equal(limiter.remainingToday(), 100);
});

test('reaches the ceiling after the configured number of sends', (t) => {
  const limiter = new DailyVolumeLimiter(3, tempLimiterFile(t));

  limiter.recordSend();
  limiter.recordSend();
  assert.equal(limiter.hasCapacity(), true);
  assert.equal(limiter.remainingToday(), 1);

  limiter.recordSend();
  assert.equal(limiter.hasCapacity(), false);
  assert.equal(limiter.remainingToday(), 0);
});

test('persists the count across restarts (same file, new instance)', (t) => {
  const filePath = tempLimiterFile(t);
  const first = new DailyVolumeLimiter(5, filePath);
  first.recordSend();
  first.recordSend();

  const afterRestart = new DailyVolumeLimiter(5, filePath);
  assert.equal(afterRestart.remainingToday(), 3);
});

test('resets the count once the day rolls over', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  t.mock.timers.setTime(Date.parse('2026-08-13T10:00:00Z'));

  const filePath = tempLimiterFile(t);
  const limiter = new DailyVolumeLimiter(2, filePath);
  limiter.recordSend();
  limiter.recordSend();
  assert.equal(limiter.hasCapacity(), false);

  t.mock.timers.setTime(Date.parse('2026-08-14T00:30:00Z'));
  assert.equal(limiter.hasCapacity(), true);
  assert.equal(limiter.remainingToday(), 2);
});

test('reports a positive time-to-reset within 24 hours', (t) => {
  const limiter = new DailyVolumeLimiter(100, tempLimiterFile(t));
  const msUntilReset = limiter.msUntilReset();
  assert.ok(msUntilReset > 0);
  assert.ok(msUntilReset <= 24 * 60 * 60 * 1000);
});
