/** @jest-environment node */

const mockFetchCurrentUser = jest.fn();
const mockFetchUserData = jest.fn();
const mockMint = jest.fn();
const mockRotate = jest.fn();
const mockRevoke = jest.fn();
const mockUpdateFormat = jest.fn();

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('../../components/auth.utils', () => ({
  fetchCurrentUser: () => mockFetchCurrentUser(),
}));
jest.mock('../../components/user-data.utils', () => ({
  fetchUserData: (...args: unknown[]) => mockFetchUserData(...args),
}));
jest.mock('../../lib/server/tracker-credentials', () => ({
  mintTrackerCredential: (...args: unknown[]) => mockMint(...args),
  rotateTrackerCredential: (...args: unknown[]) => mockRotate(...args),
  revokeTrackerCredential: (...args: unknown[]) => mockRevoke(...args),
  updateTrackerCredentialFormat: (...args: unknown[]) => mockUpdateFormat(...args),
}));

const {
  createTrackerCredential,
  replaceTrackerToken,
  revokeTrackerCredentialAction,
} = require('../../app/preferences/tracker-credential-actions') as typeof import('../../app/preferences/tracker-credential-actions');

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchCurrentUser.mockResolvedValue({ id: 'user-1' });
  mockFetchUserData.mockResolvedValue({ live_screen_name: 'Ash' });
  mockMint.mockResolvedValue({ ok: true, token: 'tct_token' });
});

describe('tracker credential actions', () => {
  it('refuses to create without a session', async () => {
    mockFetchCurrentUser.mockResolvedValue(null);

    expect(await createTrackerCredential({ label: 'Laptop', defaultFormat: 'TEF-DLR' }))
      .toEqual({ ok: false, code: 'session_expired' });
    expect(mockMint).not.toHaveBeenCalled();
  });

  it('refuses to create without a screen name', async () => {
    mockFetchUserData.mockResolvedValue({ live_screen_name: null });

    expect(await createTrackerCredential({ label: 'Laptop', defaultFormat: 'TEF-DLR' }))
      .toEqual({ ok: false, code: 'screen_name_missing' });
    expect(mockMint).not.toHaveBeenCalled();
  });

  it('passes lib failures through as codes', async () => {
    mockMint.mockResolvedValue({ ok: false, code: 'invalid_label', message: 'server detail' });

    expect(await createTrackerCredential({ label: '', defaultFormat: 'TEF-DLR' }))
      .toEqual({ ok: false, code: 'invalid_label' });
  });

  it('returns the token once on success', async () => {
    expect(await createTrackerCredential({ label: 'Laptop', defaultFormat: 'TEF-DLR' }))
      .toEqual({ ok: true, token: 'tct_token' });
  });

  it('reports a lost token when replacing', async () => {
    mockRotate.mockResolvedValue({ ok: false, code: 'not_found', message: 'gone' });

    expect(await replaceTrackerToken('cred-1')).toEqual({ ok: false, code: 'not_found' });
  });

  it('reports the revoke result', async () => {
    mockRevoke.mockResolvedValue({ ok: true });
    expect(await revokeTrackerCredentialAction('cred-1')).toEqual({ ok: true });

    mockRevoke.mockResolvedValue({ ok: false, code: 'not_found', message: 'gone' });
    expect(await revokeTrackerCredentialAction('cred-1')).toEqual({ ok: false, code: 'not_found' });
  });
});
