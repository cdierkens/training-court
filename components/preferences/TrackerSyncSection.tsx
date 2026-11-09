'use client';

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { T, useGT } from 'gt-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useUI } from '@/app/recoil/hooks/useUI';
import { LogFormats, logFormats } from '@/components/tournaments/Format/tournament-format.types';
import { MAX_TRACKER_CREDENTIALS } from '@/lib/tracker-sync/limits';
import type { TrackerCredentialSummary } from '@/lib/server/tracker-credentials';
import {
  createTrackerCredential,
  replaceTrackerToken,
  revokeTrackerCredentialAction,
  updateTrackerCredentialFormatAction,
} from '@/app/preferences/tracker-credential-actions';
import type { TrackerActionFailureCode } from '@/app/preferences/tracker-credential-actions';

const TRACKER_DOWNLOAD_URL = 'https://github.com/cdierkens/ptcgl-battle-log-tracker/releases/latest';
/** The apex 308-redirects and the tracker does not follow redirects. */
const TRACKER_INGEST_URL = 'https://www.trainingcourt.app/api/battle-logs';

/** Action codes plus failures that only exist in the browser. */
type UiFailureCode = TrackerActionFailureCode | 'copy_failed';

interface TrackerSyncSectionProps {
  credentials: TrackerCredentialSummary[];
  liveScreenName: string | null;
  /** True when the token list could not be read (e.g. migration not applied). */
  loadError: boolean;
}

const formatDate = (value: string | null) => {
  if (!value) return null;
  const date = parseISO(value);
  // A bad timestamp must not take out the whole Preferences page.
  if (Number.isNaN(date.getTime())) return null;
  // Dates are rendered with suppressHydrationWarning: the server formats in
  // UTC, the client in the player's zone, and the local day is the honest one.
  return format(date, 'yyyy-MM-dd');
};

const trackerDestinationConfig = (token: string) =>
  JSON.stringify(
    {
      ptcglTrackerDestination: 1,
      name: 'Training Court',
      url: TRACKER_INGEST_URL,
      auth: { type: 'bearer', token },
    },
    null,
    2
  );

