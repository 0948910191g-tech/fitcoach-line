import { createHash } from 'node:crypto';
import { getServerEnv } from '../../../../../../packages/config/src/env';
import { createServiceDatabaseClient } from '../../../../../../packages/db/src/client';
import { AIJobRepository } from '../../../../../../packages/db/src/repositories/ai-job';
import { UserRepository } from '../../../../../../packages/db/src/repositories/user';
import { parseLineEvents } from '../../../../../../packages/line/src/parse-event';
import { verifyLineSignature } from '../../../../../../packages/line/src/verify-signature';
import { LineEventService } from '../../../../src/services/line-event-service';

export interface LineWebhookHandlerDependencies {
  channelSecret: string;
  ownerLineUserIds: readonly string[];
  aiJobRepository: Pick<AIJobRepository, 'ingestLineEvent'>;
  userRepository: Pick<UserRepository, 'getByLineUserId'>;
}

export function createLineWebhookHandler(dependencies: LineWebhookHandlerDependencies) {
  const eventService = new LineEventService({
    aiJobRepository: dependencies.aiJobRepository,
    userRepository: dependencies.userRepository,
    ownerLineUserIds: dependencies.ownerLineUserIds,
  });

  return async function handleLineWebhook(request: Request): Promise<Response> {
    const rawBody = await request.text();
    const signature = request.headers.get('x-line-signature');

    if (!(await verifyLineSignature(rawBody, signature, dependencies.channelSecret))) {
      return new Response(null, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody) as unknown;
    } catch {
      return new Response(null, { status: 400 });
    }

    const events = parseLineEvents(payload);
    const payloadHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');

    await Promise.all(events.map((event) => eventService.accept(event, payloadHash)));

    return new Response(null, { status: 200 });
  };
}

export async function POST(request: Request): Promise<Response> {
  const env = getServerEnv();
  const databaseClient = createServiceDatabaseClient(env);
  const handler = createLineWebhookHandler({
    channelSecret: env.LINE_CHANNEL_SECRET,
    ownerLineUserIds: env.OWNER_LINE_USER_IDS,
    aiJobRepository: new AIJobRepository(databaseClient),
    userRepository: new UserRepository(databaseClient),
  });

  return handler(request);
}
