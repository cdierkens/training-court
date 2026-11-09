import { fetchAvatarImages } from '@/components/avatar/avatar.server.utils';
import { fetchCurrentUser } from '@/components/auth.utils';
import { listTrackerCredentials, type TrackerCredentialsResult } from '@/lib/server/tracker-credentials';
import { PreferencesPageClient } from './PreferencesPageClient';

export default async function PreferencesPage() {
  // Filesystem read (no auth) — runs at build/request time on the server
  const avatars = fetchAvatarImages();
  const user = await fetchCurrentUser();
  const credentials: TrackerCredentialsResult = user
    ? await listTrackerCredentials(user.id)
    : { ok: true, credentials: [] };

  return (
    <PreferencesPageClient
      avatarImages={avatars}
      trackerCredentials={credentials.ok ? credentials.credentials : []}
      trackerSyncUnavailable={!credentials.ok}
    />
  );
}
