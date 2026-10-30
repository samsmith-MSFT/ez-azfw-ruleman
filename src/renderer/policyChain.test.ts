import { afterEach, describe, it, expect, vi } from 'vitest';
import { loadPolicyChain, MAX_POLICY_DEPTH } from './policyChain';
import type { PolicyView } from '../shared/types';

const ID = (name: string) =>
  `/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/firewallPolicies/${name}`;

const view = (name: string, base?: string) =>
  ({
    policy: { id: ID(name), name, basePolicyId: base && ID(base) },
    groups: [],
  }) as unknown as PolicyView;

function stubPolicies(policies: Record<string, PolicyView | Error>) {
  const getPolicy = vi.fn(async (id: string) => {
    const p = policies[id.split('/').at(-1)!];
    if (!p) throw new Error(`No policy ${id}`);
    if (p instanceof Error) throw p;
    return p;
  });
  vi.stubGlobal('window', { api: { getPolicy } });
  return getPolicy;
}

afterEach(() => vi.unstubAllGlobals());

describe('loadPolicyChain', () => {
  it('loads the parents, nearest first', async () => {
    stubPolicies({
      child: view('child', 'parent'),
      parent: view('parent', 'root'),
      root: view('root'),
    });
    const chain = await loadPolicyChain(ID('child'));
    expect(chain.view.policy.name).toBe('child');
    expect(chain.parents.map((p) => p.policy.name)).toEqual(['parent', 'root']);
    expect(chain.parentError).toBeUndefined();
  });

  it('stops at a parent that fails to load and says which', async () => {
    stubPolicies({
      child: view('child', 'parent'),
      parent: new Error('Forbidden'),
    });
    const chain = await loadPolicyChain(ID('child'));
    expect(chain.parents).toEqual([]);
    expect(chain.parentError).toEqual({ name: 'parent', message: 'Forbidden' });
  });

  it('fails when the policy itself fails', async () => {
    stubPolicies({ child: new Error('Not found') });
    await expect(loadPolicyChain(ID('child'))).rejects.toThrow('Not found');
  });

  it('stops following a cycle', async () => {
    const getPolicy = stubPolicies({ a: view('a', 'b'), b: view('b', 'a') });
    const chain = await loadPolicyChain(ID('a'));
    expect(chain.parents).toHaveLength(MAX_POLICY_DEPTH);
    expect(getPolicy).toHaveBeenCalledTimes(MAX_POLICY_DEPTH + 1);
  });
});
