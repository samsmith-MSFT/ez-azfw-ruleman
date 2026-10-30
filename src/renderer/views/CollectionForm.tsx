import { Fragment, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, Copy, Trash2 } from 'lucide-react';
import { Segmented } from '../components/Segmented';
import { TokenPicker, type PickerOption } from '../components/TokenPicker';
import { useRuleLookups, type Lookups } from '../lookups';
import {
  DEST_TYPES,
  NAT_PROTOCOLS,
  NET_PROTOCOLS,
  PICKER,
  SOURCE_TYPES,
  duplicateRow,
  emptyRow,
  isBlankRow,
  rowCellErrors,
  rowChanged,
  setCollectionKind,
  switchField,
  type CellKey,
  type CollectionDraft,
  type CollectionKind,
  type DraftErrors,
  type ListField,
  type PickerKind,
  type RuleRow,
} from '../../shared/ruleDraft';
import { PRIORITY_MAX, PRIORITY_MIN } from '../../shared/rules';
import { nameError } from '../../shared/naming';
import type { NetworkProtocol } from '../../shared/types';

const KINDS: { kind: CollectionKind; hint: string }[] = [
  { kind: 'DNAT', hint: 'Publish inbound services. Processed first.' },
  { kind: 'Network', hint: 'IPs, ports and protocols. Processed second.' },
  {
    kind: 'Application',
    hint: 'FQDNs, URLs and web categories over HTTP/S. Processed last.',
  },
];

const cell = 'input h-8 py-1 font-mono text-xs';
// List cells grow with their content (Chromium's field-sizing), so long lists stay readable.
const listCell =
  'input min-h-8 resize-none py-[5px] font-mono text-xs leading-[18px] [field-sizing:content]';
const select =
  'h-8 shrink-0 rounded border border-line bg-ink-950 px-1 text-xs text-fg-muted';
const invalidCls = 'border-deny focus:border-deny';
const kindOrActionClass = (v: string) =>
  v === 'Deny'
    ? 'bg-deny text-white'
    : v === 'DNAT'
      ? 'bg-dnat text-ink-950'
      : 'bg-azure text-ink-950';

type CellErrors = Partial<Record<CellKey, string>>;

function CellMessage({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="mt-0.5 text-[11px] leading-4 text-deny" role="alert">
      {error}
    </p>
  );
}

