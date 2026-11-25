import {
  acceptInvite,
  ApiError,
  apiFetch,
  changeMemberRole,
  createHousehold,
  createInvite,
  deleteHousehold,
  fetchHousehold,
  fetchInvites,
  fetchMe,
  fetchMembers,
  reissueInvite,
  removeMember,
  revokeInvite,
  transferOwnership,
  updateHousehold,
} from '../api';
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

describe('household calls', () => {
  const H = {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Dela Cruz',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    defaultMonthlyBudgetMinor: 4_000_000,
    role: 'owner',
  };
  const tok = async () => 't';
  let fetchSpy: jest.SpyInstance;
  const lastCall = () => {
    const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    return { url, init, headers: init.headers as Record<string, string> };
  };
  const serve = (status: number, body?: unknown) =>
    fetchSpy.mockImplementation(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('createHousehold POSTs the JSON body to /households (no household header)', async () => {
    serve(201, { household: H });
    await expect(createHousehold(tok, { name: 'Dela Cruz', defaultMonthlyBudgetMinor: 4_000_000 })).resolves.toEqual(H);
    const { url, init, headers } = lastCall();
    expect(url).toBe(`${API_URL}/households`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Dela Cruz', defaultMonthlyBudgetMinor: 4_000_000 });
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Household-Id']).toBeUndefined();
  });

  it('fetchHousehold names the household in X-Household-Id', async () => {
    serve(200, { household: H });
    await expect(fetchHousehold(tok, H.id)).resolves.toEqual(H);
    expect(lastCall().url).toBe(`${API_URL}/household`);
    expect(lastCall().headers).toMatchObject({ 'X-Household-Id': H.id, Authorization: 'Bearer t' });
  });

  it('updateHousehold PATCHes the changes for that household', async () => {
    serve(200, { household: { ...H, defaultMonthlyBudgetMinor: 1 } });
    await expect(updateHousehold(tok, H.id, { defaultMonthlyBudgetMinor: 1 })).resolves.toMatchObject({ defaultMonthlyBudgetMinor: 1 });
    const { init, headers } = lastCall();
    expect(init.method).toBe('PATCH');
    expect(headers).toMatchObject({ 'X-Household-Id': H.id, 'Content-Type': 'application/json', Authorization: 'Bearer t' });
    expect(JSON.parse(init.body as string)).toEqual({ defaultMonthlyBudgetMinor: 1 });
  });

  it('deleteHousehold sends DELETE and accepts the empty 204 answer', async () => {
    serve(204);
    await expect(deleteHousehold(tok, H.id)).resolves.toBeUndefined();
    expect(lastCall().init.method).toBe('DELETE');
    expect(lastCall().headers['X-Household-Id']).toBe(H.id);
  });

  it.each([
    ['limit reached', () => createHousehold(tok, { name: 'X', defaultMonthlyBudgetMinor: 1 }), 409, 'household_limit'],
    ['not a member', () => fetchHousehold(tok, H.id), 404, 'not_found'],
    ['role lacks permission', () => updateHousehold(tok, H.id, { name: 'X' }), 403, 'forbidden'],
    ['House Member deleting', () => deleteHousehold(tok, H.id), 403, 'forbidden'],
  ])('%s → ApiError %i %s', async (_label, run, status, code) => {
    serve(status, { error: code });
    await expect(run()).rejects.toMatchObject({ status, code });
  });

  it('rejects a household response that does not match the contract', async () => {
    serve(200, { household: { ...H, role: 'admin' } });
    await expect(fetchHousehold(tok, H.id)).rejects.toThrow();
  });

  it('never calls the API when signed out', async () => {
    serve(200, { household: H });
    await expect(fetchHousehold(async () => null, H.id)).rejects.toMatchObject({ status: 401 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('member and invite calls', () => {
  const HID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const UID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const IID = 'cccccccccccccccccccccccc';
  const TOKEN = 'x'.repeat(43);
  const INVITE = { id: IID, email: 'ben@example.com', role: 'member', expiresAt: '2026-12-02T02:00:00.000Z' };
  const tok = async () => 't';
  let fetchSpy: jest.SpyInstance;
  const last = () => {
    const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    return { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : undefined };
  };
  const serve = (status: number, body?: unknown) =>
    fetchSpy.mockImplementation(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it.each([
    ['fetchMembers', () => fetchMembers(tok, HID), 200, { members: [] }, 'GET', '/members', undefined],
    ['changeMemberRole', () => changeMemberRole(tok, HID, UID, 'co_owner'), 204, undefined, 'PATCH', `/members/${UID}`, { role: 'co_owner' }],
    ['removeMember', () => removeMember(tok, HID, UID), 204, undefined, 'DELETE', `/members/${UID}`, undefined],
    ['transferOwnership', () => transferOwnership(tok, HID, UID), 204, undefined, 'POST', '/members/transfer-ownership', { userId: UID }],
    ['fetchInvites', () => fetchInvites(tok, HID), 200, { invites: [INVITE] }, 'GET', '/invites', undefined],
    ['createInvite', () => createInvite(tok, HID, { email: 'ben@example.com', role: 'member' }), 201, { invite: INVITE, token: TOKEN }, 'POST', '/invites', { email: 'ben@example.com', role: 'member' }],
    ['reissueInvite', () => reissueInvite(tok, HID, IID), 201, { invite: INVITE, token: TOKEN }, 'POST', `/invites/${IID}/reissue`, undefined],
    ['revokeInvite', () => revokeInvite(tok, HID, IID), 204, undefined, 'DELETE', `/invites/${IID}`, undefined],
  ] as const)('%s → %s %s for that household', async (_name, run, status, response, method, path, body) => {
    serve(status, response);
    await run();
    expect(last()).toMatchObject({ url: `${API_URL}${path}`, method, body });
    expect(last().headers).toMatchObject({ 'X-Household-Id': HID, Authorization: 'Bearer t' });
  });

  it('acceptInvite posts the token with no household header (the invite names it)', async () => {
    serve(200, { householdId: HID, householdName: 'Dela Cruz', role: 'member' });
    await expect(acceptInvite(tok, TOKEN)).resolves.toEqual({ householdId: HID, householdName: 'Dela Cruz', role: 'member' });
    expect(last()).toMatchObject({ url: `${API_URL}/invites/accept`, method: 'POST', body: { token: TOKEN } });
    expect(last().headers['X-Household-Id']).toBeUndefined();
  });

  it('a path id is URL-encoded (no path tricks)', async () => {
    serve(204);
    await removeMember(tok, HID, '../household');
    expect(last().url).toBe(`${API_URL}/members/..%2Fhousehold`);
  });

  it.each([
    [403, 'email_mismatch'],
    [410, 'invite_expired'],
    [429, 'too_many_attempts'],
  ])('accept failure %i %s → ApiError with that code', async (status, code) => {
    serve(status, { error: code });
    await expect(acceptInvite(tok, TOKEN)).rejects.toMatchObject({ status, code });
  });

  it('rejects a created invite without a valid token (contract check)', async () => {
    serve(201, { invite: INVITE, token: 'short' });
    await expect(createInvite(tok, HID, { email: 'ben@example.com', role: 'member' })).rejects.toThrow();
  });
});
