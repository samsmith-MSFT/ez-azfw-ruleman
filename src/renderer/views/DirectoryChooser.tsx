import { useState } from 'react';
import { Building2, ChevronRight } from 'lucide-react';
import { Spinner } from '../components/ui';
import { errorMessage } from '../components/Toast';
import type { AccountInfo, TenantInfo } from '../../shared/types';

function statusText(t: TenantInfo): { text: string; tone: string } {
  switch (t.status) {
    case 'ready':
      return {
        text:
          t.subscriptionCount === 1
            ? '1 subscription'
            : `${t.subscriptionCount ?? 0} subscriptions`,
        tone:
          (t.subscriptionCount ?? 0) > 0 ? 'text-fg-muted' : 'text-fg-faint',
      };
    case 'needs-sign-in':
      return { text: 'Sign-in needed', tone: 'text-fg-muted' };
    case 'unavailable':
      return { text: "Couldn't check", tone: 'text-fg-faint' };
    default:
      return { text: 'Not checked', tone: 'text-fg-faint' };
  }
}

/** Shown after sign-in when the app can't pick the right directory on its own. */
export function DirectoryChooser({
  account,
  onChosen,
  onSignOut,
}: {
  account: AccountInfo;
  onChosen: (account: AccountInfo) => void;
  onSignOut: () => void;
}) {
  const tenants = account.tenants ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(!tenants.length);

  const choose = async (tenantId: string) => {
    setBusy(tenantId);
    setError('');
    try {
      onChosen(await window.api.switchTenant(tenantId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-1 items-start overflow-y-auto px-16 py-16">
      <div className="w-full max-w-[34rem]">
        <h1 className="text-[28px] font-bold leading-tight">
          Choose a directory
        </h1>
        <p className="mt-2 text-base text-fg-muted">
          {tenants.length
            ? `Signed in as ${account.username ?? account.displayName ?? 'you'}. Your account belongs to ${tenants.length} ${tenants.length === 1 ? 'directory' : 'directories'}; pick the one that holds the firewalls you want to manage.`
            : `Signed in as ${account.username ?? account.displayName ?? 'you'}. Enter the directory that holds your subscriptions.`}
        </p>

        {tenants.length > 0 && (
          <ul className="mt-6 border-y border-line">
            {tenants.map((t) => {
              const s = statusText(t);
              return (
                <li
                  key={t.tenantId}
                  className="border-b border-line last:border-b-0"
                >
                  <button
                    className="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-ink-850 disabled:opacity-50"
                    disabled={!!busy}
                    onClick={() => choose(t.tenantId)}
                  >
                    <Building2 size={18} className="shrink-0 text-fg-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {t.displayName ?? t.defaultDomain ?? t.tenantId}
                      </span>
                      <span className="block truncate text-xs text-fg-faint">
                        {t.defaultDomain ?? t.tenantId}
                      </span>
                    </span>
                    {busy === t.tenantId ? (
                      <Spinner label="Connecting…" />
                    ) : (
                      <span className={`shrink-0 text-sm ${s.tone}`}>
                        {s.text}
                      </span>
                    )}
                    <ChevronRight
                      size={16}
                      className="shrink-0 text-fg-faint"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p className="mt-4 border-l-2 border-deny bg-deny/10 px-3 py-2 text-sm">
            {error}
          </p>
        )}

        {tenants.length > 0 && !showManual && (
          <button
            className="mt-5 flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
            onClick={() => setShowManual(true)}
          >
            <ChevronRight size={14} /> Directory not listed?
          </button>
        )}

        {showManual && (
          <form
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim()) choose(manual.trim());
            }}
          >
            <label className="label" htmlFor="manual-directory">
              Directory domain or ID
            </label>
            <div className="flex gap-2">
              <input
                id="manual-directory"
                className="input"
                placeholder="contoso.onmicrosoft.com"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                autoFocus={!tenants.length}
              />
              <button
                className="btn-primary"
                type="submit"
                disabled={!manual.trim() || !!busy}
              >
                {busy && busy === manual.trim() ? 'Connecting…' : 'Continue'}
              </button>
            </div>
            <p className="mt-1 text-xs text-fg-faint">
              In the Azure portal, open Subscriptions and check the Directory
              column, or open Microsoft Entra ID and copy the Tenant ID.
            </p>
          </form>
        )}

        <button
          className="mt-10 text-sm text-fg-muted hover:text-fg"
          onClick={onSignOut}
        >
          Use a different account
        </button>
      </div>
    </div>
  );
}
