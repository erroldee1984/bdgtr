import { ApiError, apiFetch, fetchMe } from '../api';
import { API_URL } from '../config';

jest.mock('@clerk/expo', () => ({ useAuth: () => ({ getToken: async () => 'tok' }) }));

function respond(status: number, body: unknown): jest.Mock {
  return jest.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
}

const ME = { user: { id: 'u1', email: 'ana@example.com' }, memberships: [] };

describe('apiFetch', () => {
  it('sends the session token as a Bearer header to the configured API', async () => {
    const fetchImpl = respond(200, { ok: true });
    await expect(apiFetch('/me', async () => 'jwt-123', {}, fetchImpl)).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${API_URL}/me`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer jwt-123' }) }),
    );
  });

  it('keeps caller headers alongside the token', async () => {
    const fetchImpl = respond(200, {});
    await apiFetch('/x', async () => 't', { headers: { 'X-Household-Id': 'h1' } }, fetchImpl);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ 'X-Household-Id': 'h1', Authorization: 'Bearer t' });
  });

  it('does not call the API at all when signed out', async () => {
    const fetchImpl = respond(200, {});
    await expect(apiFetch('/me', async () => null, {}, fetchImpl)).rejects.toMatchObject({
      status: 401,
      code: 'not_signed_in',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, { error: 'unauthorized' }, 'unauthorized'],
    [503, { error: 'auth_not_configured' }, 'auth_not_configured'],
    [500, '<html>oops</html>', 'request_failed'],
  ])('maps HTTP %i to an ApiError with code %s', async (status, body, code) => {
    const err = await apiFetch('/me', async () => 't', {}, respond(status, body)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status, code });
  });
});

describe('fetchMe', () => {
  it('returns a validated /me response', async () => {
    await expect(fetchMe(async () => 't', respond(200, ME))).resolves.toEqual(ME);
  });

  it('rejects a response that does not match the contract', async () => {
    await expect(fetchMe(async () => 't', respond(200, { user: { id: 'u1' } }))).rejects.toThrow();
  });
});
