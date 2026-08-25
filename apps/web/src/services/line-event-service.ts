import type { AIJobRepository } from '../../../../packages/db/src/repositories/ai-job';
import type { UserRepository } from '../../../../packages/db/src/repositories/user';
import type { LineInboundEvent } from '../../../../packages/line/src/parse-event';

export interface LineEventServiceDependencies {
  aiJobRepository: Pick<AIJobRepository, 'ingestLineEvent'>;
  userRepository: Pick<UserRepository, 'getByLineUserId'>;
  ownerLineUserIds: readonly string[];
}

export interface LineEventAcceptance {
  accepted: boolean;
  enqueued: boolean;
}

export class LineEventService {
  private readonly ownerLineUserIds: ReadonlySet<string>;

  constructor(private readonly dependencies: LineEventServiceDependencies) {
    this.ownerLineUserIds = new Set(dependencies.ownerLineUserIds);
  }

  async accept(event: LineInboundEvent, payloadHash: string): Promise<LineEventAcceptance> {
    if (!this.ownerLineUserIds.has(event.userId)) {
      return { accepted: false, enqueued: false };
    }

    const user = await this.dependencies.userRepository.getByLineUserId(event.userId);
    if (!user || user.status !== 'active') {
      return { accepted: false, enqueued: false };
    }

    const result = await this.dependencies.aiJobRepository.ingestLineEvent({
      providerEventId: event.eventId,
      eventType: event.type,
      payloadHash,
      userId: user.id,
      taskType: event.type === 'text' ? 'line_text_ingestion' : 'line_image_ingestion',
      inputRef: `line-event:${event.eventId}`,
    });

    return { accepted: true, enqueued: result.inserted };
  }
}
