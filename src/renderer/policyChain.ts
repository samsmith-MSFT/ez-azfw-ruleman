import type { PolicyView } from '../shared/types';
import { resourceName } from '../shared/resourceId';
import { errorMessage } from './components/Toast';

/** How many levels of parent (base) policies are followed. */
export const MAX_POLICY_DEPTH = 5;

export interface PolicyChain {
  view: PolicyView;
  /** Parent policies, nearest first. Their rules are processed before the policy's own. */
  parents: PolicyView[];
  /** Set when a parent couldn't be loaded; the chain stops there. */
  parentError?: { name: string; message: string };
}

/** Loads a policy and the parent policies it inherits from. Throws if the policy itself fails. */
export async function loadPolicyChain(policyId: string): Promise<PolicyChain> {
  const view = await window.api.getPolicy(policyId);
  const parents: PolicyView[] = [];
  let base = view.policy.basePolicyId;
  while (base && parents.length < MAX_POLICY_DEPTH) {
    const id = base;
    try {
      const parent = await window.api.getPolicy(id);
      parents.push(parent);
      base = parent.policy.basePolicyId;
    } catch (err) {
      return {
        view,
        parents,
        parentError: { name: resourceName(id), message: errorMessage(err) },
      };
    }
  }
  return { view, parents };
}
