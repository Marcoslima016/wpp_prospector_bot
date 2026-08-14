import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WarmupSchedule } from './warmupSchedule';

test('allows only a small fraction of the full allotment on day 0', () => {
  const schedule = new WarmupSchedule({ warmupDays: 10, startFraction: 0.1 });
  assert.equal(schedule.allowedVolume(0, 100), 10);
});

test('reaches the full allotment once the warmup period has elapsed', () => {
  const schedule = new WarmupSchedule({ warmupDays: 10, startFraction: 0.1 });
  assert.equal(schedule.allowedVolume(10, 100), 100);
  assert.equal(schedule.allowedVolume(30, 100), 100);
});

test('ramps up monotonically between day 0 and the full warmup', () => {
  const schedule = new WarmupSchedule({ warmupDays: 10, startFraction: 0.1 });
  const volumes = Array.from({ length: 11 }, (_, day) => schedule.allowedVolume(day, 100));
  for (let i = 1; i < volumes.length; i += 1) {
    assert.ok(volumes[i] >= volumes[i - 1], `day ${i} volume should not be lower than day ${i - 1}`);
  }
});

test('never allows zero messages, even for a tiny full allotment', () => {
  const schedule = new WarmupSchedule({ warmupDays: 10, startFraction: 0.1 });
  assert.equal(schedule.allowedVolume(0, 3), 1);
});

test('rejects a negative days-since-activation', () => {
  const schedule = new WarmupSchedule();
  assert.throws(() => schedule.allowedVolume(-1, 100), RangeError);
});
