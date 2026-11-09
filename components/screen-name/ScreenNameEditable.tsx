'use client';

import { useCallback, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { createClient } from "@/utils/supabase/client";
import { EditIcon } from "lucide-react";
import { useUserData } from "@/hooks/user-data/useUserData";
import { useRefreshUserData } from "@/hooks/user-data/useRefreshUserData";
import { useUI } from "@/app/recoil/hooks/useUI";
import { useGT } from "gt-react";

interface ScreenNameEditableProps {
  userId: string;
  /** Stay on the current page after saving (Preferences unlocks its gate here). */
  stayOnPage?: boolean;
}

export const ScreenNameEditable = ({ userId, stayOnPage = false }: ScreenNameEditableProps) => {
  const { data: userData } = useUserData(userId);
  const refreshUserData = useRefreshUserData();
  const { showErrorToast } = useUI();
  const gt = useGT();

  const [isEditing, setIsEditing] = useState(false);
  const [screenNameValue, setScreenNameValue] = useState('');

  const upsertScreenName = useCallback(async () => {
    const supabase = createClient();
    const { error } = await supabase
      .from('user data')
      .upsert({ id: userId, live_screen_name: screenNameValue });

    if (error) {
      showErrorToast(
        gt('Could not save your screen name. Try again.', {
          $id: 'preferences.screenName.toast.saveFailed',
        })
      );
      return;
    }

    await refreshUserData(userId);
    setIsEditing(false);

    if (!stayOnPage) window.location.href = '/home';
  }, [screenNameValue, userId, refreshUserData, showErrorToast, gt, stayOnPage]);

  if (isEditing || !userData?.live_screen_name) {
    return (
      <div className="flex w-full max-w-sm items-center space-x-2 gap-2">
        <Input autoFocus value={screenNameValue} onChange={(e) => setScreenNameValue(e.target.value)} placeholder="Name must be an EXACT match" />
        <Button disabled={screenNameValue.length === 0} onClick={() => upsertScreenName()}>Submit</Button>
      </div>
    )
  }

  return <div className="flex items-center gap-1">
    <h2 className="text-xl tracking-wide font-semibold">{userData.live_screen_name}</h2>
    <Button onClick={() => setIsEditing(true)} size='icon' variant='ghost'><EditIcon className="h-4 w-4 stroke-muted-foreground" /></Button>
  </div>
}
