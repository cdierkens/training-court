'use server';

import { revalidatePath } from 'next/cache';
import { fetchCurrentUser } from '@/components/auth.utils';
import { fetchUserData } from '@/components/user-data.utils';
import {
  mintTrackerCredential,
  revokeTrackerCredential,
  rotateTrackerCredential,
  updateTrackerCredentialFormat,
  type TrackerCredentialFailureCode,
} from '@/lib/server/tracker-credentials';

/** Lib failures plus the two states only this layer can detect. */
export type TrackerActionFailureCode =
  | TrackerCredentialFailureCode
  | 'session_expired'
  | 'screen_name_missing';

export type TrackerActionResult =
  | { ok: true; token: string }
  | { ok: false; code: TrackerActionFailureCode };

export type TrackerActionCompletion =
  | { ok: true }
  | { ok: false; code: TrackerActionFailureCode };

/**
 * Mints a token from the player's cookie session. The token is returned once
 * and never stored in plaintext. Failures are codes: the client chooses and
 * translates the copy.
 */
export async function createTrackerCredential(input: {
  label: string;
  defaultFormat: string;
}): Promise<TrackerActionResult> {
  try {
    const user = await fetchCurrentUser();
    if (!user) return { ok: false, code: 'session_expired' };

    const userData = await fetchUserData(user.id);
    if (!userData?.live_screen_name) {
      return { ok: false, code: 'screen_name_missing' };
    }

    const result = await mintTrackerCredential({
      userId: user.id,
      label: input.label,
      defaultFormat: input.defaultFormat,
    });

    if (!result.ok) return { ok: false, code: result.code };

    revalidatePath('/preferences');
    return { ok: true, token: result.token };
  } catch (error) {
    console.error('Could not create tracker credential:', error);
    return { ok: false, code: 'unavailable' };
  }
}

/** New token, same label and format. The old token stops working. */
export async function replaceTrackerToken(credentialId: string): Promise<TrackerActionResult> {
  try {
    const user = await fetchCurrentUser();
    if (!user) return { ok: false, code: 'session_expired' };

    const result = await rotateTrackerCredential({ userId: user.id, credentialId });
    if (!result.ok) return { ok: false, code: result.code };

    revalidatePath('/preferences');
    return { ok: true, token: result.token };
  } catch (error) {
    console.error('Could not replace tracker token:', error);
    return { ok: false, code: 'unavailable' };
  }
}

/**
 * Revoking only pauses the tracker: its next delivery gets a 401 and it asks
 * for a new token. The row stays for provenance on logs it already sent.
 */
export async function revokeTrackerCredentialAction(
  credentialId: string
): Promise<TrackerActionCompletion> {
  try {
    const user = await fetchCurrentUser();
    if (!user) return { ok: false, code: 'session_expired' };

    const result = await revokeTrackerCredential({ userId: user.id, credentialId });
    if (!result.ok) return { ok: false, code: result.code };

    revalidatePath('/preferences');
    return { ok: true };
  } catch (error) {
    console.error('Could not revoke tracker credential:', error);
    return { ok: false, code: 'unavailable' };
  }
}

/** The default matters most when Send deck identity is off: it stamps every log. */
export async function updateTrackerCredentialFormatAction(
  credentialId: string,
  defaultFormat: string
): Promise<TrackerActionCompletion> {
  try {
    const user = await fetchCurrentUser();
    if (!user) return { ok: false, code: 'session_expired' };

    const result = await updateTrackerCredentialFormat({
      userId: user.id,
      credentialId,
      defaultFormat,
    });
    if (!result.ok) return { ok: false, code: result.code };

    revalidatePath('/preferences');
    return { ok: true };
  } catch (error) {
    console.error('Could not update tracker credential format:', error);
    return { ok: false, code: 'unavailable' };
  }
}