export const TrackerSyncSection = ({
  credentials,
  liveScreenName,
  loadError,
}: TrackerSyncSectionProps) => {
  const { showSuccessToast } = useUI();
  const gt = useGT();

  const [connectOpen, setConnectOpen] = useState(false);
  const [label, setLabel] = useState('');
  // No preselection: with Send deck identity off, this format stamps every
  // imported log, so it is a real choice rather than a default.
  const [format, setFormat] = useState<LogFormats | null>(null);
  const [pending, setPending] = useState(false);
  const [errorCode, setErrorCode] = useState<UiFailureCode | null>(null);
  const [issued, setIssued] = useState<{
    token: string;
    label: string;
    mode: 'created' | 'replaced';
  } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<TrackerCredentialSummary | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<TrackerCredentialSummary | null>(null);
  const [formatBusyId, setFormatBusyId] = useState<string | null>(null);

  const errorMessage = (code: UiFailureCode) => {
    switch (code) {
      case 'session_expired':
        return gt('Your session expired. Sign in again.', {
          $id: 'preferences.tracker.error.sessionExpired',
        });
      case 'screen_name_missing':
        return gt('Set your PTCG Live screen name first.', {
          $id: 'preferences.tracker.error.screenNameMissing',
        });
      case 'invalid_label':
        return gt('Give the token a name of 1–64 characters.', {
          $id: 'preferences.tracker.error.invalidLabel',
        });
      case 'invalid_format':
        return gt('Choose a format for this token.', {
          $id: 'preferences.tracker.error.invalidFormat',
        });
      case 'limit_reached':
        return gt('You can have up to {max} tokens. Revoke one first.', {
          $id: 'preferences.tracker.error.limitReached',
          max: MAX_TRACKER_CREDENTIALS,
        });
      case 'not_found':
        return gt('That token is no longer active.', {
          $id: 'preferences.tracker.error.notFound',
        });
      case 'copy_failed':
        return gt('Could not copy. Select the config and copy it manually.', {
          $id: 'preferences.tracker.error.copyFailed',
        });
      case 'unavailable':
      default:
        return gt('Something went wrong. Try again.', {
          $id: 'preferences.tracker.error.unavailable',
        });
    }
  };

  const handleCreate = async () => {
    if (!format) return;

    setPending(true);
    setErrorCode(null);
    try {
      const result = await createTrackerCredential({ label, defaultFormat: format });
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }

      setConnectOpen(false);
      setIssued({ token: result.token, label: label.trim(), mode: 'created' });
      setLabel('');
      setFormat(null);
      showSuccessToast(gt('Token created', { $id: 'preferences.tracker.toast.connected' }));
    } catch {
      setErrorCode('unavailable');
    } finally {
      setPending(false);
    }
  };

  const handleReplace = async () => {
    if (!replaceTarget) return;

    const target = replaceTarget;
    setPending(true);
    setErrorCode(null);
    try {
      const result = await replaceTrackerToken(target.id);
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }

      setReplaceTarget(null);
      setIssued({ token: result.token, label: target.label, mode: 'replaced' });
      showSuccessToast(gt('Token replaced', { $id: 'preferences.tracker.toast.tokenReplaced' }));
    } catch {
      setErrorCode('unavailable');
    } finally {
      setPending(false);
    }
  };

  const handleFormatChange = async (credential: TrackerCredentialSummary, value: string) => {
    setFormatBusyId(credential.id);
    setErrorCode(null);
    try {
      const result = await updateTrackerCredentialFormatAction(credential.id, value);
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }

      showSuccessToast(gt('Format updated', { $id: 'preferences.tracker.toast.formatUpdated' }));
    } catch {
      setErrorCode('unavailable');
    } finally {
      setFormatBusyId(null);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;

    setPending(true);
    setErrorCode(null);
    try {
      const result = await revokeTrackerCredentialAction(revokeTarget.id);
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }

      setRevokeTarget(null);
      showSuccessToast(gt('Token revoked', { $id: 'preferences.tracker.toast.revoked' }));
    } catch {
      setErrorCode('unavailable');
    } finally {
      setPending(false);
    }
  };

  const copyConfig = async () => {
    if (!issued) return;

    try {
      await navigator.clipboard.writeText(trackerDestinationConfig(issued.token));
      showSuccessToast(gt('Config copied', { $id: 'preferences.tracker.toast.copied' }));
    } catch {
      setErrorCode('copy_failed');
    }
  };

  const atCap = credentials.length >= MAX_TRACKER_CREDENTIALS;
  const errorLine = errorCode ? (
    <p role="alert" className="text-sm text-destructive">{errorMessage(errorCode)}</p>
  ) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T id="preferences.tracker.title">PTCGL Tracker sync</T>
        </CardTitle>
        <CardDescription>
          <T id="preferences.tracker.description">
            Import saved Battle Logs from the PTCGL Tracker desktop app.
          </T>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            <T id="preferences.tracker.unavailable">
              Tokens are unavailable right now. Try again later.
            </T>
          </p>
        ) : credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <T id="preferences.tracker.empty">Sync saved Battle Logs from PTCGL Tracker automatically.</T>
          </p>
        ) : (
          <div className="space-y-2">
            <h3 className="font-medium">
              <T id="preferences.tracker.tokens.title">Active tokens</T>
            </h3>
            {credentials.map((credential) => (
              <div
                key={credential.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{credential.label}</p>
                  <p className="text-xs text-muted-foreground">tct_…{credential.tokenHint}</p>
                  <p className="text-xs text-muted-foreground">
                    <T id="preferences.tracker.tokens.connected">Created</T>{' '}
                    <span suppressHydrationWarning>{formatDate(credential.createdAt)}</span>
                    {' · '}
                    <T id="preferences.tracker.tokens.lastSync">Last sync</T>{' '}
                    <span suppressHydrationWarning>
                      {formatDate(credential.lastUsedAt) ?? (
                        <T id="preferences.tracker.tokens.never">Never</T>
                      )}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Select
                    value={credential.defaultFormat}
                    onValueChange={(value) => handleFormatChange(credential, value)}
                    disabled={formatBusyId === credential.id}
                  >
                    <SelectTrigger
                      className="w-[130px]"
                      aria-label={gt('Default format for {name}', {
                        $id: 'preferences.tracker.tokens.format',
                        name: credential.label,
                      })}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {logFormats.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => setReplaceTarget(credential)}>
                    <T id="preferences.tracker.tokens.replaceToken">Replace token</T>
                  </Button>
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRevokeTarget(credential)}>
                    <T id="preferences.tracker.tokens.revoke">Revoke</T>
                  </Button>
                </div>
              </div>
            ))}
            {!connectOpen && !revokeTarget && !replaceTarget && !issued ? errorLine : null}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {liveScreenName ? (
            <Button
              onClick={() => {
                setErrorCode(null);
                setConnectOpen(true);
              }}
              disabled={loadError || atCap}
              variant={credentials.length === 0 ? 'default' : 'outline'}
            >
              <T id="preferences.tracker.connect">Create a token</T>
            </Button>
          ) : null}
          <a className="text-sm underline underline-offset-4" href={TRACKER_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            <T id="preferences.tracker.download">Download PTCGL Tracker</T>
          </a>
        </div>

        {!liveScreenName && (
          <p className="text-sm text-muted-foreground">
            <T id="preferences.tracker.screenNameRequired">
              Set your PTCG Live screen name above before creating a token.
            </T>
          </p>
        )}

        {liveScreenName && atCap && (
          <p className="text-sm text-muted-foreground">{errorMessage('limit_reached')}</p>
        )}

      </CardContent>

      <Dialog
        open={connectOpen}
        onOpenChange={(open) => {
          setConnectOpen(open);
          if (!open) setErrorCode(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <T id="preferences.tracker.connect.title">Create a token</T>
            </DialogTitle>
            <DialogDescription>
              <T id="preferences.tracker.connect.description">
                Name this token and pick the format to use when a log carries no deck format. You can revoke it here later.
              </T>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="tracker-credential-label">
                <T id="preferences.tracker.connect.label">Token name</T>
              </Label>
              <Input
                id="tracker-credential-label"
                value={label}
                maxLength={64}
                placeholder={gt('Desktop', { $id: 'preferences.tracker.connect.labelPlaceholder' })}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tracker-credential-format">
                <T id="preferences.tracker.connect.format">Default format</T>
              </Label>
              <Select value={format ?? undefined} onValueChange={(value) => setFormat(value as LogFormats)}>
                <SelectTrigger id="tracker-credential-format" className="w-full">
                  <SelectValue placeholder={gt('Choose a format', { $id: 'preferences.tracker.connect.formatPlaceholder' })} />
                </SelectTrigger>
                <SelectContent>
                  {logFormats.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {errorLine}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectOpen(false)} disabled={pending}>
              <T id="preferences.tracker.connect.cancel">Cancel</T>
            </Button>
            <Button onClick={handleCreate} disabled={pending || label.trim().length === 0 || !format}>
              <T id="preferences.tracker.connect.submit">Create token</T>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        The token is shown once. This dialog hides its close button and ignores
        every dismissal path except its own Done button, so an accidental click
        cannot lose the secret.
      */}
      <Dialog open={issued !== null} onOpenChange={() => undefined}>
        <DialogContent
          hideClose
          className="sm:max-w-[560px]"
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              <T id="preferences.tracker.token.title">Destination config</T>
            </DialogTitle>
            <DialogDescription>
              {issued?.mode === 'replaced' ? (
                <T id="preferences.tracker.token.descriptionReplace">
                  In the PTCGL Tracker, update the token on your existing Training Court destination in Settings → Destinations. The old token no longer works.
                </T>
              ) : (
                <T id="preferences.tracker.token.description">
                  In the PTCGL Tracker, open Settings → Destinations, add Training Court, and paste this config. It is shown once.
                </T>
              )}
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            {gt('Token: {name}', {
              $id: 'preferences.tracker.token.for',
              name: issued?.label ?? '',
            })}
          </p>

          <Textarea
            readOnly
            rows={10}
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
            value={issued ? trackerDestinationConfig(issued.token) : ''}
          />

          <p className="text-sm text-muted-foreground">
            <T id="preferences.tracker.token.deckIdentity">
              Turn on Send deck identity for this destination in the tracker&apos;s Settings, or logs will arrive without a decklist.
            </T>
          </p>

          {errorLine}

          <DialogFooter>
            <Button variant="outline" onClick={copyConfig}>
              <T id="preferences.tracker.token.copy">Copy config</T>
            </Button>
            <Button
              onClick={() => {
                setIssued(null);
                setErrorCode(null);
              }}
            >
              <T id="preferences.tracker.token.done">Done</T>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={replaceTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReplaceTarget(null);
            setErrorCode(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {gt('Replace {name}?', {
                $id: 'preferences.tracker.replace.title',
                name: replaceTarget?.label ?? '',
              })}
            </DialogTitle>
            <DialogDescription>
              <T id="preferences.tracker.replace.description">
                The current token stops working immediately. You will get a new one to paste into the tracker.
              </T>
            </DialogDescription>
          </DialogHeader>
          {errorLine}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReplaceTarget(null);
                setErrorCode(null);
              }}
              disabled={pending}
            >
              <T id="preferences.tracker.replace.cancel">Cancel</T>
            </Button>
            <Button onClick={handleReplace} disabled={pending} aria-label={gt('Confirm replace', { $id: 'preferences.tracker.replace.confirmAria' })}>
              <T id="preferences.tracker.replace.confirm">Replace token</T>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeTarget(null);
            setErrorCode(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {gt('Revoke {name}?', {
                $id: 'preferences.tracker.revoke.title',
                name: revokeTarget?.label ?? '',
              })}
            </DialogTitle>
            <DialogDescription>
              <T id="preferences.tracker.revoke.description">
                The tracker pauses on its next attempt and asks for a new token. Logs it already sent stay in your history.
              </T>
            </DialogDescription>
          </DialogHeader>
          {errorLine}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRevokeTarget(null);
                setErrorCode(null);
              }}
              disabled={pending}
            >
              <T id="preferences.tracker.revoke.cancel">Cancel</T>
            </Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={pending} aria-label={gt('Confirm revoke', { $id: 'preferences.tracker.revoke.confirmAria' })}>
              <T id="preferences.tracker.revoke.confirm">Revoke</T>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
