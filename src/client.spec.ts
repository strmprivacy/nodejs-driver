import { Client, ClientConfig, HTTP_STATUS_CODE, JwtToken } from "./client";
import axios, { AxiosInstance } from "axios";

type Mock<T> = Partial<Record<keyof T, jest.SpyInstance>>;

describe("Client", () => {
  class TestClient extends Client {
    constructor(config: ClientConfig) {
      super(config);
    }
  }

  const MOCK_CONFIG: ClientConfig = {
    secret: "secret",
    clientId: "clientId",
    billingId: "billingId",
    authUrl: "authUrl",
    topic: "topic",
  };

  const NOW_IN_MS = new Date("Tue Dec 02 2020 22:09:40 GMT+0100").getTime();

  const MOCK_TOKEN: JwtToken = {
    expiresAt: NOW_IN_MS / 1000 + 60 * 60,
    idToken: "idToken",
    refreshToken: "refreshToken",
  };

  const TIME_BEFORE_TOKEN_EXPIRES = MOCK_TOKEN.expiresAt * 1000 - NOW_IN_MS;

  let client: Client;

  let axiosInstance: Omit<Mock<AxiosInstance>, "interceptors"> &
    Record<"interceptors", { request: { use: jest.SpyInstance } }>;

  beforeEach(() => {
    jest.useFakeTimers("modern");
    jest.setSystemTime(NOW_IN_MS);

    axiosInstance = {
      post: jest.fn(),
      interceptors: {
        request: {
          use: jest.fn(),
        },
      },
    };

    jest.spyOn(axios, "create").mockReturnValue(axiosInstance as any);

    axiosInstance.post!.mockResolvedValue({
      data: MOCK_TOKEN,
    });

    client = new TestClient(MOCK_CONFIG);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * Workaround to test Promises in combination with setTimeout.
   */
  const tick = async (ms: number) => {
    jest.advanceTimersByTime(ms);
    return Promise.resolve();
  };

  describe("Connect", () => {
    it("should send an auth request on connect", async () => {
      await client.connect();

      expect(axiosInstance.post).toHaveBeenCalledTimes(1);
      expect(axiosInstance.post).toHaveBeenCalledWith(MOCK_CONFIG.authUrl + "/auth", {
        billingId: MOCK_CONFIG.billingId,
        clientId: MOCK_CONFIG.clientId,
        clientSecret: MOCK_CONFIG.secret,
      });
    });

    it("should store the token after a successful connect", async () => {
      await client.connect();
      expect(client["token"]).toBe(MOCK_TOKEN);
    });

    it("should throw if auth fails on connect", async () => {
      const ERROR = new Error();
      axiosInstance.post!.mockRejectedValue(ERROR);
      await expect(client.connect()).rejects.toEqual(ERROR);
    });

    it("should throw if the token is expired", async () => {
      axiosInstance.post!.mockResolvedValue({
        data: {
          ...MOCK_TOKEN,
          expiresAt: NOW_IN_MS / 1000,
        },
      });

      await expect(client.connect()).rejects.toEqual(new Error("Token expired"));
    });
  });

  describe("Refreshing token", () => {
    const TIME_BEFORE_REFRESH_ATTEMPT =
      TIME_BEFORE_TOKEN_EXPIRES - Client.SEC_BEFORE_EXPIRATION * 1000;

    async function flushFirstRefreshAttempt() {
      await tick(TIME_BEFORE_REFRESH_ATTEMPT); // Trigger call (timeout)
      await tick(0); // Trigger resolve/reject
    }

    async function flushRetryAttempts() {
      for (let i = 0; i < Client.FAILED_REQUEST_RETRY_ATTEMPTS; i++) {
        await tick(0); // Trigger call (timeout)
        await tick(0); // Trigger resolve/reject
      }
    }

    async function flushAllRefreshAttempts() {
      await flushFirstRefreshAttempt();
      await flushRetryAttempts();
    }

    it(`should refresh the token ${Client.SEC_BEFORE_EXPIRATION}sec before it expires`, async () => {
      await client.connect();

      axiosInstance.post!.mockClear();

      await tick(TIME_BEFORE_REFRESH_ATTEMPT - 1);

      expect(axiosInstance.post).not.toHaveBeenCalled();

      await tick(1);

      expect(axiosInstance.post).toHaveBeenCalledWith(MOCK_CONFIG.authUrl + "/refresh", MOCK_TOKEN);
    });

    it(`should retry ${Client.FAILED_REQUEST_RETRY_ATTEMPTS} times if refresh keeps failing`, async () => {
      client.on("error", () => {});
      await client.connect();

      axiosInstance.post!.mockRejectedValue(new Error());

      await flushFirstRefreshAttempt();
      axiosInstance.post!.mockClear();

      await flushRetryAttempts();

      expect(jest.getTimerCount()).toBe(0); // No more scheduled refresh attempts
      expect(axiosInstance.post).toHaveBeenCalledTimes(Client.FAILED_REQUEST_RETRY_ATTEMPTS);
    });

    it("should emit an error if all retry attempts fail", async () => {
      const errorSpy = jest.fn();
      const ERROR = new Error();

      client.on("error", errorSpy);

      await client.connect();

      axiosInstance.post!.mockRejectedValue(ERROR);

      await flushAllRefreshAttempts();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(ERROR);
    });

    it("should disconnect if all retry attempts fail", async () => {
      const disconnectSpy = jest.fn();
      const ERROR = new Error();

      client.on("disconnect", disconnectSpy);
      /**
       * Error will break Node if there's no handler registered.
       */
      client.on("error", () => {});

      await client.connect();

      axiosInstance.post!.mockRejectedValue(ERROR);

      await flushAllRefreshAttempts();

      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledWith();
    });

    it("should not retry if the server responds with unauthorized", async () => {
      client.on("error", () => {});

      await client.connect();

      axiosInstance.post!.mockRejectedValue({
        response: {
          status: HTTP_STATUS_CODE.UNAUTHORIZED,
        },
      });

      await flushFirstRefreshAttempt();

      axiosInstance.post!.mockClear();

      await flushRetryAttempts();

      expect(axiosInstance.post).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it("should not retry if the server responds with bad request", async () => {
      client.on("error", () => {});

      await client.connect();

      axiosInstance.post!.mockRejectedValue({
        response: {
          status: HTTP_STATUS_CODE.BAD_REQUEST,
        },
      });

      await flushFirstRefreshAttempt();

      axiosInstance.post!.mockClear();

      await flushRetryAttempts();

      expect(axiosInstance.post).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("Disconnect", () => {
    beforeEach(async () => {
      await client.connect();
    });

    it("should clear scheduled refresh", () => {
      expect(jest.getTimerCount()).toBe(1);
      client.disconnect();
      expect(jest.getTimerCount()).toBe(0);
    });

    it("should emit disconnect event", () => {
      const spy = jest.fn();
      client.on("disconnect", spy);
      client.disconnect();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
