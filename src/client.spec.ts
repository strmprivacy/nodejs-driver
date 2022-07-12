import { Client, ClientConfig, HTTP_STATUS_CODE, JwtToken } from './client';
import * as http from './http';
import { Http2Response } from './http';

/**
 * @TODO: Fix unit tests
 */

describe('Auth', () => {
  class TestClient extends Client {
    constructor(config: ClientConfig) {
      super(config);
    }
  }
  const MOCK_CONFIG: ClientConfig = {
    clientSecret: 'clientSecret',
    clientId: 'clientId',
    authScheme: 'https',
    authHost: 'accounts.dev.strmprivacy.io',
    authEndpoint: '/auth/realms/streams/protocol/openid-connect/token',
  };

  let client: Client;

  beforeEach(() => {
    client = new TestClient(MOCK_CONFIG);
  });

  describe('Auth', () => {
    it('should be able to receive an access token', async () => {
      await client.connect();
      expect(client.getAccessToken()).not.toBeNull();
    });
  });

  describe('Refresh', () => {
    it('should be able to use refresh token', async () => {
      await client.connect();
      let token = client.getToken();
      await client.refresh(token!);
      expect(client.getToken()!.refresh_token).not.toBeNull();
    });
  });
});

describe('Client', () => {
  class TestClient extends Client {
    constructor(config: ClientConfig) {
      super(config);
    }
  }

  const MOCK_CONFIG: ClientConfig = {
    clientSecret: 'secret',
    clientId: 'clientId',
    authScheme: 'https',
    authHost: 'accounts.dev.strmprivacy.io',
    authEndpoint: '/auth/realms/streams/protocol/openid-connect/token',
  };

  const NOW_IN_MS = new Date('Tue Dec 02 2020 22:09:40 GMT+0100').getTime();

  const MOCK_TOKEN: JwtToken = {
    access_token: 'idToken',
    refresh_token: 'refreshToken',
    expires_in: 60,
    expires_at: NOW_IN_MS + 60,
  };

  const MOCK_AUTH_RESPONSE: Http2Response<JwtToken> = { status: 200, data: MOCK_TOKEN };

  const TIME_BEFORE_TOKEN_EXPIRES = MOCK_TOKEN.expires_at * 1000 - NOW_IN_MS;

  let client: Client;
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(NOW_IN_MS);

    postSpy = jest.spyOn(http, 'post');
    postSpy.mockResolvedValue(MOCK_AUTH_RESPONSE);

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

  describe('Connect', () => {
    it('should send an auth request on connect', async () => {
      await client.connect();

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledWith(
        'https://accounts.dev.strmprivacy.io',
        '/auth/realms/streams/protocol/openid-connect/token',
        'grant_type=client_credentials&client_id=clientId&client_secret=secret',
        { 'content-type': 'application/x-www-form-urlencoded' }
      );
    });

    it('should store the token after a successful connect', async () => {
      await client.connect();
      expect(client['token']).toBe(MOCK_TOKEN);
    });

    it('should throw if auth fails on connect', async () => {
      const ERROR = new Error();
      postSpy.mockRejectedValue(ERROR);
      await expect(client.connect()).rejects.toEqual(ERROR);
    });

    it('should throw if the token is expired', async () => {
      postSpy.mockResolvedValue({
        data: {
          ...MOCK_TOKEN,
          expires_at: NOW_IN_MS / 1000,
        },
      });

      await expect(client.connect()).rejects.toEqual(new Error('Token expired'));
    });
  });

  describe('Refreshing token', () => {
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

      postSpy.mockClear();

      await tick(TIME_BEFORE_REFRESH_ATTEMPT - 1);

      await tick(1);

      expect(postSpy).toHaveBeenCalledWith(
        'https://accounts.dev.strmprivacy.io',
        '/auth/realms/streams/protocol/openid-connect/token',
        `grant_type=refresh_token&client_id=${MOCK_CONFIG.clientId}&client_secret=${MOCK_CONFIG.clientSecret}&refresh_token=refreshToken`,
        {
          'content-type': 'application/x-www-form-urlencoded',
        }
      );
    });

    it(`should retry ${Client.FAILED_REQUEST_RETRY_ATTEMPTS} times if refresh keeps failing`, async () => {
      client.on('error', () => {});
      await client.connect();

      postSpy.mockRejectedValue(new Error());

      await flushFirstRefreshAttempt();
      postSpy.mockClear();

      await flushRetryAttempts();

      expect(jest.getTimerCount()).toBe(0); // No more scheduled refresh attempts
      expect(postSpy).toHaveBeenCalledTimes(Client.FAILED_REQUEST_RETRY_ATTEMPTS);
    });

    it('should emit an error if all retry attempts fail', async () => {
      const errorSpy = jest.fn();
      const ERROR = new Error();

      client.on('error', errorSpy);

      await client.connect();

      postSpy.mockRejectedValue(ERROR);

      await flushAllRefreshAttempts();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(ERROR);
    });

    it('should disconnect if all retry attempts fail', async () => {
      const disconnectSpy = jest.fn();
      const ERROR = new Error();

      client.on('disconnect', disconnectSpy);
      /**
       * Error will break Node if there's no handler registered.
       */
      client.on('error', () => {});

      await client.connect();

      postSpy.mockRejectedValue(ERROR);

      await flushAllRefreshAttempts();

      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledWith();
    });

    it('should not retry if the server responds with unauthorized', async () => {
      client.on('error', () => {});

      await client.connect();

      postSpy.mockRejectedValue({
        status: HTTP_STATUS_CODE.UNAUTHORIZED,
      });

      await flushFirstRefreshAttempt();

      postSpy.mockClear();

      await flushRetryAttempts();

      expect(postSpy).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('should not retry if the server responds with bad request', async () => {
      client.on('error', () => {});

      await client.connect();

      postSpy.mockRejectedValue({
        status: HTTP_STATUS_CODE.BAD_REQUEST,
      });

      await flushFirstRefreshAttempt();

      postSpy.mockClear();

      await flushRetryAttempts();

      expect(postSpy).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('Disconnect', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should clear scheduled refresh', () => {
      expect(jest.getTimerCount()).toBe(1);
      client.disconnect();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('should emit disconnect event', () => {
      const spy = jest.fn();
      client.on('disconnect', spy);
      client.disconnect();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
