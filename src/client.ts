import { EventEmitter } from "events";
import TypedEmitter from "typed-emitter";
import * as http2 from "http2";
import {
  ClientHttp2Session,
  connect,
  constants,
  Http2ServerResponse,
  OutgoingHttpHeaders,
} from "http2";

/**
 * Token definition
 */
export interface JwtToken {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Config containing values needed to authenticate with the server.
 */
export interface ClientConfig {
  stsUrl: string;
  billingId: string;
  clientId: string;
  clientSecret: string;
}

export enum HTTP_STATUS_CODE {
  UNAUTHORIZED = 401,
  BAD_REQUEST = 400,
}

/**
 * Supported events and their handlers.
 * @todo: Add/remove events based on requirements
 */
export interface ClientEvents {
  error: (error: http2.Http2ServerResponse | Error) => void;
  disconnect: () => void;
  authenticate: () => void;
}

export interface Http2Response<T> {
  status: number;
  data?: T;
}

/**
 * TypeScript magic that overrides the untyped EventEmitter interface and uses a strongly typed one instead.
 */
export abstract class Client<T = ClientEvents> extends (EventEmitter as {
  new <T>(): TypedEmitter<T & ClientEvents>;
})<T> {
  static readonly SEC_BEFORE_EXPIRATION = 60;
  static readonly FAILED_REQUEST_RETRY_ATTEMPTS = 3;

  /**
   * Token used for auth.
   */
  private token: JwtToken | undefined;

  /**
   * Reference to timeout.
   */
  private refreshTimeout: NodeJS.Timeout | undefined;

  protected constructor(private config: ClientConfig) {
    super();
  }

  /**
   * This method opens an auth connection
   */
  async connect(): Promise<void> {
    /**
     * Authenticate if the token is missing or has expired.
     */
    if (this.token === undefined || this.getMsBeforeNextRefresh() < 0) {
      /**
       * No try/catch -> caller of `connect` receives the error if auth fails.
       */
      this.token = await this.authenticate();

      if (this.getMsBeforeNextRefresh() < 0) {
        throw new Error("Token expired");
      }
    }

    /**
     * Start refreshing the token
     */
    await this.scheduleRefresh(this.token);
  }

  disconnect(): void {
    /**
     * Clear refresh timeout
     */
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    /**
     * Emit an event
     */
    this.emit("disconnect");
  }

  private async authenticate(): Promise<JwtToken> {
    const { data } = await this.post<JwtToken>(
      this.config.stsUrl,
      "/auth",
      JSON.stringify({
        billingId: this.config.billingId,
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      }),
      {
        [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "application/json",
      }
    );
    return data!;
  }

  protected post<R = undefined>(
    urlOrClient: string | ClientHttp2Session,
    path: string,
    dataStringOrBuffer: string | Buffer,
    headers: OutgoingHttpHeaders = {}
  ): Promise<Http2Response<R>> {
    const client: ClientHttp2Session =
      typeof urlOrClient === "string" ? connect(urlOrClient) : urlOrClient;

    const buffer =
      typeof dataStringOrBuffer === "string" ? Buffer.from(dataStringOrBuffer) : dataStringOrBuffer;

    const request = client.request({
      [constants.HTTP2_HEADER_SCHEME]: "https",
      [constants.HTTP2_HEADER_METHOD]: constants.HTTP2_METHOD_POST,
      [constants.HTTP2_HEADER_PATH]: path,
      [constants.HTTP2_HEADER_CONTENT_LENGTH]: Buffer.byteLength(buffer),
      ...headers,
    });
    request.setEncoding("utf8");

    const chunks: string[] = [];
    request.on("data", (chunk) => chunks.push(chunk));

    let status: number;
    let contentType: string;

    request.on("response", (headers, flags) => {
      status = parseInt(headers[constants.HTTP2_HEADER_STATUS] as string, 10);
      contentType = headers[constants.HTTP2_HEADER_CONTENT_TYPE] as string;
    });

    request.write(buffer);

    const isLocalClientSession = typeof urlOrClient === "string";
    return new Promise<Http2Response<R>>((resolve, reject) => {
      request.on("end", () => {
        const response = chunks.join();
        if (status === 200) {
          const data = contentType.includes("text/plain")
            ? response
            : contentType.includes("application/json")
            ? JSON.parse(response)
            : undefined;
          resolve({ status, data });
        } else if (status === 204) {
          resolve({ status });
        } else {
          reject({ status, data: response });
        }

        if (isLocalClientSession) {
          client.close();
        }
      });

      request.end();
    });
  }
  /**
   * Method that keeps the auth session alive.
   */
  private scheduleRefresh(token: JwtToken, retryAttempt = 0): void {
    /**
     * Keep a reference to the active timeout so it can be cancelled on disconnect.
     */
    this.refreshTimeout = setTimeout(
      async () => {
        /**
         * The user of this client is not able to receive errors from this async logic so errors are caught and emitted
         * as events.
         */
        try {
          this.token = await this.refresh(token);
          this.scheduleRefresh(this.token);
        } catch (error) {
          const statusCode = (error as Http2ServerResponse).statusCode;
          /**
           * Retry mechanism
           */
          if (
            statusCode !== HTTP_STATUS_CODE.UNAUTHORIZED &&
            statusCode !== HTTP_STATUS_CODE.BAD_REQUEST &&
            retryAttempt < Client.FAILED_REQUEST_RETRY_ATTEMPTS
          ) {
            await this.scheduleRefresh(token, ++retryAttempt);
          } else {
            this.emit("error", error);
            this.disconnect();
          }
        }
      },
      retryAttempt === 0 ? this.getMsBeforeNextRefresh() : 0
    );
  }

  /**
   * Returns the header used for auth.
   */
  protected getBearerHeader(): Record<"Authorization", string> | {} {
    return this.token ? { Authorization: `Bearer ${this.token.idToken}` } : {};
  }

  /**
   * Refreshes the token.
   */
  private async refresh(oldToken: JwtToken): Promise<JwtToken> {
    const { data } = await this.post<JwtToken>(
      `${this.config.stsUrl}`,
      "refresh",
      JSON.stringify(oldToken),
      {
        [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "application/json",
      }
    );
    return data!;
  }

  /**
   * Returns the amount of ms until n seconds before the token expires.
   */
  private getMsBeforeNextRefresh(): number {
    if (this.token === undefined) {
      return -1;
    }
    const timeUntilExpirationInSec = this.token.expiresAt - new Date().getTime() / 1000;
    return (timeUntilExpirationInSec - Client.SEC_BEFORE_EXPIRATION) * 1000;
  }
}
