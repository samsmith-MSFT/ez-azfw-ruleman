import { createContext, useContext, useMemo } from 'react';
import type { KnownValues } from '../shared/ruleDraft';
import type { IpGroupMembers } from '../shared/flow';
import type { IpGroupInfo, RuleLookups } from '../shared/types';

export interface LookupsState {
  lookups?: RuleLookups;
  loading: boolean;
}

export const RuleLookupsContext = createContext<LookupsState>({
  loading: false,
});

export interface Lookups extends LookupsState {
  /** Sets for validating picked values; a set is omitted when that list couldn't be loaded. */
  known: KnownValues;
  ipGroupById: Map<string, IpGroupInfo>;
  ipGroupMembers: IpGroupMembers;
}

const lowerSet = (values: string[]) =>
  new Set(values.map((v) => v.toLowerCase()));

export function useRuleLookups(): Lookups {
  const state = useContext(RuleLookupsContext);
  return useMemo(() => {
    const l = state.lookups;
    const failed = (what: string) =>
      !!l?.errors.some((e) => e.toLowerCase().includes(what));
    const ipGroupById = new Map(
      (l?.ipGroups ?? []).map((g) => [g.id.toLowerCase(), g]),
    );
    // Only check against a list that actually loaded (an empty list may just mean no access).
    const known: KnownValues = l
      ? {
          ipGroups:
            !failed('ip groups') && l.ipGroups.length
              ? lowerSet(l.ipGroups.map((g) => g.id))
              : undefined,
          serviceTags:
            !failed('service tags') && l.serviceTags.length
              ? lowerSet(l.serviceTags.map((t) => t.name))
              : undefined,
          fqdnTags:
            !failed('fqdn tags') && l.fqdnTags.length
              ? lowerSet(l.fqdnTags)
              : undefined,
          webCategories:
            !failed('web categories') && l.webCategories.length
              ? lowerSet(l.webCategories.map((c) => c.name))
              : undefined,
        }
      : {};
    return {
      ...state,
      known,
      ipGroupById,
      ipGroupMembers: new Map(
        [...ipGroupById].map(([id, g]) => [id, g.addresses]),
      ),
    };
  }, [state]);
}
