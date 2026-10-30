import { Fragment, useMemo, useState } from 'react';
import {
  ListTree,
  ChevronRight,
  KeyRound,
  Plus,
  Server,
  SlidersHorizontal,
} from 'lucide-react';
import { EllipsisMenu } from '../components/Dropdown';
import { useResourceMenuItems } from '../components/resourceMenu';
import { FilterBar } from '../components/FilterBar';
import { TreeLines, treeIndent } from '../components/TreeLines';
import {
  matchesFilters,
  tagPairs,
  useStoredFilters,
  type FilterValues,
} from '../filters';
import { EmptyState, StatusDot } from '../components/ui';
import { resourceName } from '../../shared/resourceId';
import type { FirewallSummary } from '../../shared/types';

const FIREWALL_FILTERS: FilterValues<FirewallSummary> = {
  name: (f) => [f.name],
  subscription: (f) => [f.subscriptionName ?? f.subscriptionId],
  resourceGroup: (f) => [f.resourceGroup],
  location: (f) => [f.location],
  tag: (f) => tagPairs(f.tags),
};

/** The firewalls being managed, grouped by subscription, with portal-style filters. */
export function Firewalls({
  firewalls,
  onOpenPolicy,
  onChooseFirewalls,
  onDeploy,
}: {
  firewalls: FirewallSummary[];
  /** Opens a policy's rules. */
  onOpenPolicy: (policyId: string) => void;
  onChooseFirewalls: () => void;
  onDeploy: () => void;
}) {
  const { filters, setFilter, clear, active } = useStoredFilters(
    'ez-azfw-ruleman.firewallFilters',
  );
  const resourceMenuItems = useResourceMenuItems();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const shown = useMemo(
    () => firewalls.filter((f) => matchesFilters(f, filters, FIREWALL_FILTERS)),
    [firewalls, filters],
  );
  const bySubscription = useMemo(() => {
    const map = new Map<string, FirewallSummary[]>();
    for (const f of shown) {
      const key = f.subscriptionId.toLowerCase();
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return [...map.values()]
      .map((list) => ({
        id: list[0].subscriptionId,
        name: list[0].subscriptionName ?? list[0].subscriptionId,
        list: list.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [shown]);
  const subscriptions = new Set(firewalls.map((f) => f.subscriptionId)).size;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end gap-3 border-b border-line px-6 pb-4 pt-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">Firewalls</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {firewalls.length
              ? `Managing ${firewalls.length} ${firewalls.length === 1 ? 'firewall' : 'firewalls'} in ${subscriptions} ${subscriptions === 1 ? 'subscription' : 'subscriptions'}.`
              : 'No firewalls are being managed yet.'}
          </p>
        </div>
        <button className="btn-outline" onClick={onChooseFirewalls}>
          <SlidersHorizontal size={15} /> Choose firewalls to show
        </button>
        <button className="btn-outline" onClick={onDeploy}>
          <Plus size={15} /> Deploy firewall
        </button>
      </div>
      <FilterBar
        items={firewalls}
        values={FIREWALL_FILTERS}
        filters={filters}
        onChange={setFilter}
        onClear={clear}
        active={active}
        summary={`${active ? `Showing ${shown.length} of ${firewalls.length}` : `${firewalls.length} ${firewalls.length === 1 ? 'firewall' : 'firewalls'}`} in ${bySubscription.length} ${bySubscription.length === 1 ? 'subscription' : 'subscriptions'}`}
      />
      {!firewalls.length ? (
        <EmptyState icon={<Server size={22} />} title="No firewalls chosen yet">
          Choose which of your Azure Firewalls to show here, or deploy a new
          one.
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn-primary" onClick={onChooseFirewalls}>
              <SlidersHorizontal size={15} /> Choose firewalls to show
            </button>
          </div>
        </EmptyState>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900 text-xs text-fg-muted">
              <tr className="border-b border-line">
                <th className="py-2 pl-6 pr-3 font-medium">Name</th>
                <th className="w-52 px-3 py-2 font-medium">Policy</th>
                <th className="w-32 px-3 py-2 font-medium">Private IP</th>
                <th className="w-44 px-3 py-2 font-medium">Resource group</th>
                <th className="w-24 px-3 py-2 font-medium">Tier</th>
                <th className="w-36 px-3 py-2 font-medium">Deployed in</th>
                <th className="w-40 px-3 py-2 font-medium">Location</th>
                <th className="w-12 py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {bySubscription.map(({ id, name, list }) => {
                const isCollapsed = collapsed.has(id);
                return (
                  <Fragment key={id}>
                    <tr className="border-b border-line bg-ink-850">
                      <td colSpan={8} className="p-0">
                        <button
                          type="button"
                          aria-expanded={!isCollapsed}
                          className="flex w-full items-center gap-2 py-2 pl-6 pr-3 text-left hover:bg-ink-800"
                          onClick={() =>
                            setCollapsed((c) => {
                              const next = new Set(c);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            })
                          }
                        >
                          <ChevronRight
                            size={14}
                            className={`text-fg-muted transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                          />
                          <KeyRound size={14} className="text-fg-muted" />
                          <span className="font-semibold">{name}</span>
                          {name !== id && (
                            <span className="font-mono text-xs text-fg-faint">
                              ({id})
                            </span>
                          )}
                          <span className="text-fg-muted">
                            {list.length}{' '}
                            {list.length === 1 ? 'firewall' : 'firewalls'}
                          </span>
                        </button>
                      </td>
                    </tr>
                    {!isCollapsed &&
                      list.map((f, i) => (
                        <tr
                          key={f.id}
                          className="border-b border-line/60 hover:bg-ink-850"
                        >
                          <td
                            className="relative py-2 pr-3"
                            style={{ paddingLeft: treeIndent(1) }}
                          >
                            <TreeLines depth={1} last={i === list.length - 1} />
                            <div className="flex items-center gap-2">
                              <StatusDot state={f.provisioningState} />
                              <span
                                className="truncate"
                                title={[f.name, ...tagPairs(f.tags)].join('\n')}
                              >
                                {f.name}
                              </span>
                            </div>
                          </td>
                          <td className="truncate px-3 py-2">
                            {f.policyId ? (
                              <button
                                className="truncate text-azure hover:underline"
                                title={`Edit the rules in ${resourceName(f.policyId)}`}
                                onClick={() => onOpenPolicy(f.policyId!)}
                              >
                                {resourceName(f.policyId)}
                              </button>
                            ) : (
                              <span
                                className="text-fg-faint"
                                title="This firewall uses classic rules, which can't be edited here. Migrate it to Firewall Policy to manage its rules."
                              >
                                Classic rules
                              </span>
                            )}
                          </td>
                          <td className="netval px-3 py-2">
                            {f.privateIp ?? '—'}
                          </td>
                          <td
                            className="truncate px-3 py-2 text-fg-muted"
                            title={f.resourceGroup}
                          >
                            {f.resourceGroup}
                          </td>
                          <td className="px-3 py-2 text-fg-muted">
                            {f.skuTier ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-fg-muted">
                            {f.skuName === 'AZFW_Hub'
                              ? 'Virtual WAN hub'
                              : 'Virtual network'}
                          </td>
                          <td className="px-3 py-2 text-fg-muted">
                            {f.location}
                          </td>
                          <td className="py-1.5 pr-4">
                            <EllipsisMenu
                              label={`Actions for ${f.name}`}
                              items={[
                                ...(f.policyId
                                  ? [
                                      {
                                        label: 'Edit rules',
                                        icon: <ListTree size={14} />,
                                        onSelect: () =>
                                          onOpenPolicy(f.policyId!),
                                      },
                                    ]
                                  : []),
                                ...resourceMenuItems(f.id),
                              ]}
                            />
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              {!shown.length && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-6 text-center text-fg-muted"
                  >
                    No firewalls match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
