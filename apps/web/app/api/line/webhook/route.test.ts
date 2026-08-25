import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseLineEvents } from '../../../../../../packages/line/src/parse-event';

const CHANNEL_SECRET = 'synthetic-channel-secret';
const ALLOWED_LINE_USER_ID = 'U_SYNTHETIC_OWNER_001';
const DISALLOWED_LINE_USER_ID = 'U_SYNTHETIC_OTHER_002';
const APP_USER_ID = '00000000-0000-4000-8000-000000000001';

function sign(rawBody: string): string {
  return createHmac('sha256', CHANNEL_SECRET).update(rawBody).digest('base64');
}

function lineBody(options: {
  eventId?: string;
  userId?: string;
  messageType?: 'text' | 'image';
  isRedelivery?: boolean;
} = {}): string {
  const eventId = options.eventId ?? 'evt-synthetic-001';
  const userId = options.userId ?? ALLOWED_LINE_USER_ID;
  const messageType = options.messageType ?? 'text';

  return JSON.stringify({
    destination: 'U_SYNTHETIC_BOT',
    events: [
      {
        type: 'message',
        webhookEventId: eventId,
        deliveryContext: { isRedelivery: options.isRedelivery ?? false },
        timestamp: 1_787_648_800_000,
        source: { type: 'user', userId },
        message:
          messageType === 'text'
            ? { id: 'msg-synthetic-text-001', type: 'text', text: 'synthetic meal note' }
            : { id: 'msg-synthetic-image-001', type: 'image' },
      },
    ],
  });
}

async function loadRouteModule(): Promise<Record<string, unknown>> {
  const modulePath: string = './route';
  return import(modulePath).catch(() => ({}));
}

function createRepositories() {
  const seen = new Set<string>();
  const enqueued: Array<Record<string, unknown>> = [];

  const userRepository = {
    getByLineUserId: vi.fn(async (lineUserId: string) =>
      lineUserId === ALLOWED_LINE_USER_ID
        ? {
            id: APP_USER_ID,
            line_user_id: ALLOWED_LINE_USER_ID,
            display_name: null,
            picture_url: null,
            timezone: 'Asia/Bangkok',
            status: 'active',
          }
        : null,
    ),
  };

  const aiJobRepository = {
    ingestLineEvent: vi.fn(async (input: Record<string, unknown>) => {
      const eventId = String(input.providerEventId);
      if (seen.has(eventId)) {
        return { inserted: false, webhookEventId: 'webhook-existing', aiJobId: null };
      }
      seen.add(eventId);
      enqueued.push(input);
      return { inserted: true, webhookEventId: 'webhook-created', aiJobId: 'job-created' };
    }),
  };

  return { userRepository, aiJobRepository, enqueued };
}

async function createHandler(repositories = createRepositories()) {
  const subject = await loadRouteModule();
  expect(subject.createLineWebhookHandler).toBeTypeOf('function');
  if (typeof subject.createLineWebhookHandler !== 'function') {
    return { handler: null, repositories };
  }

  const handler = subject.createLineWebhookHandler({
    channelSecret: CHANNEL_SECRET,
    ownerLineUserIds: [ALLOWED_LINE_USER_ID],
    userRepository: repositories.userRepository,
    aiJobRepository: repositories.aiJobRepository,
  }) as (request: Request) => Promise<Response>;

  return { handler, repositories };
}

async function post(handler: (request: Request) => Promise<Response>, rawBody: string, signature = sign(rawBody)) {
  return handler(
    new Request('https://fitcoach.invalid/api/line/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': signature, 'content-type': 'application/json' },
      body: rawBody,
    }),
  );
}

describe('LINE webhook route', () => {
  it('accepts a valid signature and returns HTTP 200 without waiting for AI processing', async () => {
    const { handler, repositories } = await createHandler();
    if (!handler) return;
    const body = lineBody();

    const response = await post(handler, body);

    expect(response.status).toBe(200);
    expect(repositories.enqueued).toHaveLength(1);
  });

  it('rejects an invalid signature with HTTP 401 before repository access', async () => {
    const { handler, repositories } = await createHandler();
    if (!handler) return;
    const body = lineBody();

    const response = await post(handler, body, 'invalid-signature');

    expect(response.status).toBe(401);
    expect(repositories.userRepository.getByLineUserId).not.toHaveBeenCalled();
    expect(repositories.aiJobRepository.ingestLineEvent).not.toHaveBeenCalled();
  });

  it('does not enqueue a duplicate event twice', async () => {
    const repositories = createRepositories();
    const { handler } = await createHandler(repositories);
    if (!handler) return;
    const body = lineBody({ eventId: 'evt-duplicate-001' });

    expect((await post(handler, body)).status).toBe(200);
    expect((await post(handler, body)).status).toBe(200);

    expect(repositories.aiJobRepository.ingestLineEvent).toHaveBeenCalledTimes(2);
    expect(repositories.enqueued).toHaveLength(1);
  });

  it('ignores a user outside OWNER_LINE_USER_IDS without creating an event or job', async () => {
    const { handler, repositories } = await createHandler();
    if (!handler) return;
    const body = lineBody({ userId: DISALLOWED_LINE_USER_ID });

    const response = await post(handler, body);

    expect(response.status).toBe(200);
    expect(repositories.userRepository.getByLineUserId).not.toHaveBeenCalled();
    expect(repositories.aiJobRepository.ingestLineEvent).not.toHaveBeenCalled();
  });

  it('normalizes a text message into LineInboundEvent', () => {
    const parsed = parseLineEvents(JSON.parse(lineBody()));

    expect(parsed).toEqual([
      {
        eventId: 'evt-synthetic-001',
        userId: ALLOWED_LINE_USER_ID,
        type: 'text',
        text: 'synthetic meal note',
        messageId: 'msg-synthetic-text-001',
        occurredAt: '2026-08-25T09:06:40.000Z',
      },
    ]);
  });

  it('normalizes an image message without inventing text', () => {
    const parsed = parseLineEvents(JSON.parse(lineBody({ messageType: 'image' })));

    expect(parsed).toEqual([
      {
        eventId: 'evt-synthetic-001',
        userId: ALLOWED_LINE_USER_ID,
        type: 'image',
        messageId: 'msg-synthetic-image-001',
        occurredAt: '2026-08-25T09:06:40.000Z',
      },
    ]);
  });

  it('treats LINE redelivery with the same webhookEventId as the same idempotency key', async () => {
    const repositories = createRepositories();
    const { handler } = await createHandler(repositories);
    if (!handler) return;
    const first = lineBody({ eventId: 'evt-retry-001', isRedelivery: false });
    const retry = lineBody({ eventId: 'evt-retry-001', isRedelivery: true });

    expect((await post(handler, first)).status).toBe(200);
    expect((await post(handler, retry)).status).toBe(200);

    expect(repositories.enqueued).toHaveLength(1);
  });
});
