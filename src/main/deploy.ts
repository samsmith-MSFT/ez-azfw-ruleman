import { ResourceManagementClient } from '@azure/arm-resources';
import { DeploymentsClient } from '@azure/arm-resourcesdeployments';
import { getCredential } from './auth';
import { graphQuery } from './azure';
import { updateState } from './store';
import { explainAzureError } from '../shared/azureErrors';
import {
  buildFirewallTemplate,
  validateDeployRequest,
  type DeployContext,
  type DeployOperation,
  type DeployProgress,
  type DeployRequest,
  type FirewallTier,
  type NetworkAvailability,
  type SubscriptionInfo,
  APP_TAG,
} from '../shared/deploy';

const POLL_MS = 8000;

function query<T>(
  subscriptionId: string | undefined,
  kql: string,
): Promise<T[]> {
  return graphQuery<T>(kql, subscriptionId);
}

export function listSubscriptions(): Promise<SubscriptionInfo[]> {
  return query<SubscriptionInfo>(
    undefined,
    `resourcecontainers
     | where type =~ 'microsoft.resources/subscriptions'
     | project subscriptionId, name
     | order by name asc`,
  );
}

const normalizeLocation = (l: string) => l.toLowerCase().replace(/\s+/g, '');

/**
 * Checks whether the subscription can use Azure networking at all, and where Azure Firewall is
 * offered. Never throws: problems become a state the wizard can explain.
 */
async function networkStatus(subscriptionId: string): Promise<{
  network: NetworkAvailability;
  locations: string[];
  locationNames: Record<string, string>;
  locationZones?: Record<string, string[]>;
}> {
  try {
    const client = new ResourceManagementClient(
      getCredential(),
      subscriptionId,
    );
    const provider = await client.providers.get('Microsoft.Network');
    const type = provider.resourceTypes?.find(
      (t) => t.resourceType?.toLowerCase() === 'azurefirewalls',
    );
    // The provider lists display names ("East US"); deployments use the short form ("eastus").
    const locationNames: Record<string, string> = {};
    for (const display of type?.locations ?? []) {
      locationNames[normalizeLocation(display)] = display;
    }
    const locations = Object.keys(locationNames).sort((a, b) =>
      locationNames[a].localeCompare(locationNames[b]),
    );
    // Zone support per region for Azure Firewall, as reported for this subscription. Regions not
    // listed have no zones. If Azure returns no zone data at all, leave it unknown.
    let locationZones: Record<string, string[]> | undefined;
    if (type?.zoneMappings) {
      locationZones = {};
      for (const m of type.zoneMappings) {
        if (m.location && m.zones?.length) {
          locationZones[normalizeLocation(m.location)] = [...m.zones].sort();
        }
      }
    }
    const state = (provider.registrationState ?? '').toLowerCase();
    return {
      locations,
      locationNames,
      locationZones,
      network: {
        state:
          state === 'registered'
            ? 'registered'
            : state === 'registering'
              ? 'registering'
              : 'not-registered',
      },
    };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const explained = explainAzureError(e.code, e.message);
    const blocked = /permitted provider namespaces/i.test(e.message ?? '');
    return {
      locations: [],
      locationNames: {},
      network: {
        state: blocked ? 'blocked' : 'unknown',
        message: explained ?? e.message ?? String(err),
      },
    };
  }
}

/** Registers Microsoft.Network for the subscription and waits (up to ~2 minutes) for it to finish. */
export async function registerNetworkProvider(
  subscriptionId: string,
): Promise<NetworkAvailability> {
  const client = new ResourceManagementClient(getCredential(), subscriptionId);
  await client.providers.register('Microsoft.Network');
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const p = await client.providers.get('Microsoft.Network');
    if (p.registrationState?.toLowerCase() === 'registered')
      return { state: 'registered' };
  }
  return {
    state: 'registering',
    message:
      'Azure is still registering networking for this subscription. Try again in a minute.',
  };
}

