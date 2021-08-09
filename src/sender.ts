import { Type } from 'avsc';
import { Client, ClientConfig } from './client';
import * as http2 from 'http2';
import { ClientHttp2Session } from 'http2';
import { Http2Response, post } from './http';
import { EventSerializerProvider, SerializationType } from './serialization';
import { StrmEvent } from './models/event';

/**
 * Supported events and their handlers.
 * @todo: Add/remove events based on requirements
 */
export interface SenderConfig extends ClientConfig {
  gatewayUrl: string;
  schemaRef: string;
  type: Type;
}

/**
 * Note that Sender has not added any supported events to the client (yet)
 */
export class Sender extends Client {
  private readonly gatewayUrl: string;
  private _session: ClientHttp2Session | undefined;

  private static HTTP_SESSION_INACTIVITY_TIMEOUT_IN_MS = 1000 * 60;

  private get session(): ClientHttp2Session {
    if (this._session === undefined || this._session.closed) {
      this._session = this.createSession();
    }
    return this._session;
  }

  constructor(config: SenderConfig) {
    /**
     * Passes ClientConfig and urls that require authentication to the base class.
     */
    super(config);
    this.gatewayUrl = config.gatewayUrl;
  }

  async disconnect(): Promise<void> {
    await super.disconnect();
    /**
     * No call to `this.session` because we don't want to potentially reconnect.
     */
    if (this._session !== undefined && !this._session.closed) {
      this._session.close();
    }
  }

  /**
   * Sends an event
   */
  async send(
    event: StrmEvent,
    serializationType: SerializationType
  ): Promise<Http2Response<undefined>> {
    const eventSerializer = EventSerializerProvider.getEventSerializer(event.strmSchemaRef, event);

    let bearerHeader = this.getBearerHeader();
    return post(this.session, '/event', eventSerializer.serialize(event, serializationType), {
      [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: 'application/octet-stream',
      'Strm-Serialization-Type': 'application/x-avro-binary',
      'Strm-Schema-Ref': event.strmSchemaRef,
      ...bearerHeader,
    });
  }

  private createSession(): ClientHttp2Session {
    const session = http2.connect(this.gatewayUrl);
    session.setTimeout(Sender.HTTP_SESSION_INACTIVITY_TIMEOUT_IN_MS, () => session.close());
    return session;
  }
}
