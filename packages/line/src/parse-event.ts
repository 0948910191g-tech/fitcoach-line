export type LineInboundEventType = 'text' | 'image';

export interface LineInboundEvent {
  eventId: string;
  userId: string;
  type: LineInboundEventType;
  text?: string;
  messageId?: string;
  occurredAt: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseMessageEvent(value: unknown): LineInboundEvent | null {
  if (!isRecord(value) || value.type !== 'message') return null;

  const eventId = stringValue(value, 'webhookEventId');
  const timestamp = value.timestamp;
  const source = value.source;
  const message = value.message;

  if (
    !eventId ||
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    timestamp < 0 ||
    !isRecord(source) ||
    !isRecord(message)
  ) {
    return null;
  }

  const userId = stringValue(source, 'userId');
  if (!userId) return null;

  const occurredAt = new Date(timestamp).toISOString();
  const messageId = stringValue(message, 'id');

  if (message.type === 'text') {
    const text = typeof message.text === 'string' ? message.text : null;
    if (text === null) return null;

    return messageId
      ? { eventId, userId, type: 'text', text, messageId, occurredAt }
      : { eventId, userId, type: 'text', text, occurredAt };
  }

  if (message.type === 'image') {
    return messageId
      ? { eventId, userId, type: 'image', messageId, occurredAt }
      : { eventId, userId, type: 'image', occurredAt };
  }

  return null;
}

export function parseLineEvents(payload: unknown): LineInboundEvent[] {
  if (!isRecord(payload) || !Array.isArray(payload.events)) return [];

  const events: LineInboundEvent[] = [];
  for (const rawEvent of payload.events) {
    const event = parseMessageEvent(rawEvent);
    if (event) events.push(event);
  }
  return events;
}
