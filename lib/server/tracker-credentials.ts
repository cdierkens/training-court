import { isLogFormat } from '@/components/tournaments/Format/tournament-format.types';
import { hashTrackerToken, mintTrackerToken } from '@/lib/tracker-sync/token';
import {
  MAX_TRACKER_CREDENTIALS,
  TRACKER_REQUESTS_PER_HOUR,
} from '@/lib/tracker-sync/limits';
import { createAdminClient } from '@/utils/supabase/admin';


const MAX_LABEL_LENGTH = 64;

type TrackerCredentialRow = {
  id: string;
  label: string;
  default_format: string;
  token_hint: string;
  created_at: string;
  last_used_at: string | null;
};

export type TrackerCredentialSummary = {
  id: string;
  label: string;
  defaultFormat: string;
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type TrackerCredentialClaim =
  | {
      status: 'ok';
      credential: { id: string; userId: string; label: string; defaultFormat: string };
    }
  | { status: 'invalid_token' }
  | { status: 'rate_limited' }
  | { status: 'error' };

export type TrackerCredentialFailureCode =
  | 'invalid_label'
  | 'invalid_format'
  | 'limit_reached'
  | 'not_found'
  | 'unavailable';

export type TrackerCredentialFailure = {
  ok: false;
  code: TrackerCredentialFailureCode;
  /** Server-side detail; user-facing copy is chosen by the client per code. */
  message: string;
};

type MintResult =
  | { ok: true; token: string }
  | TrackerCredentialFailure;

export type TrackerCredentialsResult =
  | { ok: true; credentials: TrackerCredentialSummary[] }
  | { ok: false };

const toSummary = (row: TrackerCredentialRow): TrackerCredentialSummary => ({
  id: row.id,
  label: row.label,
  defaultFormat: row.default_format,
  tokenHint: row.token_hint,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

const validLabel = (label: string) => {
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LABEL_LENGTH) return null;
  return trimmed;
};

export async function listTrackerCredentials(
  userId: string
): Promise<TrackerCredentialsResult> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('tracker_credentials')
      .select('id, label, default_format, token_hint, created_at, last_used_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      // An unapplied migration or missing grant must not read as "no tokens".
      console.error('Could not list tracker credentials:', error.message);
      return { ok: false };
    }

    return {
      ok: true,
      credentials: ((data ?? []) as TrackerCredentialRow[]).map(toSummary),
    };
  } catch (error) {
    // A missing service-role key throws here; Preferences must still render.
    console.error('Could not read tracker credentials:', error);
    return { ok: false };
  }
}

export async function mintTrackerCredential(input: {
  userId: string;
  label: string;
  defaultFormat: string;
}): Promise<MintResult> {
  const label = validLabel(input.label);
  if (!label) {
    return { ok: false, code: 'invalid_label', message: 'Give the token a name of 1–64 characters.' };
  }
  if (!isLogFormat(input.defaultFormat)) {
    return { ok: false, code: 'invalid_format', message: 'Choose a format for this token.' };
  }

  const minted = mintTrackerToken();
  const supabase = createAdminClient();
  const { error } = await supabase.from('tracker_credentials').insert({
    user_id: input.userId,
    label,
    default_format: input.defaultFormat,
    token_hash: minted.hash,
    token_hint: minted.hint,
  });

  if (error) {
    console.error('Could not create tracker credential:', error.message);
    const capped = `${error?.message ?? ''}`.includes('tracker_credential_limit');
    return capped
      ? {
          ok: false,
          code: 'limit_reached',
          message: `You can have up to ${MAX_TRACKER_CREDENTIALS} tokens. Revoke one first.`,
        }
      : { ok: false, code: 'unavailable', message: 'Could not create the token. Try again.' };
  }

  return { ok: true, token: minted.token };
}

/**
 * Issues a replacement token. A row is one issued token, so this creates a new
 * row with the same label and format and revokes the old one; logs keep
 * pointing at the row that actually delivered them.
 */
