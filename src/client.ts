import axios, { AxiosError, AxiosRequestConfig, CancelTokenSource } from "axios";
import { EventEmitter } from "events";
import TypedEmitter from "typed-emitter";
import * as http from "http";
import * as https from "https";

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
  authUrl: string;
  billingId: string;
  clientId: string;
  secret: string;
  topic: string;
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
  error: (error: AxiosError | Error) => void;
  disconnect: () => void;
  authenticate: () => void;
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
   * Separate instance of axios so it does not interfere with others.
   */
  protected axiosInstance = axios.create({
    timeout: 5000,

    //keepAlive pools and reuses TCP connections, so it's faster
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),

  });

  /**
   * Token used for auth.
   */
  private token: JwtToken | undefined;

  /**
   * Reference to timeout.
   */
  private refreshTimeout: NodeJS.Timeout | undefined;

  /**
   * Token that can cancel Axios requests.
   */
  private requestToken: CancelTokenSource | undefined;

  protected constructor(private config: ClientConfig, private apiUrls: string[] = []) {
    super();
    this.configureInterceptors();
  }

  /**
   * This method opens an auth connection
   */
  async connect(): Promise<void> {
    /**
     * Create a token used to cancel open requests on disconnect.
     */
    this.requestToken = axios.CancelToken.source();

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
     * Cancel open requests
     */
    if (this.requestToken) {
      this.requestToken.cancel();
    }

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
    const { data } = await this.axiosInstance.post<JwtToken>(`${this.config.authUrl}/auth`, {
      billingId: this.config.billingId,
      clientId: this.config.clientId,
      clientSecret: this.config.secret,
    });
    /**
     * Optional: Emit an event
     */
    this.emit("authenticate");
    return data;
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
          /**
           * Cancelled requests are not emitted as errors
           */
          if (axios.isCancel(error)) {
            return;
          }

          const statusCode = (error as AxiosError).response?.status;
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
    const { data } = await this.axiosInstance.post<JwtToken>(
      `${this.config.authUrl}/refresh`,
      oldToken
    );
    return data;
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

  /**
   * The client's axios instance will intercept requests and conditionally enrich request configs.
   */
  private configureInterceptors(): void {
    this.axiosInstance.interceptors.request.use(this.addTokenToApiRequest.bind(this));
    this.axiosInstance.interceptors.request.use(this.addCancelTokenToRequest.bind(this));
  }

  /**
   * Adds the Authorization header to API endpoint(s) requests.
   */
  private addTokenToApiRequest(request: AxiosRequestConfig): AxiosRequestConfig {
    if (
      this.token !== undefined &&
      this.apiUrls.some((apiUrl) => request.url && request.url.startsWith(apiUrl))
    ) {
      request.headers = {
        ...request.headers,
        ...this.getBearerHeader(),
      };
    }
    return request;
  }

  /**
   * Adds the Axios cancel token to each request.
   */
  private addCancelTokenToRequest(request: AxiosRequestConfig): AxiosRequestConfig {
    request.cancelToken = this.requestToken ? this.requestToken.token : undefined;
    return request;
  }
}