export async function getDeployContext(
  subscriptionId: string,
): Promise<DeployContext> {
  const [resourceGroups, vnets, hubs, policies, networkStatusResult] =
    await Promise.all([
      query<{ name: string; location: string }>(
        subscriptionId,
        `resourcecontainers
       | where type =~ 'microsoft.resources/subscriptions/resourcegroups'
       | project name, location
       | order by name asc`,
      ),
      query<{
        id: string;
        name: string;
        resourceGroup: string;
        location: string;
        addressPrefixes?: string[];
        subnets?: {
          name: string;
          properties?: { addressPrefix?: string; addressPrefixes?: string[] };
        }[];
      }>(
        subscriptionId,
        `resources
       | where type =~ 'microsoft.network/virtualnetworks'
       | project id, name, resourceGroup, location,
                 addressPrefixes = properties.addressSpace.addressPrefixes,
                 subnets = properties.subnets
       | order by name asc`,
      ),
      query<{
        id: string;
        name: string;
        resourceGroup: string;
        location: string;
        firewallId?: string;
        virtualWanId?: string;
      }>(
        subscriptionId,
        `resources
       | where type =~ 'microsoft.network/virtualhubs'
       | project id, name, resourceGroup, location,
                 firewallId = tostring(properties.azureFirewall.id),
                 virtualWanId = tostring(properties.virtualWan.id)
       | order by name asc`,
      ),
      query<{
        id: string;
        name: string;
        resourceGroup: string;
        location: string;
        tier?: string;
      }>(
        subscriptionId,
        `resources
       | where type =~ 'microsoft.network/firewallpolicies'
       | project id, name, resourceGroup, location, tier = tostring(properties.sku.tier)
       | order by name asc`,
      ),
      networkStatus(subscriptionId),
    ]);
  const { network, locations, locationNames, locationZones } =
    networkStatusResult;

  return {
    subscriptionId,
    network,
    resourceGroups,
    locations,
    locationNames,
    locationZones,
    vnets: vnets.map((v) => ({
      id: v.id,
      name: v.name,
      resourceGroup: v.resourceGroup,
      location: v.location,
      addressPrefixes: v.addressPrefixes ?? [],
      subnets: (v.subnets ?? []).map((s) => ({
        name: s.name,
        prefix:
          s.properties?.addressPrefix ?? s.properties?.addressPrefixes?.[0],
      })),
    })),
    hubs: hubs.map((h) => ({
      id: h.id,
      name: h.name,
      resourceGroup: h.resourceGroup,
      location: h.location,
      firewallId: h.firewallId || undefined,
      virtualWanName: h.virtualWanId
        ? h.virtualWanId.split('/').at(-1)
        : undefined,
    })),
    policies: policies.map((p) => ({
      id: p.id,
      name: p.name,
      resourceGroup: p.resourceGroup,
      location: p.location,
      // Policies created before SKUs existed have no tier and behave as Standard.
      tier: (p.tier || 'Standard') as FirewallTier,
    })),
  };
}

interface ArmError {
  code?: string;
  message?: string;
  details?: readonly ArmError[];
}