export async function rotateTrackerCredential(input: {
  userId: string;
  credentialId: string;
}): Promise<MintResult> {
  const supabase = createAdminClient();
  const { data: previous, error: readError } = await supabase
    .from('tracker_credentials')
    .select('id, label, default_format')
    .eq('id', input.credentialId)
    .eq('user_id', input.userId)
    .is('revoked_at', null)
    .maybeSingle();

  if (readError) {
    console.error('Could not read tracker credential:', readError.message);
    return { ok: false, code: 'unavailable', message: 'Could not replace the token. Try again.' };
  }

  if (!previous) {
    return { ok: false, code: 'not_found', message: 'That token is no longer active.' };
  }

  // Revoke before inserting so the database cap counts the freed slot. The
  // timestamp scopes the rollback to this attempt.
  const revokedAt = new Date().toISOString();
  const { data: revoked, error: revokeError } = await supabase
    .from('tracker_credentials')
    .update({ revoked_at: revokedAt })
    .eq('id', input.credentialId)
    .eq('user_id', input.userId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (revokeError) {
    console.error('Could not revoke the replaced token:', revokeError.message);
    return { ok: false, code: 'unavailable', message: 'Could not replace the token. Try again.' };
  }

  if (!revoked) {
    return { ok: false, code: 'not_found', message: 'That token is no longer active.' };
  }

  const minted = mintTrackerToken();
  const { error } = await supabase.from('tracker_credentials').insert({
    user_id: input.userId,
    label: previous.label,
    default_format: previous.default_format,
    token_hash: minted.hash,
    token_hint: minted.hint,
  });

  if (error) {
    console.error('Could not replace the token:', error.message);
    await supabase
      .from('tracker_credentials')
      .update({ revoked_at: null })
      .eq('id', input.credentialId)
      .eq('user_id', input.userId)
      .eq('revoked_at', revokedAt);
    return { ok: false, code: 'unavailable', message: 'Could not replace the token. Try again.' };
  }

  return { ok: true, token: minted.token };
}

/**
 * Changes the format new deliveries fall back to. Kept separate from rotating
 * because the default matters most when Send deck identity is off: it stamps
 * every log the tracker sends.
 */
export async function updateTrackerCredentialFormat(input: {
  userId: string;
  credentialId: string;
  defaultFormat: string;
}): Promise<{ ok: true } | TrackerCredentialFailure> {
  if (!isLogFormat(input.defaultFormat)) {
    return { ok: false, code: 'invalid_format', message: 'Choose a format for this token.' };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('tracker_credentials')
    .update({ default_format: input.defaultFormat })
    .eq('id', input.credentialId)
    .eq('user_id', input.userId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Could not update tracker credential format:', error.message);
    return { ok: false, code: 'unavailable', message: 'Could not update the format. Try again.' };
  }

  if (!data) {
    return { ok: false, code: 'not_found', message: 'That token is no longer active.' };
  }

  return { ok: true };
}

/** Revoked rows are kept so provenance on old logs survives. */
export async function revokeTrackerCredential(input: {
  userId: string;
  credentialId: string;
}): Promise<{ ok: true } | TrackerCredentialFailure> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('tracker_credentials')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', input.credentialId)
    .eq('user_id', input.userId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Could not revoke tracker credential:', error.message);
    return { ok: false, code: 'unavailable', message: 'Could not revoke the token. Try again.' };
  }

  if (!data) {
    return { ok: false, code: 'not_found', message: 'That token is no longer active.' };
  }

  return { ok: true };
}

/** Stamped only after a delivery is accepted, so "last sync" means a sync. */
export async function touchTrackerCredential(credentialId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('tracker_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', credentialId);

  if (error) console.error('Could not stamp tracker credential:', error.message);
}

/**
 * Authenticates a delivery. The RPC does lookup, revocation and the fixed rate
 * window in one locked statement.
 */
export async function claimTrackerCredential(token: string): Promise<TrackerCredentialClaim> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('claim_tracker_credential_request', {
    p_token_hash: hashTrackerToken(token),
    p_limit: TRACKER_REQUESTS_PER_HOUR,
  });

  if (error) {
    console.error('Could not claim tracker credential request:', error.message);
    return { status: 'error' };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { status: 'invalid_token' };
  if (!row.allowed) return { status: 'rate_limited' };

  return {
    status: 'ok',
    credential: {
      id: row.credential_id,
      userId: row.user_id,
      label: row.label,
      defaultFormat: row.default_format,
    },
  };
}
