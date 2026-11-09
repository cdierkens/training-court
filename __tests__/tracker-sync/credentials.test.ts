/** @jest-environment node */

const mockAdmin: { current: unknown } = { current: null };

jest.mock('../../utils/supabase/admin', () => ({
  createAdminClient: () => mockAdmin.current,
}));

const {
  mintTrackerCredential,
  revokeTrackerCredential,
  rotateTrackerCredential,
  listTrackerCredentials,
  updateTrackerCredentialFormat,
} = require('../../lib/server/tracker-credentials') as typeof import('../../lib/server/tracker-credentials');

const row = {
  id: 'cred-1',
  label: 'Laptop',
  default_format: 'TEF-DLR',
  token_hint: 'abcd',
  created_at: '2026-11-01T00:00:00.000Z',
  last_used_at: null,
};

afterEach(() => {
  mockAdmin.current = null;
});

describe('tracker credential lifecycle', () => {
  it('rejects an empty or over-long label without touching the database', async () => {
    mockAdmin.current = new Proxy({}, { get: () => { throw new Error('should not query'); } });

    expect(await mintTrackerCredential({ userId: 'u', label: '  ', defaultFormat: 'TEF-DLR' }))
      .toMatchObject({ ok: false, code: 'invalid_label' });
    expect(await mintTrackerCredential({ userId: 'u', label: 'x'.repeat(65), defaultFormat: 'TEF-DLR' }))
      .toMatchObject({ ok: false, code: 'invalid_label' });
  });

  it('rejects a format the site cannot render', async () => {
    mockAdmin.current = new Proxy({}, { get: () => { throw new Error('should not query'); } });

    expect(await mintTrackerCredential({ userId: 'u', label: 'Laptop', defaultFormat: 'NOPE' }))
      .toMatchObject({ ok: false, code: 'invalid_format' });
  });

  it('maps the database cap trigger to limit_reached', async () => {
    mockAdmin.current = {
      from: () => ({
        insert: async () => ({ error: { message: 'tracker_credential_limit' } }),
      }),
    };

    expect(await mintTrackerCredential({ userId: 'u', label: 'Laptop', defaultFormat: 'TEF-DLR' }))
      .toMatchObject({ ok: false, code: 'limit_reached' });
  });

  it('mints a tct_ token without returning the row', async () => {
    mockAdmin.current = {
      from: () => ({ insert: async () => ({ error: null }) }),
    };

    const result = await mintTrackerCredential({ userId: 'u', label: 'Laptop', defaultFormat: 'TEF-DLR' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toMatch(/^tct_[A-Za-z0-9_-]{43}$/);
  });

  it('distinguishes an unreadable list from an empty one', async () => {
    mockAdmin.current = {
      from: () => ({
        select: () => ({
          eq: () => ({ is: () => ({ order: async () => ({ data: null, error: { message: 'relation does not exist' } }) }) }),
        }),
      }),
    };

    expect(await listTrackerCredentials('u')).toMatchObject({ ok: false });
  });

  it('returns the token list when the read succeeds', async () => {
    mockAdmin.current = {
      from: () => ({
        select: () => ({
          eq: () => ({ is: () => ({ order: async () => ({ data: [row], error: null }) }) }),
        }),
      }),
    };

    const result = await listTrackerCredentials('u');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.credentials).toHaveLength(1);
    expect(result.credentials[0].label).toBe('Laptop');
  });

  it('revokes an active token and reports an already-revoked one as not_found', async () => {
    mockAdmin.current = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                select: () => ({ maybeSingle: async () => ({ data: { id: 'cred-1' }, error: null }) }),
              }),
            }),
          }),
        }),
      }),
    };

    expect(await revokeTrackerCredential({ userId: 'u', credentialId: 'cred-1' })).toEqual({ ok: true });

    mockAdmin.current = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              }),
            }),
          }),
        }),
      }),
    };

    expect(await revokeTrackerCredential({ userId: 'u', credentialId: 'cred-1' }))
      .toMatchObject({ ok: false, code: 'not_found' });
  });

  it('rejects an unknown format when editing a token', async () => {
    mockAdmin.current = new Proxy({}, { get: () => { throw new Error('should not query'); } });

    expect(
      await updateTrackerCredentialFormat({ userId: 'u', credentialId: 'cred-1', defaultFormat: 'NOPE' })
    ).toMatchObject({ ok: false, code: 'invalid_format' });
  });

  it('reports a missing token when editing its format', async () => {
    mockAdmin.current = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              }),
            }),
          }),
        }),
      }),
    };

    expect(
      await updateTrackerCredentialFormat({ userId: 'u', credentialId: 'cred-1', defaultFormat: 'TEF-DLR' })
    ).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('updates the default format of an active token', async () => {
    mockAdmin.current = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                select: () => ({ maybeSingle: async () => ({ data: { id: 'cred-1' }, error: null }) }),
              }),
            }),
          }),
        }),
      }),
    };

    expect(
      await updateTrackerCredentialFormat({ userId: 'u', credentialId: 'cred-1', defaultFormat: 'SVI-MEG' })
    ).toEqual({ ok: true });
  });

  it('does not rotate a token that is not active', async () => {
    mockAdmin.current = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
        }),
      }),
    };

    expect(await rotateTrackerCredential({ userId: 'u', credentialId: 'cred-1' }))
      .toMatchObject({ ok: false, code: 'not_found' });
  });

  it('rotates by revoking the old row and inserting a new one', async () => {
    const revoked: unknown[] = [];

    mockAdmin.current = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: { id: 'cred-1', label: 'Laptop', default_format: 'TEF-DLR' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        update: (patch: unknown) => {
          revoked.push(patch);
          return {
            eq: () => ({
              eq: () => ({
                is: () => ({
                  select: () => ({
                    maybeSingle: async () => ({ data: { id: 'cred-1' }, error: null }),
                  }),
                }),
              }),
            }),
          };
        },
        insert: async () => ({ error: null }),
      }),
    };

    const result = await rotateTrackerCredential({ userId: 'u', credentialId: 'cred-1' });

    expect(result.ok).toBe(true);
    expect(revoked[0]).toHaveProperty('revoked_at');
  });
});
