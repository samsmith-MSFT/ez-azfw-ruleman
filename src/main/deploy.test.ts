import { describe, expect, it, vi } from 'vitest';

const deployments = vi.hoisted(() => ({
  validate: vi.fn(),
  createOrUpdate: vi.fn(),
  get: vi.fn(),
}));
vi.mock('@azure/arm-resourcesdeployments', () => ({
  DeploymentsClient: class {
    deployments = deployments;
    deploymentOperations = { list: async function* () {} };
  },
}));
vi.mock('@azure/arm-resources', () => ({
  ResourceManagementClient: class {
    providers = {
      get: async () => ({ registrationState: 'Registered', resourceTypes: [] }),
    };
  },
}));
vi.mock('./auth', () => ({ getCredential: () => ({}) }));
vi.mock('./azure', () => ({ graphQuery: async () => [] }));
vi.mock('./store', () => ({ updateState: () => {} }));
vi.mock('../shared/deploy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/deploy')>()),
  validateDeployRequest: () => [],
  buildFirewallTemplate: () => ({
    newResourceGroups: [],
    resourceGroup: 'rg',
    location: 'eastus',
    template: {},
    firewallId: 'fw',
  }),
}));

const { deployFirewall, deploymentNameFor } = await import('./deploy');

describe('deploymentNameFor', () => {
  it('keeps the timestamp when the firewall name is long', () => {
    const name = deploymentNameFor('f'.repeat(80), 1234567890123);
    expect(name).toHaveLength(64);
    expect(name.endsWith('-1234567890123')).toBe(true);
    expect(deploymentNameFor('fw1', 1)).toBe('ezazfw-fw1-1');
  });
});

describe('deployFirewall', () => {
  it('reports why Azure rejected the deployment, not the follow-up lookup', async () => {
    deployments.validate.mockResolvedValue({});
    deployments.createOrUpdate.mockReturnValue(
      Promise.reject(
        Object.assign(new Error('The template is not valid.'), {
          code: 'SomethingUnusual',
        }),
      ),
    );
    deployments.get.mockRejectedValue(
      Object.assign(new Error('Deployment could not be found.'), {
        code: 'DeploymentNotFound',
      }),
    );
    const result = await deployFirewall(
      { subscriptionId: 'sub', name: 'fw' } as never,
      () => {},
    );
    expect(result.phase).toBe('failed');
    expect(result.error).toMatch(/template is not valid/);
  });
});
