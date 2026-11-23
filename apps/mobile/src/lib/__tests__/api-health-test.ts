import { checkApiHealth } from '../api-health';

function respond(status: number, body: unknown): typeof fetch {
  return jest.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

const GOOD_BODY = { status: 'ok', service: 'bdgtr-api', time: '2026-11-23T05:00:00.000Z' };

describe('checkApiHealth', () => {
  it('reports connected for a valid health response', async () => {
    const fetchImpl = respond(200, GOOD_BODY);
    await expect(checkApiHealth('https://api.test', fetchImpl)).resolves.toBe('connected');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.test/health', expect.anything());
  });

  it('reports unreachable when the network fails', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(checkApiHealth('https://api.test', fetchImpl)).resolves.toBe('unreachable');
  });

  it.each([
    ['a server error', respond(500, { error: 'internal_error' })],
    ['a 404', respond(404, { error: 'not_found' })],
    ['a non-JSON body', respond(200, '<html>captive portal</html>')],
    ['a wrong shape', respond(200, { status: 'ok' })],
  ])('reports unexpected_response for %s', async (_label, fetchImpl) => {
    await expect(checkApiHealth('https://api.test', fetchImpl)).resolves.toBe(
      'unexpected_response',
    );
  });

  it('times out instead of hanging forever', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    await expect(checkApiHealth('https://api.test', fetchImpl, 10)).resolves.toBe('unreachable');
  });
});
