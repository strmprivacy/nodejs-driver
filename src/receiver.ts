import { Type } from "avsc";
import { Client, ClientConfig, ClientEvents } from "./client";
import * as Websocket from "ws";
import { ApiStreamEvent } from "./models/event";
import { Buffer } from "buffer";

/**
 * Supported events and their handlers.
 * @todo: Add/remove events based on requirements
 */
interface ReceiverEvents extends ClientEvents {
  event: (event: ApiStreamEvent) => void;
}

export interface ReceiverConfig extends ClientConfig {
  schemaUrl: string;
}

export class Receiver extends Client<ReceiverEvents> {
  websocket: Websocket | undefined;
  private readonly schemaUrl: string;
  private cache: {
    [key: string]: Type;
  } = {};

  constructor(config: ReceiverConfig) {
    super(config, [config.schemaUrl]);
    this.schemaUrl = config.schemaUrl;
  }

  async connect(): Promise<void> {
    await super.connect();

    /**
     * @todo: Revisit auth solution
     * https://devcenter.heroku.com/articles/websocket-security#authentication-authorization
     * "Since you cannot customize WebSocket headers from JavaScript, you’re limited to the “implicit” auth
     * (i.e. Basic or cookies) that’s sent from the browser."
     *
     * Basically a Bearer header and Websocket don't go well together. If the server can't provide a secured way of
     * dealing with websockets then we'll have to manually refresh (disconnect -> connect) this socket with a new
     * Bearer header everytime the token changes.
     */
    this.websocket = new Websocket(`${this.schemaUrl}/ws`, {
      headers: { ...this.getBearerHeader() },
    });

    this.websocket.on("open", () => {
      console.debug("websocket connected");
      /**
       * @todo: Could emit `connect` event
       */
    });

    /**
     * Forward the error to this client
     */
    this.websocket.on("error", (error) => this.emit("error", error));

    /**
     * Parse and process the incoming message and emit the result as `event`.
     */
    this.websocket.on("message", async (message: string) => {
      try {
        /**
         * @todo: Check requirements to see what to do here
         */
        const buf = Buffer.from(message, "base64");
        const confluentSchemaId = buf.readUInt32BE(1);
        const avroData = buf.slice(5);
        const type = await this.getSchemaById(confluentSchemaId);
        const event: ApiStreamEvent = type.fromBuffer(avroData);
        this.emit("event", event);
      } catch (error) {
        this.emit("error", error);
      }
    });
  }

  disconnect() {
    super.disconnect();
    if (this.websocket) {
      this.websocket.close();
    }
  }

  /**
   * return a Promise to avsc interpreted schema definition.
   * @todo: Memory cache enough?
   */
  private async getSchemaById(schemaId: number): Promise<Type> {
    const cacheKey = `schema${schemaId}`;
    if (this.cache[cacheKey] === undefined) {
      const { data } = await this.axiosInstance.get(`${this.schemaUrl}/schemas/ids/${schemaId}`);
      this.cache[cacheKey] = Type.forSchema(JSON.parse(data.schema));
    }
    return this.cache[cacheKey];
  }
}
