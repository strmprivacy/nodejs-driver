import { Type } from "avsc";
import { Client, ClientConfig } from "./client";
import { ApiStreamEvent, ClientStreamEvent } from "./models/event";
import * as http2 from "http2";
import { ClientHttp2Session } from "http2";

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
  private client: ClientHttp2Session | undefined;

  constructor(config: SenderConfig) {
    /**
     * Passes ClientConfig and urls that require authentication to the base class.
     */
    super(config);
    this.gatewayUrl = config.gatewayUrl;
    this.schemaId = config.schemaId;
    this.type = config.type;
  }

  async connect(): Promise<void> {
    await super.connect();
    /**
     * @TODO: Needs improvement
     */
    this.client = http2.connect(this.gatewayUrl);
  }

  /**
   * Sends an event
   */
  async send<T extends ClientStreamEvent>(event: T): Promise<any> {
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

    if (this.client === undefined) {
      throw Error("No connection");
    }

    return this.post(this.client, "/event", this.type.toBuffer(apiStreamEvent), {
      [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "application/octet-stream",
      "Strm-Serialization-Type": "application/x-avro-binary",
      "Strm-Schema-Id": this.schemaId,
      ...this.getBearerHeader(),
    });
  }
}
