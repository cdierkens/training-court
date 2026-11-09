import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockCreateCredential = jest.fn();
const mockReplaceToken = jest.fn();
const mockRevokeCredential = jest.fn();
const mockUpdateFormat = jest.fn();

jest.mock('../../app/preferences/tracker-credential-actions', () => ({
  createTrackerCredential: (...args: unknown[]) => mockCreateCredential(...args),
  replaceTrackerToken: (...args: unknown[]) => mockReplaceToken(...args),
  revokeTrackerCredentialAction: (...args: unknown[]) => mockRevokeCredential(...args),
  updateTrackerCredentialFormatAction: (...args: unknown[]) => mockUpdateFormat(...args),
}));

jest.mock('../../app/recoil/hooks/useUI', () => ({
  useUI: () => ({ showSuccessToast: jest.fn(), showErrorToast: jest.fn() }),
}));

jest.mock('gt-react', () => ({
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useGT: () => (text: string, options?: Record<string, unknown>) => {
    if (!options) return text;
    return Object.entries(options).reduce(
      (acc, [key, value]) =>
        key.startsWith('$') ? acc : acc.replaceAll(`{${key}}`, String(value)),
      text
    );
  },
}));

jest.mock('../../components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../../components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value ?? ''} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const { TrackerSyncSection } = require('../../components/preferences/TrackerSyncSection') as typeof import('../../components/preferences/TrackerSyncSection');

const credential = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'cred-1',
  label: 'Laptop',
  defaultFormat: 'TEF-DLR',
  tokenHint: 'abcd',
  createdAt: '2026-11-01T00:00:00.000Z',
  lastUsedAt: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateCredential.mockResolvedValue({ ok: true, token: `tct_${'b'.repeat(43)}` });
  mockUpdateFormat.mockResolvedValue({ ok: true });
  mockRevokeCredential.mockResolvedValue({ ok: true });
  mockReplaceToken.mockResolvedValue({ ok: true, token: `tct_${'c'.repeat(43)}` });
});

async function createToken() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Create a token' })[0]);
  fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'Office PC' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TEF-30C' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
  await waitFor(() => expect(mockCreateCredential).toHaveBeenCalled());
}

const renderSection = (props: Partial<Record<string, unknown>> = {}) =>
  render(
    <TrackerSyncSection
      credentials={[]}
      liveScreenName="Ash"
      loadError={false}
      {...props}
    />
  );

describe('TrackerSyncSection', () => {
  it('gates token creation on a screen name', () => {
    renderSection({ liveScreenName: null });

    expect(screen.queryByRole('button', { name: 'Create a token' })).toBeNull();
    expect(
      screen.getByText(/Set your PTCG Live screen name above before creating a token/)
    ).toBeTruthy();
  });

  it('refuses to submit until both a name and a format are chosen', () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Create a token' }));

    const submit = screen.getByRole('button', { name: 'Create token' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'Office PC' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TEF-30C' } });

    expect(submit.disabled).toBe(false);
  });

  it('creates a token and shows the one-time config', async () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Create a token' }));
    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'Office PC' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TEF-30C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() =>
      expect(mockCreateCredential).toHaveBeenCalledWith({
        label: 'Office PC',
        defaultFormat: 'TEF-30C',
      })
    );
    const textarea = (await screen.findByDisplayValue(
      new RegExp(`tct_${'b'.repeat(43)}`)
    )) as HTMLTextAreaElement;
    expect(JSON.parse(textarea.value)).toEqual({
      ptcglTrackerDestination: 1,
      name: 'Training Court',
      url: 'https://www.trainingcourt.app/api/battle-logs',
      auth: { type: 'bearer', token: `tct_${'b'.repeat(43)}` },
    });
  });

  it('confirms before replacing a token', async () => {
    renderSection({ credentials: [credential()] });

    fireEvent.click(screen.getAllByRole('button', { name: 'Replace token' })[0]);

    expect(screen.getByText('Replace Laptop?')).toBeTruthy();
    expect(mockReplaceToken).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm replace' }));

    await waitFor(() => expect(mockReplaceToken).toHaveBeenCalledWith('cred-1'));
    expect(
      await screen.findByText(/update the token on your existing Training Court destination/)
    ).toBeTruthy();
  });

  it('revokes the chosen token after confirmation', async () => {
    renderSection({ credentials: [credential()] });

    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));

    await waitFor(() => expect(mockRevokeCredential).toHaveBeenCalledWith('cred-1'));
  });

  it('copies the config and reports success', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderSection();

    await createToken();

    fireEvent.click(screen.getByRole('button', { name: 'Copy config' }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });

  it('reports a clipboard failure instead of a generic error', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    renderSection();

    await createToken();
    fireEvent.click(screen.getByRole('button', { name: 'Copy config' }));

    const alerts = await screen.findAllByRole('alert');
    expect(
      alerts.some((alert) => alert.textContent?.includes('Could not copy'))
    ).toBe(true);
  });

  it('shows a translated inline error when the token cap is hit', async () => {
    mockCreateCredential.mockResolvedValue({ ok: false, code: 'limit_reached' });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Create a token' }));
    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'Office PC' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TEF-30C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    const alerts = await screen.findAllByRole('alert');
    expect(
      alerts.some((alert) => alert.textContent?.includes('You can have up to 10 tokens'))
    ).toBe(true);
  });

  it('names the token being revoked', () => {
    renderSection({ credentials: [credential()] });

    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0]);

    expect(screen.getByText('Revoke Laptop?')).toBeTruthy();
  });

  it('updates a token format from the list', async () => {
    renderSection({ credentials: [credential()] });

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'SVI-MEG' } });

    await waitFor(() =>
      expect(mockUpdateFormat).toHaveBeenCalledWith('cred-1', 'SVI-MEG')
    );
  });

  it('shows unavailable instead of an empty list when the read fails', () => {
    renderSection({ loadError: true });

    expect(screen.getByText(/Tokens are unavailable right now/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Create a token' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
