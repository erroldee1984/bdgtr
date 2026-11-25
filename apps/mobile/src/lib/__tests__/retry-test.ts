import { z } from 'zod';

import { describeAccountError } from '../../components/account-status';
import { ApiError } from '../api-error';
import { isRetryableNetworkError, withNetworkRetry } from '../retry';

jest.mock('@clerk/expo', () => ({ useAuth: () => ({ getToken: async () => 'tok' }) }));

const noSleep = jest.fn(async (_ms: number) => {});

beforeEach(() => noSleep.mockClear());

describe('withNetworkRetry', () => {
  it('returns at once when the first attempt succeeds', async () => {
    const fn = jest.fn(async () => 'ok');
    await expect(withNetworkRetry(fn, { sleep: noSleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('retries network failures with the given delays, then succeeds', async () => {
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValue('ok');
    await expect(withNetworkRetry(fn, { delaysMs: [10, 20, 40], sleep: noSleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(noSleep.mock.calls.map((c) => c[0])).toEqual([10, 20]);
  });

  it('gives up after the last delay and rethrows the network error', async () => {
    const err = new TypeError('Network request failed');
    const fn = jest.fn(async () => {
      throw err;
    });
    await expect(withNetworkRetry(fn, { delaysMs: [1, 1], sleep: noSleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['an HTTP error from the server', new ApiError(401, 'unauthorized')],
    ['a 500', new ApiError(500, 'internal_error')],
    ['a malformed response', new SyntaxError('Unexpected token')],
  ])('does NOT retry %s', async (_label, err) => {
    const fn = jest.fn(async () => {
      throw err;
    });
    await expect(withNetworkRetry(fn, { sleep: noSleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry a response that fails schema validation', async () => {
    const zodError = z.object({ a: z.string() }).safeParse({}).error;
    expect(isRetryableNetworkError(zodError)).toBe(false);
  });
});

describe('describeAccountError', () => {
  it.each([
    [new ApiError(401, 'unauthorized'), 'The server did not accept your sign-in.', '401 unauthorized'],
    [new ApiError(503, 'auth_not_configured'), 'The server is not set up for sign-in yet.', '503 auth_not_configured'],
    [new ApiError(500, 'internal_error'), "Couldn't load your account.", '500 internal_error'],
    [new TypeError('Network request failed'), "Couldn't reach the server to load your account.", 'network'],
  ])('%s → friendly message and short reason', (err, message, detail) => {
    expect(describeAccountError(err)).toEqual({ message, detail });
  });
});
