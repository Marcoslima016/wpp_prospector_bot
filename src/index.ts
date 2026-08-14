import { createInterface } from 'node:readline';
import { SessionManager } from './whatsapp/sessionManager';
import { WhatsAppSession } from './whatsapp/session';
import { WarmupTracker } from './warmup/warmupTracker';
import { WarmupSchedule } from './warmup/warmupSchedule';
import { PerSessionWarmupGate } from './warmup/perSessionWarmupGate';
import { DailyVolumeLimiter } from './outbound/dailyVolumeLimiter';
import { SendQueue } from './outbound/sendQueue';

const DAILY_VOLUME_LIMIT = 100; // see anti-ban-warmup spec - "Daily volume ceiling enforcement"

async function waitForReady(session: WhatsAppSession): Promise<void> {
  if (session.getStatus() === 'ready') {
    return;
  }
  await new Promise<void>((resolve) => {
    session.once('ready', () => resolve());
  });
}

async function main(): Promise<void> {
  const sessionId = process.env.SESSION_ID;
  if (!sessionId) {
    throw new Error('SESSION_ID environment variable is required (e.g. SESSION_ID=default-number)');
  }

  const warmupTracker = new WarmupTracker();
  const sessionManager = new SessionManager(undefined, warmupTracker);

  console.log(`Pairing session "${sessionId}"... scan the QR code below with WhatsApp if prompted.`);
  const session = await sessionManager.addSession(sessionId);
  await waitForReady(session);
  console.log(`Session "${sessionId}" is ready.`);

  const warmupGate = new PerSessionWarmupGate(
    sessionId,
    DAILY_VOLUME_LIMIT,
    new WarmupSchedule(),
    warmupTracker,
  );
  const dailyLimiter = new DailyVolumeLimiter(DAILY_VOLUME_LIMIT);

  const sendQueue = new SendQueue(
    async (message) => {
      await session.sendMessage(message.to, message.text);
    },
    { gates: [warmupGate, dailyLimiter] },
  );

  console.log('Type "<numeroDestino> <texto>" to queue a test message (Ctrl+C to exit).');
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const [to, ...textParts] = trimmed.split(' ');
    const text = textParts.join(' ');
    if (!to || !text) {
      console.log('Usage: <numeroDestino> <texto>');
      return;
    }
    sendQueue.enqueue({ sessionId, to, text });
    console.log(`Queued message to ${to} (${sendQueue.pending} pending).`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
