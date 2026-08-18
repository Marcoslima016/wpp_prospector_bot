import { createInterface, type Interface } from 'node:readline';
import { config as loadEnv } from 'dotenv';
import { SessionManager } from './whatsapp/sessionManager';
import { WhatsAppSession } from './whatsapp/session';
import { WarmupTracker } from './warmup/warmupTracker';
import { WarmupSchedule } from './warmup/warmupSchedule';
import { PerSessionWarmupGate } from './warmup/perSessionWarmupGate';
import { DailyVolumeLimiter } from './outbound/dailyVolumeLimiter';
import { SendQueue } from './outbound/sendQueue';
import { loadReasoningConfig } from './reasoning/infrastructure/reasoningConfig';
import { ClaudeReasoningRepository } from './reasoning/infrastructure/claudeReasoningRepository';
import { FileConversationRepository } from './reasoning/infrastructure/fileConversationRepository';
import { ProcessIncomingMessage } from './reasoning/application/processIncomingMessage';

loadEnv();

const DAILY_VOLUME_LIMIT = 100; // see anti-ban-warmup spec - "Daily volume ceiling enforcement"

async function waitForReady(session: WhatsAppSession): Promise<void> {
  if (session.getStatus() === 'ready') {
    return;
  }
  await new Promise<void>((resolve) => {
    session.once('ready', () => resolve());
  });
}

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

/**
 * Lets the operator pick the pairing method for this run instead of baking
 * it into an env var - QR code needs no phone number, pairing code does
 * (falls back to WA_PAIRING_NUMBER from .env, or asks if that's unset too).
 */
async function promptPairingNumber(rl: Interface): Promise<string | undefined> {
  const answer = await ask(
    rl,
    'Como parear esta sessão?\n  1) QR Code\n  2) Código de pareamento (número de telefone)\nEscolha (1/2) [1]: ',
  );
  if (answer !== '2') {
    return undefined;
  }
  const envNumber = process.env.WA_PAIRING_NUMBER;
  if (envNumber) {
    return envNumber;
  }
  return ask(rl, 'Número de telefone (dígitos com DDI, sem "+"/espaços): ');
}

async function main(): Promise<void> {
  const sessionId = process.env.SESSION_ID;
  if (!sessionId) {
    throw new Error('SESSION_ID environment variable is required (e.g. SESSION_ID=default-number)');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required to run the reasoning engine');
  }
  const reasoningConfig = loadReasoningConfig();

  const warmupTracker = new WarmupTracker();
  const sessionManager = new SessionManager(undefined, warmupTracker);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pairingNumber = await promptPairingNumber(rl);
  console.log(
    pairingNumber
      ? `Pairing session "${sessionId}"... requesting a pairing code for ${pairingNumber}.`
      : `Pairing session "${sessionId}"... scan the QR code below with WhatsApp if prompted.`,
  );
  const session = await sessionManager.addSession(sessionId, { pairingNumber }, (createdSession) => {
    createdSession.on('pairing_code', (code) => {
      console.log(`Pairing code for "${sessionId}": ${code}`);
    });
    createdSession.on('disconnected', (reason) => {
      console.error(`Session "${sessionId}" disconnected: ${reason}`);
    });
  });
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

  const conversationRepository = new FileConversationRepository();
  const reasoningRepository = new ClaudeReasoningRepository(reasoningConfig);
  const processIncomingMessage = new ProcessIncomingMessage(conversationRepository, reasoningRepository, (reply) =>
    sendQueue.enqueue(reply),
  );

  session.on('message', (message) => {
    processIncomingMessage
      .execute(message.sessionId, message.from, message.text, message.timestamp)
      .catch((error) => {
        // Mirrors SendQueue's own failure handling: a single failed
        // reasoning/reply attempt must not take down the process.
        console.error(`Failed to process message from ${message.from}:`, error);
      });
  });

  console.log('Type "<numeroDestino> <texto>" to queue a test message (Ctrl+C to exit).');
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