/** Flattens nested ARM errors into readable lines (the innermost details are the useful ones). */
function flattenError(e: ArmError | undefined): string {
  if (!e) return 'Unknown error.';
  const lines: string[] = [];
  const walk = (x: ArmError) => {
    if (x.details?.length) x.details.forEach(walk);
    else
      lines.push(
        explainAzureError(x.code, x.message) ??
          `${x.code ? `${x.code}: ` : ''}${x.message ?? ''}`.trim(),
      );
  };
  walk(e);
  return [...new Set(lines)].join('\n') || e.message || 'Unknown error.';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lists a deployment's operations, expanding nested deployments (VNet or policy in other groups). */
async function listOperations(
  client: DeploymentsClient,
  resourceGroup: string,
  deploymentName: string,
  depth = 0,
): Promise<DeployOperation[]> {
  const operations: DeployOperation[] = [];
  for await (const op of client.deploymentOperations.list(
    resourceGroup,
    deploymentName,
  )) {
    const p = op.properties;
    const target = p?.targetResource;
    if (!p || !target?.resourceType) continue;
    if (
      depth === 0 &&
      target.resourceType.toLowerCase() === 'microsoft.resources/deployments' &&
      target.id &&
      target.resourceName
    ) {
      const nestedGroup = target.id.split('/')[4];
      try {
        operations.push(
          ...(await listOperations(
            client,
            nestedGroup,
            target.resourceName,
            depth + 1,
          )),
        );
        continue;
      } catch {
        // Fall back to showing the nested deployment itself.
      }
    }
    operations.push({
      resourceType: target.resourceType,
      resourceName: target.resourceName ?? '',
      state: p.provisioningState ?? 'Running',
      error: p.statusMessage?.error
        ? flattenError(p.statusMessage.error)
        : undefined,
    });
  }
  return operations;
}

/** Deployment names are limited to 64 characters; shorten the firewall name, not the timestamp. */
export function deploymentNameFor(
  firewallName: string,
  now = Date.now(),
): string {
  const suffix = `-${now}`;
  return `ezazfw-${firewallName}`.slice(0, 64 - suffix.length) + suffix;
}

let running = false;

function addManaged(firewallId: string) {
  updateState((s) => {
    if (
      !s.managedFirewallIds.some(
        (id) => id.toLowerCase() === firewallId.toLowerCase(),
      )
    )
      s.managedFirewallIds.push(firewallId);
  });
}

export async function deployFirewall(
  req: DeployRequest,
  onProgress: (p: DeployProgress) => void,
): Promise<DeployProgress> {
  if (running) throw new Error('A firewall deployment is already running.');
  running = true;
  const progress: DeployProgress = {
    firewallName: req.name,
    phase: 'preparing',
    message: 'Checking your environment…',
    startedAt: new Date().toISOString(),
    operations: [],
  };
  const emit = (patch: Partial<DeployProgress>) => {
    Object.assign(progress, patch);
    onProgress({ ...progress, operations: [...progress.operations] });
  };

  try {
    emit({});
    // Re-read the environment so validation uses current state, not what the wizard loaded earlier.
    const ctx = await getDeployContext(req.subscriptionId);
    const errors = validateDeployRequest(req, ctx);
    if (errors.length) throw new Error(errors.join('\n'));
    const credential = getCredential();

    const client = new DeploymentsClient(credential, req.subscriptionId);
    const deploymentName = deploymentNameFor(req.name);
    const plan = buildFirewallTemplate(req, ctx, deploymentName);

    if (plan.newResourceGroups.length) {
      const rm = new ResourceManagementClient(credential, req.subscriptionId);
      for (const rg of plan.newResourceGroups) {
        emit({ message: `Creating resource group ${rg}…` });
        await rm.resourceGroups.createOrUpdate(rg, {
          location: plan.location,
          tags: { createdBy: APP_TAG, ...req.tags },
        });
      }
    }

    const deploymentId = `/subscriptions/${req.subscriptionId}/resourceGroups/${plan.resourceGroup}/providers/Microsoft.Resources/deployments/${deploymentName}`;
    const body = {
      properties: { template: plan.template, mode: 'Incremental' as const },
    };

    emit({
      phase: 'validating',
      message:
        'Azure is validating the deployment (quota, region, zones, permissions)…',
    });
    const validation = await client.deployments.validate(
      plan.resourceGroup,
      deploymentName,
      body,
    );
    if (validation.error) throw new Error(flattenError(validation.error));

    emit({
      phase: 'deploying',
      deploymentId,
      message:
        'Deploying. Azure Firewall usually takes 5-15 minutes; you can keep working.',
    });

    let finished = false;
    let failure: unknown;
    const poller = client.deployments.createOrUpdate(
      plan.resourceGroup,
      deploymentName,
      body,
    );
    const done = Promise.resolve(poller).then(
      () => (finished = true),
      (err) => {
        failure = err;
        finished = true;
      },
    );

    while (!finished) {
      await Promise.race([done, sleep(POLL_MS)]);
      try {
        const operations = await listOperations(
          client,
          plan.resourceGroup,
          deploymentName,
        );
        emit({ operations: operations.reverse() });
      } catch {
        // Operation listing is best-effort; the deployment itself is tracked by the poller.
      }
    }

    // When the deployment was rejected outright there may be nothing to read back; report the
    // rejection rather than the follow-up "not found".
    const result = await client.deployments
      .get(plan.resourceGroup, deploymentName)
      .catch((err: unknown) => {
        throw failure ?? err;
      });
    const state = result.properties?.provisioningState;
    if (failure || state !== 'Succeeded') {
      if (result.properties?.error)
        throw new Error(flattenError(result.properties.error));
      throw failure ?? new Error(`Deployment ended in state ${state}.`);
    }

    if (req.addToManaged) addManaged(plan.firewallId);

    emit({
      phase: 'succeeded',
      firewallId: plan.firewallId,
      message: `${req.name} was deployed.`,
    });
    return { ...progress };
  } catch (err) {
    const e = err as ArmError;
    const message = e?.details
      ? flattenError(e)
      : (explainAzureError(e?.code, e?.message) ?? (err as Error).message);
    emit({ phase: 'failed', error: message, message: 'Deployment failed.' });
    return { ...progress };
  } finally {
    running = false;
  }
}
