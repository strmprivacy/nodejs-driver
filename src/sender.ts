import { Type } from "avsc";
import { Client, ClientConfig } from "./client";
import { ApiStreamEvent, ClientStreamEvent } from "./models/event";
import * as http2 from "http2";
import { ClientHttp2Session } from "http2";
import { Http2Response, post } from "./http";

/**
 * Supported events and their handlers.
 * @todo: Add/remove events based on requirements
 */
export interface SenderConfig extends ClientConfig {
  gatewayUrl: string;
  schemaId: string;
  type: Type;
}

/**
 * Note that Sender has not added any supported events to the client (yet)
 */
export class Sender extends Client {
  private readonly gatewayUrl: string;
  private readonly schemaId: string;
  private readonly type: Type;
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
    this.schemaId = config.schemaId;
    this.type = config.type;
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
  async send<T extends ClientStreamEvent>(event: T): Promise<Http2Response<undefined>> {
    /**
     * Merges ClientStreamEvent with missing fields of ApiStreamEvent to create an ApiStreamEvent
     */
    const apiStreamEvent: ApiStreamEvent = {
      ...event,
      strmMeta: {
        ...event.strmMeta,
        schemaId: this.schemaId,
        nonce: 0,
        timestamp: 0,
      },
    };

    return post(this.session, "/event", this.type.toBuffer(apiStreamEvent), {
      [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "application/octet-stream",
      "Strm-Serialization-Type": "application/x-avro-binary",
      "Strm-Schema-Id": this.schemaId,
      ...this.getBearerHeader(),
    });
  }

  private createSession(): ClientHttp2Session {
    const session = http2.connect(this.gatewayUrl);
    session.setTimeout(Sender.HTTP_SESSION_INACTIVITY_TIMEOUT_IN_MS, () => session.close());
    return session;
  }
}
