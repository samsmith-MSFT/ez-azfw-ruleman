import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export function Spinner({
  label,
  size = 16,
}: {
  label?: string;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-fg-muted">
      <Loader2 size={size} className="animate-spin text-azure" />
      {label}
    </span>
  );
}

const TONES = {
  neutral: 'border-line text-fg-muted',
  blue: 'border-azure/50 text-azure',
  green: 'border-allow/50 text-allow',
  // Amber is reserved for uncommitted changes.
  candidate: 'border-candidate/60 text-candidate',
  red: 'border-deny/50 text-deny',
  violet: 'border-dnat/50 text-dnat',
};

/** A small outlined tag; color carries meaning, never decoration. */
export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Text that truncates with an ellipsis and shows the full value on hover. */
export function Truncate({
  children,
  className = '',
}: {
  children: string;
  className?: string;
}) {
  return (
    <span className={`block truncate ${className}`} title={children}>
      {children}
    </span>
  );
}

/** IP Group references are full resource IDs; show just the name. */
function shortenId(v: string): string {
  return v.startsWith('/subscriptions/') ? (v.split('/').at(-1) ?? v) : v;
}

/** Network values stacked one per line; overflow collapses to "+N more" with the rest in a tooltip. */
export function ValueList({
  values,
  max = 3,
  empty = 'Any',
}: {
  values?: string[];
  max?: number;
  empty?: string;
}) {
  if (!values?.length) return <span className="text-fg-faint">{empty}</span>;
  const shown = values.slice(0, max);
  const rest = values.slice(max);
  return (
    <span className="flex min-w-0 flex-col">
      {shown.map((v) => (
        <span key={v} className="netval truncate" title={v}>
          {shortenId(v)}
        </span>
      ))}
      {rest.length > 0 && (
        <span
          className="text-xs text-fg-faint"
          title={rest.map(shortenId).join('\n')}
        >
          +{rest.length} more
        </span>
      )}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex max-w-lg gap-4 px-8 py-12">
      <div className="mt-0.5 text-fg-faint">{icon}</div>
      <div>
        <h3 className="text-lg font-semibold text-fg">{title}</h3>
        {children && (
          <div className="mt-1 text-sm text-fg-muted">{children}</div>
        )}
      </div>
    </div>
  );
}

/** Status light for provisioning state. */
export function StatusDot({ state }: { state?: string }) {
  const tone =
    state === 'Succeeded'
      ? 'bg-allow'
      : state === 'Failed'
        ? 'bg-deny'
        : 'bg-fg-faint';
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone}`}
      title={`Provisioning state: ${state ?? 'unknown'}`}
      aria-label={`Provisioning state: ${state ?? 'unknown'}`}
    />
  );
}

/** A full-width message panel: what happened, in plain words, plus the next step. */
export function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone: 'error' | 'info';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`border-l-2 p-4 text-sm ${tone === 'error' ? 'border-deny bg-deny/10' : 'border-azure bg-azure/[0.08]'}`}
    >
      <p className="font-semibold text-fg">{title}</p>
      {children && (
        <div className="mt-1 whitespace-pre-line break-words text-fg-muted">
          {children}
        </div>
      )}
      {action && <div className="mt-3 flex gap-2">{action}</div>}
    </div>
  );
}
