import { useEffect, useState } from 'react';
import { AlertTriangle, Route } from 'lucide-react';
import { SelectMenu } from '../components/Dropdown';
import { EmptyState, Spinner } from '../components/ui';
import { errorMessage } from '../components/Toast';
import { RuleLookupsContext, type LookupsState } from '../lookups';
import { loadPolicyChain } from '../policyChain';
import { sameResourceId } from '../../shared/resourceId';
import type { FlowHit, PolicyLayer } from '../../shared/flow';
import type { PolicyOption } from './PolicyEditor';
import { FlowTester } from './RuleTools';

/**
 * "Would this traffic be allowed?" for one policy: its rules plus everything it inherits, using
 * the draft (uncommitted changes included).
 */
export function FlowTesterPage({
  policies,
  initialPolicyId,
  reloadKey,
  onOpenRule,
}: {
  policies: PolicyOption[];
  initialPolicyId?: string;
  reloadKey: number;
  /** Shows a matched rule in the rule editor. */
  onOpenRule: (policyId: string, hit: FlowHit) => void;
}) {
  const [policyId, setPolicyId] = useState(
    () =>
      policies.find((p) => sameResourceId(p.id, initialPolicyId))?.id ??
      policies[0]?.id,
  );
  const [layers, setLayers] = useState<PolicyLayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [parentNote, setParentNote] = useState('');
  const [lookups, setLookups] = useState<LookupsState>({ loading: false });

  useEffect(() => {
    if (!policies.some((p) => sameResourceId(p.id, policyId)))
      setPolicyId(policies[0]?.id);
  }, [policies, policyId]);

  useEffect(() => {
    if (!policyId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setParentNote('');
    (async () => {
      try {
        const {
          view: v,
          parents,
          parentError,
        } = await loadPolicyChain(policyId);
        if (cancelled) return;
        if (parentError)
          setParentNote(
            `Couldn't load the parent policy ${parentError.name} (${parentError.message}), so its rules aren't included.`,
          );
        // Parent policies are processed first, so they come first.
        setLayers([
          ...[...parents].reverse().map((p) => ({
            policyId: p.policy.id,
            policyName: p.policy.name,
            inherited: true,
            groups: p.groups.map((g) => g.group),
          })),
          {
            policyId: v.policy.id,
            policyName: v.policy.name,
            inherited: false,
            groups: v.groups.map((g) => g.group),
          },
        ]);
        // IP Group members let the tester resolve rules that use IP Groups.
        const region = v.policy.location?.toLowerCase().replace(/\s+/g, '');
        if (region) {
          setLookups((l) => ({ ...l, loading: true }));
          window.api
            .getRuleLookups(v.policy.subscriptionId, region)
            .then(
              (data) =>
                !cancelled && setLookups({ lookups: data, loading: false }),
            )
            .catch(() => !cancelled && setLookups({ loading: false }));
        }
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err));
          setLayers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [policyId, reloadKey]);

  const ruleCount = layers.reduce(
    (n, l) =>
      n +
      l.groups.reduce(
        (m, g) => m + g.ruleCollections.reduce((k, c) => k + c.rules.length, 0),
        0,
      ),
    0,
  );
  const inherited = layers.filter((l) => l.inherited);

  return (
    <RuleLookupsContext.Provider value={lookups}>
      <div className="flex h-full flex-col">
        <div className="flex items-end gap-3 border-b border-line px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Flow tester</h1>
            <p className="mt-1 text-sm text-fg-muted">
              Which rule would handle this traffic? Checks a policy's rules in
              Azure's processing order, including uncommitted changes in your
              draft.
            </p>
          </div>
        </div>
        {!policies.length ? (
          <EmptyState icon={<Route size={22} />} title="No policies to test">
            Use Choose firewalls to show on the Firewalls page to show firewalls
            that use a firewall policy.
          </EmptyState>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
            <div className="max-w-4xl space-y-5">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="label">Policy</span>
                  <SelectMenu
                    label="Firewall policy"
                    widthClass="w-80"
                    searchable
                    value={policyId}
                    onChange={setPolicyId}
                    options={policies.map((p) => ({
                      value: p.id,
                      label: p.name,
                      hint: p.firewallNames.join(', '),
                    }))}
                  />
                </label>
                <p className="pb-1.5 text-xs text-fg-faint">
                  {loading ? (
                    <Spinner label="Loading rules…" />
                  ) : layers.length ? (
                    <>
                      {ruleCount} rules
                      {inherited.length > 0 &&
                        `, including those inherited from ${inherited.map((l) => l.policyName).join(' → ')}`}
                      .
                    </>
                  ) : null}
                </p>
              </div>
              {parentNote && (
                <p className="flex items-start gap-2 border-l-2 border-candidate bg-candidate/10 px-3 py-2 text-xs text-fg-muted">
                  <AlertTriangle
                    size={14}
                    className="mt-0.5 shrink-0 text-candidate"
                  />
                  {parentNote}
                </p>
              )}
              {error ? (
                <p className="border-l-2 border-deny bg-deny/10 px-3 py-2 text-sm">
                  Couldn't load this policy: {error}
                </p>
              ) : (
                layers.length > 0 &&
                policyId && (
                  <FlowTester
                    key={policyId}
                    layers={layers}
                    onOpenHit={(hit) => onOpenRule(policyId, hit)}
                  />
                )
              )}
            </div>
          </div>
        )}
      </div>
    </RuleLookupsContext.Provider>
  );
}