function ProtocolChips({
  value,
  options,
  onChange,
}: {
  value: NetworkProtocol[];
  options: NetworkProtocol[];
  onChange: (v: NetworkProtocol[]) => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Protocols">
      {options.map((p) => {
        const on = value.includes(p);
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(
                // "Any" is exclusive; picking a specific protocol clears it.
                p === 'Any'
                  ? on
                    ? []
                    : ['Any']
                  : on
                    ? value.filter((x) => x !== p)
                    : [...value.filter((x) => x !== 'Any'), p],
              )
            }
            className={`h-8 border px-1.5 text-[11px] font-medium ${on ? 'border-azure bg-azure/25 text-fg' : 'border-line text-fg-faint hover:bg-ink-800'}`}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

/** Options for a picker field, from the lists loaded from Azure. */
function pickerOptions(kind: PickerKind, l: Lookups): PickerOption[] {
  const data = l.lookups;
  if (!data) return [];
  switch (kind) {
    case 'ipGroup':
      return data.ipGroups.map((g) => ({
        value: g.id,
        label: g.name,
        hint: `${g.addresses.length} ${g.addresses.length === 1 ? 'address' : 'addresses'} · ${g.resourceGroup}`,
        title: `${g.name} (${g.resourceGroup})\n${g.addresses.slice(0, 25).join('\n')}${g.addresses.length > 25 ? `\n…and ${g.addresses.length - 25} more` : ''}`,
      }));
    case 'serviceTag':
      return data.serviceTags.map((t) => ({
        value: t.name,
        label: t.name,
        hint: `${t.prefixCount} prefixes`,
      }));
    case 'fqdnTag':
      return data.fqdnTags.map((t) => ({ value: t, label: t }));
    case 'webCategory':
      return data.webCategories.map((c) => ({
        value: c.name,
        label: c.name,
        hint: c.group,
      }));
  }
}

const PICKER_LIST: Record<PickerKind, keyof Lookups['known']> = {
  ipGroup: 'ipGroups',
  serviceTag: 'serviceTags',
  fqdnTag: 'fqdnTags',
  webCategory: 'webCategories',
};

/** One list field: a picker for values that come from Azure, otherwise free text. */
function ListInput({
  row,
  field,
  onChange,
  label,
  placeholder,
  error,
}: {
  row: RuleRow;
  field: ListField;
  onChange: (row: RuleRow) => void;
  label: string;
  placeholder?: string;
  error?: string;
}) {
  const lookups = useRuleLookups();
  const set = (v: string) =>
    onChange({ ...row, lists: { ...row.lists, [field]: v } });
  const picker = PICKER[field];
  if (picker) {
    const options = pickerOptions(picker, lookups);
    // Typing free values is only allowed when the list itself couldn't be loaded.
    const listLoaded = !!lookups.known[PICKER_LIST[picker]];
    return (
      <TokenPicker
        value={row.lists[field]}
        onChange={set}
        options={options}
        ariaLabel={label}
        placeholder={
          lookups.loading && !options.length
            ? 'Loading from Azure…'
            : listLoaded
              ? placeholder
              : picker === 'ipGroup'
                ? 'Paste an IP Group resource ID'
                : 'Type a name'
        }
        loading={lookups.loading}
        allowCustom={!listLoaded}
        invalid={!!error}
        emptyText={
          listLoaded ? 'No matches' : "This list couldn't be loaded from Azure"
        }
      />
    );
  }
  return (
    <textarea
      rows={1}
      className={`${listCell} ${error ? invalidCls : ''}`}
      aria-label={label}
      aria-invalid={!!error}
      value={row.lists[field]}
      placeholder={placeholder}
      onChange={(e) => set(e.target.value)}
    />
  );
}

/** A Source/Destination cell: a type picker plus the input for that type. */
function TypedListCell({
  row,
  side,
  options,
  onChange,
  label,
  errors,
}: {
  row: RuleRow;
  side: 'source' | 'dest';
  options: { field: ListField; label: string; placeholder?: string }[];
  onChange: (row: RuleRow) => void;
  label: string;
  errors: CellErrors;
}) {
  const field = side === 'source' ? row.sourceField : row.destField;
  const current = options.find((o) => o.field === field) ?? options[0];
  // Values stored under the other types are easy to miss; show them.
  const hidden = options.filter(
    (o) => o.field !== field && row.lists[o.field].trim(),
  );
  return (
    <div>
      <div className="flex items-start gap-1">
        {options.length > 1 && (
          <select
            className={select}
            aria-label={`${label} type`}
            value={field}
            onChange={(e) =>
              onChange(switchField(row, side, e.target.value as ListField))
            }
          >
            {options.map((o) => (
              <option key={o.field} value={o.field}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <div className="min-w-0 flex-1">
          <ListInput
            row={row}
            field={field}
            onChange={onChange}
            label={label}
            placeholder={current.placeholder ?? '10.0.0.0/8, *'}
            error={errors[field]}
          />
        </div>
      </div>
      <CellMessage error={errors[field]} />
      {hidden.map((o) => {
        const values = row.lists[o.field]
          .split(/[\s,;]+/)
          .filter(Boolean)
          // IP Group IDs are long; their last segment is the name people know.
          .map((v) => (v.startsWith('/') ? v.split('/').pop() : v));
        return (
          <button
            key={o.field}
            type="button"
            className={`mt-0.5 block max-w-full truncate text-left text-[11px] hover:underline ${errors[o.field] ? 'text-deny' : 'text-azure'}`}
            title={`${errors[o.field] ?? `Also: ${row.lists[o.field]}`}. Click to edit these.`}
            onClick={() =>
              onChange(
                side === 'source'
                  ? { ...row, sourceField: o.field }
                  : { ...row, destField: o.field },
              )
            }
          >
            + {o.label}: {values.join(', ')}
            {errors[o.field] && ' (needs fixing)'}
          </button>
        );
      })}
    </div>
  );
}

/** Less common fields, shown under a row when expanded. */
function RowDetails({
  row,
  kind,
  onChange,
  errors,
}: {
  row: RuleRow;
  kind: CollectionKind;
  onChange: (row: RuleRow) => void;
  errors: CellErrors;
}) {
  return (
    <div className="flex items-start gap-4 border-l-2 border-azure/40 bg-ink-900/60 px-3 py-2.5">
      <label className="block min-w-0 flex-1">
        <span className="mb-0.5 block text-xs text-fg-muted">Description</span>
        <input
          className="input h-8 py-1 text-sm"
          value={row.description}
          placeholder="Why this rule exists, ticket number…"
          onChange={(e) => onChange({ ...row, description: e.target.value })}
        />
      </label>
      {kind === 'Application' && (
        <label className="mt-[1.4rem] flex h-8 shrink-0 items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            className="accent-azure"
            checked={row.terminateTLS}
            onChange={(e) =>
              onChange({ ...row, terminateTLS: e.target.checked })
            }
          />
          TLS inspection (Premium)
        </label>
      )}
      {kind === 'DNAT' && (
        <div className="w-72 shrink-0">
          <span className="mb-0.5 block text-xs text-fg-muted">
            …or translated FQDN
          </span>
          <input
            className={`${cell} ${errors.translatedFqdn ? invalidCls : ''}`}
            aria-label="Translated FQDN"
            aria-invalid={!!errors.translatedFqdn}
            value={row.translatedFqdn}
            placeholder="app.internal.contoso.com"
            onChange={(e) =>
              onChange({ ...row, translatedFqdn: e.target.value })
            }
          />
          <CellMessage error={errors.translatedFqdn} />
        </div>
      )}
    </div>
  );
}

const COLUMNS: Record<CollectionKind, { label: string; width?: string }[]> = {
  Network: [
    { label: 'Name', width: 'w-40' },
    { label: 'Source' },
    { label: 'Protocol', width: 'w-[11.5rem]' },
    { label: 'Ports', width: 'w-28' },
    { label: 'Destination' },
  ],
  Application: [
    { label: 'Name', width: 'w-40' },
    { label: 'Source' },
    { label: 'Protocol:port', width: 'w-36' },
    { label: 'Destination' },
  ],
  DNAT: [
    { label: 'Name', width: 'w-36' },
    { label: 'Source' },
    { label: 'Protocol', width: 'w-24' },
    { label: 'Firewall IP', width: 'w-32' },
    { label: 'Port', width: 'w-20' },
    { label: 'Translated to', width: 'w-32' },
    { label: 'Port', width: 'w-20' },
  ],
};

function RuleCells({
  row,
  kind,
  onChange,
  nameRef,
  errors,
}: {
  row: RuleRow;
  kind: CollectionKind;
  onChange: (row: RuleRow) => void;
  nameRef?: (el: HTMLInputElement | null) => void;
  errors: CellErrors;
}) {
  const td = 'px-1 py-1 align-top';
  const text = (
    key: CellKey,
    value: string,
    set: (v: string) => void,
    label: string,
    placeholder?: string,
  ) => (
    <>
      <input
        className={`${cell} ${errors[key] ? invalidCls : ''}`}
        aria-label={label}
        aria-invalid={!!errors[key]}
        value={value}
        placeholder={placeholder}
        title={value}
        onChange={(e) => set(e.target.value)}
      />
      <CellMessage error={errors[key]} />
    </>
  );
  const list = (f: ListField, label: string, placeholder?: string) => (
    <>
      <ListInput
        row={row}
        field={f}
        onChange={onChange}
        label={label}
        placeholder={placeholder}
        error={errors[f]}
      />
      <CellMessage error={errors[f]} />
    </>
  );
  return (
    <>
      <td className={td}>
        <input
          ref={nameRef}
          className={`${cell} font-sans ${errors.name ? invalidCls : ''}`}
          aria-label="Rule name"
          aria-invalid={!!errors.name}
          value={row.name}
          placeholder="rule-name"
          onChange={(e) => onChange({ ...row, name: e.target.value })}
        />
        <CellMessage error={errors.name} />
      </td>
      <td className={td}>
        <TypedListCell
          row={row}
          side="source"
          options={SOURCE_TYPES}
          onChange={onChange}
          label="Source"
          errors={errors}
        />
      </td>
      {kind === 'Network' && (
        <>
          <td className={td}>
            <ProtocolChips
              value={row.protocols}
              options={NET_PROTOCOLS}
              onChange={(protocols) => onChange({ ...row, protocols })}
            />
          </td>
          <td className={td}>
            {list('destinationPorts', 'Destination ports', '443, 8000-8080')}
          </td>
          <td className={td}>
            <TypedListCell
              row={row}
              side="dest"
              options={DEST_TYPES.Network}
              onChange={onChange}
              label="Destination"
              errors={errors}
            />
          </td>
        </>
      )}
      {kind === 'Application' && (
        <>
          <td className={td}>
            {text(
              'appProtocols',
              row.appProtocols,
              (appProtocols) => onChange({ ...row, appProtocols }),
              'Protocols',
              'Https:443, Http:80',
            )}
          </td>
          <td className={td}>
            <TypedListCell
              row={row}
              side="dest"
              options={DEST_TYPES.Application}
              onChange={onChange}
              label="Destination"
              errors={errors}
            />
          </td>
        </>
      )}
      {kind === 'DNAT' && (
        <>
          <td className={td}>
            <ProtocolChips
              value={row.protocols}
              options={NAT_PROTOCOLS}
              onChange={(protocols) => onChange({ ...row, protocols })}
            />
          </td>
          <td className={td}>
            {list('destinationAddresses', 'Firewall public IP', '20.62.18.40')}
          </td>
          <td className={td}>
            {list('destinationPorts', 'Destination port', '443')}
          </td>
          <td className={td}>
            {text(
              'translatedAddress',
              row.translatedAddress,
              (translatedAddress) => onChange({ ...row, translatedAddress }),
              'Translated address',
              row.translatedFqdn ? `FQDN: ${row.translatedFqdn}` : '10.20.1.4',
            )}
          </td>
          <td className={td}>
            {text(
              'translatedPort',
              row.translatedPort,
              (translatedPort) => onChange({ ...row, translatedPort }),
              'Translated port',
              '443',
            )}
          </td>
        </>
      )}
    </>
  );
}

/**
 * Edits one rule collection the way the Azure portal does: collection settings on top, its rules
 * in an inline grid below. Typing in the last row adds a fresh one, like a spreadsheet.
 * Format problems show under each cell as you type; missing values are reported on save.
 */
export function CollectionForm({
  value,
  onChange,
  errors,
  warnings,
  focusRowKey,
  autoFocusName,
}: {
  value: CollectionDraft;
  onChange: (d: CollectionDraft) => void;
  /** Shown once the user tries to save. */
  errors?: DraftErrors;
  /** Risk warnings per row; shown live because they don't block saving. */
  warnings?: Record<string, string[]>;
  /** Row to scroll to, expand and focus when opened (e.g. the rule that was clicked). */
  focusRowKey?: string;
  autoFocusName?: boolean;
}) {
  const { known } = useRuleLookups();
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(focusRowKey ? [focusRowKey] : []),
  );
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const [focusNext, setFocusNext] = useState<string | undefined>(focusRowKey);

  useEffect(() => {
    if (!focusNext) return;
    const el = nameInputs.current.get(focusNext);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      el.focus();
      setFocusNext(undefined);
    }
  }, [focusNext, value.rows]);

  const hasRules = value.rows.some((r) => !isBlankRow(r));
  const kind = value.kind;

  // Same live naming check as the deploy wizard; existing names Azure accepted aren't judged.
  const trimmedName = value.name.trim();
  const collectionNameError =
    trimmedName && (!value.base || value.base.name !== trimmedName)
      ? nameError('ruleCollection', trimmedName)
      : undefined;

  const setRow = (key: string, row: RuleRow) => {
    let rows = value.rows.map((r) => (r.key === key ? row : r));
    // Spreadsheet feel: typing in the last row adds an empty one after it.
    const last = rows[rows.length - 1];
    if (last && last.key === key && !isBlankRow(row))
      rows = [...rows, emptyRow(kind)];
    onChange({ ...value, rows });
  };

  const duplicate = (row: RuleRow) => {
    const copy = duplicateRow(
      row,
      value.rows.map((r) => r.name),
    );
    const i = value.rows.findIndex((r) => r.key === row.key);
    const rows = [...value.rows];
    rows.splice(i + 1, 0, copy);
    onChange({ ...value, rows });
    setFocusNext(copy.key);
  };

  const remove = (key: string) =>
    onChange({ ...value, rows: value.rows.filter((r) => r.key !== key) });

  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const columns = COLUMNS[kind];
  const collectionErrors = (errors?.collection ?? []).filter(
    (e) => e !== collectionNameError,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_7rem] items-start gap-4">
        <label className="block">
          <span className="label">Collection name</span>
          <input
            className={`input ${collectionNameError ? invalidCls : ''}`}
            aria-invalid={!!collectionNameError}
            value={value.name}
            placeholder={
              kind === 'DNAT'
                ? 'dnat-inbound-web'
                : kind === 'Application'
                  ? 'app-allow-saas'
                  : 'net-allow-core'
            }
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            autoFocus={autoFocusName}
          />
          <CellMessage error={collectionNameError} />
        </label>
        <div>
          <span className="label">Type</span>
          <Segmented
            label="Collection type"
            activeClass={kindOrActionClass}
            value={kind}
            onChange={(k) => onChange(setCollectionKind(value, k))}
            options={KINDS.map((k) => ({
              value: k.kind,
              label: k.kind,
              disabled: hasRules && k.kind !== kind,
              title:
                hasRules && k.kind !== kind
                  ? 'A collection holds one rule type. Remove its rules to change the type.'
                  : k.hint,
            }))}
          />
        </div>
        <div>
          <span className="label">Action</span>
          {kind === 'DNAT' ? (
            <p className="flex h-8 items-center text-sm text-fg-muted">
              Destination NAT
            </p>
          ) : (
            <Segmented
              label="Action"
              activeClass={kindOrActionClass}
              value={value.action}
              onChange={(action) => onChange({ ...value, action })}
              options={[
                { value: 'Allow', label: 'Allow' },
                { value: 'Deny', label: 'Deny' },
              ]}
            />
          )}
        </div>
        <label className="block">
          <span className="label">Priority</span>
          <input
            className="input"
            type="number"
            min={PRIORITY_MIN}
            max={PRIORITY_MAX}
            value={value.priority}
            onChange={(e) => onChange({ ...value, priority: e.target.value })}
          />
        </label>
      </div>
      <p className="-mt-2 text-xs text-fg-faint">
        {KINDS.find((k) => k.kind === kind)!.hint} Within a group, lower
        priority numbers are evaluated first; rules stop at the first match.
      </p>

      {collectionErrors.length > 0 && (
        <ul className="list-disc space-y-0.5 border border-deny/40 bg-deny/10 py-2 pl-7 pr-3 text-xs text-deny">
          {collectionErrors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="border border-line">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-ink-900 text-xs text-fg-muted">
            <tr className="border-b border-line">
              <th className="w-7" aria-label="Details" />
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={`px-1 py-1.5 font-medium ${c.width ?? ''}`}
                >
                  {c.label}
                </th>
              ))}
              <th className="w-16" aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {value.rows.map((row) => {
              const open = expanded.has(row.key);
              const blank = isBlankRow(row);
              // Format problems show live, but only for rows that are new or edited.
              const cellErrors: CellErrors =
                !blank && rowChanged(row, kind)
                  ? rowCellErrors(row, kind, known)
                  : {};
              const rowErrors = errors?.rows[row.key];
              const flagged = rowErrors || Object.keys(cellErrors).length;
              return (
                <Fragment key={row.key}>
                  <tr
                    className={`border-b border-line/60 ${flagged ? 'bg-deny/[0.06]' : ''}`}
                  >
                    <td className="px-1 py-1 align-top">
                      <button
                        type="button"
                        className="flex h-8 w-6 items-center justify-center text-fg-faint hover:text-fg"
                        aria-label={open ? 'Hide details' : 'Show details'}
                        aria-expanded={open}
                        title={
                          kind === 'Network'
                            ? 'Description'
                            : kind === 'Application'
                              ? 'Description and TLS inspection'
                              : 'Description and translated FQDN'
                        }
                        onClick={() => toggle(row.key)}
                      >
                        <ChevronRight
                          size={14}
                          className={`transition-transform ${open ? 'rotate-90' : ''}`}
                        />
                      </button>
                    </td>
                    <RuleCells
                      row={row}
                      kind={kind}
                      errors={cellErrors}
                      onChange={(r) => setRow(row.key, r)}
                      nameRef={(el) => {
                        if (el) nameInputs.current.set(row.key, el);
                        else nameInputs.current.delete(row.key);
                      }}
                    />
                    <td className="px-1 py-1 align-top">
                      {!blank && (
                        <div className="flex">
                          <button
                            type="button"
                            className="btn-ghost h-8 w-7 justify-center px-0"
                            aria-label={`Duplicate ${row.name || 'rule'}`}
                            title="Duplicate"
                            onClick={() => duplicate(row)}
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            type="button"
                            className="btn-ghost h-8 w-7 justify-center px-0 hover:text-deny"
                            aria-label={`Remove ${row.name || 'rule'}`}
                            title="Remove"
                            onClick={() => remove(row.key)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-line/60">
                      <td />
                      <td colSpan={columns.length + 1} className="pb-2 pr-2">
                        <RowDetails
                          row={row}
                          kind={kind}
                          errors={cellErrors}
                          onChange={(r) => setRow(row.key, r)}
                        />
                      </td>
                    </tr>
                  )}
                  {rowErrors && (
                    <tr className="border-b border-line/60">
                      <td />
                      <td
                        colSpan={columns.length + 1}
                        className="px-1 pb-2 text-xs text-deny"
                        role="alert"
                      >
                        {rowErrors.join(' ')}
                      </td>
                    </tr>
                  )}
                  {warnings?.[row.key] && (
                    <tr className="border-b border-line/60">
                      <td />
                      <td
                        colSpan={columns.length + 1}
                        className="px-1 pb-2 text-xs text-candidate"
                      >
                        <span className="inline-flex items-start gap-1.5">
                          <AlertTriangle size={13} className="mt-px shrink-0" />
                          {warnings[row.key].join(' ')}
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-3 py-1.5 text-xs text-fg-faint">
          Start typing in the empty last row to add a rule. Separate list
          entries with commas.
        </p>
      </div>
    </div>
  );
}
