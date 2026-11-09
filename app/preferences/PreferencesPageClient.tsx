'use client';

import { AvatarSelector } from '@/components/avatar/AvatarSelector';
import { DeleteAccountSection } from '@/components/preferences/DeleteAccountSection';
import { ScreenNameEditable } from '@/components/screen-name/ScreenNameEditable';
import { Header } from '@/components/ui/header';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GamePreferences } from '@/components/preferences/GamePreferences';
import { TrackerSyncSection } from '@/components/preferences/TrackerSyncSection';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { usePreferredGames } from '@/hooks/useGameGuard';
import { useUserData } from '@/hooks/user-data/useUserData';
import type { TrackerCredentialSummary } from '@/lib/server/tracker-credentials';

interface PreferencesPageClientProps {
  avatarImages: string[];
  trackerCredentials: TrackerCredentialSummary[];
  trackerSyncUnavailable: boolean;
}

export function PreferencesPageClient({
  avatarImages,
  trackerCredentials,
  trackerSyncUnavailable,
}: PreferencesPageClientProps) {
  const { user, loading } = useAuthGuard();
  const { preferredGames, loading: prefsLoading } = usePreferredGames();
  const { data: clientUserData } = useUserData(user?.id);

  if (loading || !user || prefsLoading) return null;

  // Client state so saving the screen name above unlocks the card in place.
  const liveScreenName = clientUserData?.live_screen_name ?? null;

  return (
    <>
      <Header>Preferences</Header>
      <Tabs
        defaultValue='account'
        orientation='vertical'
        className='flex flex-col md:flex-row gap-4 md:gap-8 h-full'
      >
        <TabsList className='md:flex-col w-full md:w-[200px] h-full gap-2 md:p-2'>
          <TabsTrigger value='account' className='w-full'>
            Account
          </TabsTrigger>
          <TabsTrigger value='appearance' className='w-full'>
            Appearance
          </TabsTrigger>
        </TabsList>
        <TabsContent value='account' className='w-full'>
          <div className='flex-col'>
            <div className='flex justify-between items-center'>
              <Label>Avatar</Label>
              <AvatarSelector userId={user.id} avatarImages={avatarImages} />
            </div>
            <Separator className='my-4' />
            <div className='flex justify-between items-center'>
              <Label>PTCG Live screen name</Label>
              <ScreenNameEditable userId={user.id} stayOnPage />
            </div>
            <Separator className='my-4' />
            <TrackerSyncSection
              credentials={trackerCredentials}
              liveScreenName={liveScreenName}
              loadError={trackerSyncUnavailable}
            />
            <Separator className='my-4' />
            <DeleteAccountSection />
          </div>
        </TabsContent>
        <TabsContent value='appearance' className='w-full'>
          <div className='flex flex-col gap-6'>
            <GamePreferences
              userId={user.id}
              initialPreferredGames={preferredGames}
            />
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
