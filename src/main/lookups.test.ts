import { beforeEach, describe, expect, it, vi } from 'vitest';

const azure = vi.hoisted(() => ({
  graphQuery: vi.fn(),
  network: vi.fn(),
}));
vi.mock('./auth', () => ({ onSignOut: () => {} }));
vi.mock('./azure', () => ({
  ...azure,
  describeAzureError: (e: Error) => e.message,
}));

const { getRuleLookups, clearLookupCache } = await import('./lookups');

const SUB = '00000000-1111-2222-3333-444444444444';
const emptyPages = async function* () {};
const client = {
  serviceTags: { list: async () => ({ values: [] }) },
  azureFirewallFqdnTags: { listAll: emptyPages },
  webCategories: { listBySubscription: emptyPages },
};

beforeEach(() => {
  clearLookupCache();
  azure.graphQuery.mockReset().mockResolvedValue([]);
  azure.network.mockReset().mockReturnValue(client);
});

describe('rule lookups cache', () => {
  it('reuses a successful result', async () => {
    await getRuleLookups(SUB, 'eastus');
    await getRuleLookups(SUB, 'EastUS');
    expect(azure.network).toHaveBeenCalledTimes(1);
  });

  it("doesn't cache partial failures", async () => {
    azure.graphQuery.mockRejectedValueOnce(new Error('denied'));
    const first = await getRuleLookups(SUB, 'eastus');
    expect(first.errors).toEqual(["IP Groups couldn't be listed: denied"]);
    await getRuleLookups(SUB, 'eastus');
    expect(azure.network).toHaveBeenCalledTimes(2);
  });

  it("doesn't cache a load that fails outright", async () => {
    azure.network.mockImplementationOnce(() => {
      throw new Error('You are signed out.');
    });
    await expect(getRuleLookups(SUB, 'eastus')).rejects.toThrow(/signed out/);
    await expect(getRuleLookups(SUB, 'eastus')).resolves.toMatchObject({
      errors: [],
    });
  });
});
