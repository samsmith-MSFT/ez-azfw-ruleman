import { describe, it, expect } from 'vitest';
import { deployKey, isFinished, parseActivity, timeAgo } from './activity';

const NOW = '2026-01-15T12:00:00.000Z';

const deploy = (phase: string, startedAt = '2026-01-15T10:00:00.000Z') => ({
  key: `${startedAt}|fw-a`,
  updatedAt: startedAt,
  progress: { startedAt, firewallName: 'fw-a', phase, message: '' },
});

const commit = (done: boolean) => ({
  key: 'c1',
  updatedAt: '2026-01-15T11:00:00.000Z',
  progress: {
    commitId: 'c1',
    startedAt: '2026-01-15T11:00:00.000Z',
    groups: [],
    done,
  },
});

describe('parseActivity', () => {
  it('starts empty, with everything seen, when nothing is stored', () => {
    expect(parseActivity(null, NOW)).toEqual({
      deployments: [],
      commits: [],
      seenAt: NOW,
    });
  });

  it('starts empty for corrupt or unexpected data', () => {
    for (const raw of ['{oops', 'null', '42', '[]'])
      expect(parseActivity(raw, NOW)).toEqual({
        deployments: [],
        commits: [],
        seenAt: NOW,
      });
  });

  it('keeps stored times', () => {
    const stored = parseActivity(
      JSON.stringify({
        deployments: [],
        seenAt: '2026-01-01T00:00:00.000Z',
        clearedAt: '2026-01-02T00:00:00.000Z',
      }),
      NOW,
    );
    expect(stored.seenAt).toBe('2026-01-01T00:00:00.000Z');
    expect(stored.clearedAt).toBe('2026-01-02T00:00:00.000Z');
    // Older versions didn't store commits.
    expect(stored.commits).toEqual([]);
  });

  it('marks work that was still running as stale', () => {
    const stored = parseActivity(
      JSON.stringify({
        deployments: [deploy('deploying'), deploy('succeeded', NOW)],
        commits: [commit(false)],
        seenAt: NOW,
      }),
      NOW,
    );
    expect(stored.deployments.map((d) => d.stale)).toEqual([true, undefined]);
    expect(stored.commits[0].stale).toBe(true);
  });

  it('drops malformed entries but keeps the rest', () => {
    const stored = parseActivity(
      JSON.stringify({
        deployments: [
          null,
          { key: 'x' },
          { key: 'y', updatedAt: NOW, progress: 'text' },
          deploy('failed'),
        ],
        commits: [{ ...commit(true), progress: { startedAt: NOW } }],
        seenAt: 5,
      }),
      NOW,
    );
    expect(stored.deployments).toHaveLength(1);
    expect(stored.deployments[0].progress.phase).toBe('failed');
    expect(stored.commits).toEqual([]);
    expect(stored.seenAt).toBe(NOW);
  });
});

describe('deployments', () => {
  it('are finished once they succeed or fail', () => {
    const p = deploy('deploying').progress as never;
    expect(isFinished(p)).toBe(false);
    expect(isFinished({ ...(p as object), phase: 'failed' } as never)).toBe(
      true,
    );
  });

  it('are keyed by start time and firewall', () => {
    expect(deployKey(deploy('deploying').progress as never)).toBe(
      '2026-01-15T10:00:00.000Z|fw-a',
    );
  });
});

describe('timeAgo', () => {
  const now = Date.parse(NOW);
  const ago = (seconds: number) =>
    timeAgo(new Date(now - seconds * 1000).toISOString(), now);

  it('describes recent times in words', () => {
    expect(ago(10)).toBe('just now');
    expect(ago(5 * 60)).toBe('5 min ago');
    expect(ago(3 * 3600)).toBe('3 h ago');
    expect(ago(2 * 86400)).toBe('2 d ago');
  });

  it('treats future times as now', () => {
    expect(ago(-120)).toBe('just now');
  });

  it('shows the date after a week', () => {
    const iso = new Date(now - 10 * 86400 * 1000).toISOString();
    expect(timeAgo(iso, now)).toBe(new Date(iso).toLocaleDateString());
  });
});
