import { LoggerService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { connect, JetStreamClient, JSONCodec, NatsConnection } from 'nats';

import { eventEnvelopeSchema, EventEnvelope } from '../contracts/eventContract';

export interface EventPublisher {
  publish(event: EventEnvelope): Promise<void>;
}

class LoggerEventPublisher implements EventPublisher {
  constructor(private readonly logger: LoggerService) {}

  async publish(event: EventEnvelope): Promise<void> {
    const parsed = eventEnvelopeSchema.parse(event);
    this.logger.info(`event:${parsed.topic} ${JSON.stringify(parsed)}`);
  }
}

class JetStreamPublisher implements EventPublisher {
  private connection: NatsConnection | null = null;

  private jetStream: JetStreamClient | null = null;

  private readonly codec = JSONCodec<EventEnvelope>();

  constructor(
    private readonly logger: LoggerService,
    private readonly serverUrl: string,
    private readonly stream: string,
    private readonly subjectPrefix: string,
  ) {}

  private async getClient(): Promise<JetStreamClient> {
    if (this.jetStream) {
      return this.jetStream;
    }

    this.connection = await connect({
      servers: this.serverUrl,
      name: 'smartops-agent-platform',
    });
    this.jetStream = this.connection.jetstream();

    this.logger.info(
      `Connected to NATS JetStream server=${this.serverUrl} stream=${this.stream}`,
    );

    return this.jetStream;
  }

  async publish(event: EventEnvelope): Promise<void> {
    try {
      const parsed = eventEnvelopeSchema.parse(event);
      const client = await this.getClient();
      const subject = this.subjectPrefix
        ? `${this.subjectPrefix}.${parsed.topic}`
        : parsed.topic;

      await client.publish(subject, this.codec.encode(parsed));
    } catch (error) {
      this.logger.warn(
        `JetStream publish failed, event dropped: ${(error as Error).message}`,
      );
    }
  }
}

export const createEventPublisher = (
  config: Config,
  logger: LoggerService,
): EventPublisher => {
  const enabled = config.getOptionalBoolean('smartops.events.enabled') ?? false;
  const mode = config.getOptionalString('smartops.events.mode') ?? 'logger';

  if (!enabled || mode === 'logger') {
    return new LoggerEventPublisher(logger);
  }

  const serverUrl =
    config.getOptionalString('smartops.events.nats.serverUrl') ??
    'nats://localhost:4222';
  const stream =
    config.getOptionalString('smartops.events.nats.stream') ?? 'SMARTOPS';
  const subjectPrefix =
    config.getOptionalString('smartops.events.nats.subjectPrefix') ?? '';

  return new JetStreamPublisher(logger, serverUrl, stream, subjectPrefix);
};
