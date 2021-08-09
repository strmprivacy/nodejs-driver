import { Client, ClientConfig, ClientEvents } from './client';
import * as Websocket from 'ws';
import { StrmEvent } from './models/event';

/**
 * Supported events and their handlers.
 * @todo: Add/remove events based on requirements
 */
interface ReceiverEvents extends ClientEvents {
  event: (event: StrmEvent) => void;
}

export interface ReceiverConfig extends ClientConfig {
  egressUrl: string;
}

export class Receiver extends Client<ReceiverEvents> {
  private websocket: Websocket | undefined;
  private readonly egressUrl: string;

  constructor(config: ReceiverConfig) {
    super(config);
    this.egressUrl = config.egressUrl;
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
    this.websocket = new Websocket(`${this.egressUrl}/ws?asJson=true`, {
      headers: { ...this.getBearerHeader() },
    });

    this.websocket.on('open', () => {
      console.debug('websocket connected');
      /**
       * Could emit `connect` event
       */
    });

    /**
     * Forward the error to this client
     */
    this.websocket.on('error', (error) => this.emit('error', error));
    this.websocket.on('close', (error) => this.emit('disconnect'));
    this.websocket.on('unexpected-response', (error, response) =>
      this.emit('error', new Error('Unexpected response'))
    );

    /**
     * Parse and process the incoming message and emit the result as `event`.
     */
    this.websocket.on('message', async (message: string) => {
      try {
        this.emit('event', JSON.parse(message));
      } catch (error) {
        this.emit('error', error);
      }
    });
  }

  disconnect() {
    super.disconnect();
    if (this.websocket) {
      this.websocket.close();
    }
  }
}
