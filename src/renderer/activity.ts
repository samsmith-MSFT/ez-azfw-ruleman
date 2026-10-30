import { useCallback, useEffect, useState } from 'react';
import type { DeployProgress } from '../shared/deploy';
import type { CommitProgress } from '../shared/types';
import { readSetting, writeSetting } from './storage';

/** A deployment as remembered in the activity list. */
export interface DeployActivity {
  key: string;
  progress: DeployProgress;
  /** Last time this item changed; finished items newer than `seenAt` count as unread. */
  updatedAt: string;
  /**
   * The app was closed while this deployment was still running, so its final state is unknown
   * here (Azure keeps running it).
   */
  stale?: boolean;
}

/** A commit as remembered in the activity list (its live progress, then its outcome). */
export interface CommitActivity {
  key: string;
  progress: CommitProgress;
  updatedAt: string;
  /** The app was closed mid-commit; the groups still "in progress" may or may not have saved. */
  stale?: boolean;
}

const STORE = 'ez-azfw-ruleman.activity.v1';
const MAX_ITEMS = 25;

interface Stored {
  deployments: DeployActivity[];
  commits: CommitActivity[];
  /** Activity finishing after this time shows as unread. */
  seenAt: string;
  /** Activity started before this time is hidden ("Clear"). */
  clearedAt?: string;
}

export const deployKey = (p: DeployProgress) =>
  `${p.startedAt}|${p.firewallName}`;

export const isFinished = (p: DeployProgress) =>
  p.phase === 'succeeded' || p.phase === 'failed';

/** "just now", "5 min ago", "3 h ago", "2 d ago", then the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d} d ago` : new Date(iso).toLocaleDateString();
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/**
 * Reads the stored activity, dropping anything malformed. Items still running when the app was
 * last closed are marked stale: nothing is tracking them any more.
 */
export function parseActivity(
  raw: string | null,
  now = new Date().toISOString(),
): Stored {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? '');
  } catch {
    data = undefined;
  }
  if (!isObject(data)) return { deployments: [], commits: [], seenAt: now };
  // Keeps entries with the fields the activity menu relies on.
  const list = <T>(
    v: unknown,
    progressOk: (p: Record<string, unknown>) => boolean,
  ) =>
    (Array.isArray(v) ? v : []).filter(
      (item) =>
        isObject(item) &&
        typeof item.key === 'string' &&
        typeof item.updatedAt === 'string' &&
        isObject(item.progress) &&
        typeof item.progress.startedAt === 'string' &&
        progressOk(item.progress),
    ) as T[];
  return {
    deployments: list<DeployActivity>(
      data.deployments,
      (p) => typeof p.firewallName === 'string' && typeof p.phase === 'string',
    ).map((d) => (isFinished(d.progress) ? d : { ...d, stale: true })),
    commits: list<CommitActivity>(data.commits, (p) =>
      Array.isArray(p.groups),
    ).map((c) => (c.progress.done ? c : { ...c, stale: true })),
    seenAt: typeof data.seenAt === 'string' ? data.seenAt : now,
    clearedAt: typeof data.clearedAt === 'string' ? data.clearedAt : undefined,
  };
}

/** Deployment and commit activity for the notifications menu, kept across restarts. */
export function useDeployActivity() {
  const [state, setState] = useState<Stored>(() =>
    parseActivity(readSetting(STORE)),
  );

  useEffect(() => writeSetting(STORE, JSON.stringify(state)), [state]);

  const record = useCallback((progress: DeployProgress) => {
    const key = deployKey(progress);
    setState((s) => ({
      ...s,
      deployments: [
        { key, progress, updatedAt: new Date().toISOString() },
        ...s.deployments.filter((d) => d.key !== key),
      ].slice(0, MAX_ITEMS),
    }));
  }, []);

  const recordCommit = useCallback((progress: CommitProgress) => {
    const key = progress.commitId;
    setState((s) => ({
      ...s,
      commits: [
        { key, progress, updatedAt: new Date().toISOString() },
        ...s.commits.filter((c) => c.key !== key),
      ].slice(0, MAX_ITEMS),
    }));
  }, []);

  const markSeen = useCallback(
    () => setState((s) => ({ ...s, seenAt: new Date().toISOString() })),
    [],
  );

  /** Hides finished and stale items; running deployments stay. */
  const clear = useCallback(
    () =>
      setState((s) => {
        const now = new Date().toISOString();
        return {
          ...s,
          clearedAt: now,
          seenAt: now,
          deployments: s.deployments.filter(
            (d) => !d.stale && !isFinished(d.progress),
          ),
          commits: s.commits.filter((c) => !c.stale && !c.progress.done),
        };
      }),
    [],
  );

  return {
    deployments: state.deployments,
    commits: state.commits,
    seenAt: state.seenAt,
    clearedAt: state.clearedAt,
    record,
    recordCommit,
    markSeen,
    clear,
  };
}
