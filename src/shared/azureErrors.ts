// Turns Azure Resource Manager error codes/messages into plain-language explanations with a next step.

const FRIENDLY_NAMESPACES: Record<string, string> = {
  'microsoft.network': 'networking (Microsoft.Network)',
  'microsoft.compute': 'virtual machines (Microsoft.Compute)',
  'microsoft.resourcegraph': 'Azure Resource Graph (Microsoft.ResourceGraph)',
};

const describeNamespace = (ns: string) =>
  FRIENDLY_NAMESPACES[ns.toLowerCase()] ?? ns;

/**
 * Returns a user-facing explanation for a known Azure error, or undefined when the error isn't
 * recognised (callers then show Azure's own message).
 */
export function explainAzureError(
  code?: string,
  message?: string,
): string | undefined {
  const msg = message ?? '';

  // Offer-restricted subscriptions (education, Imagine, student, some trial offers).
  const permitted = /List of permitted provider namespaces is '([^']*)'/i.exec(
    msg,
  );
  if (permitted) {
    const ns =
      /namespace '([^']+)'/i.exec(msg)?.[1] ??
      /'(Microsoft\.[A-Za-z]+)'/.exec(msg)?.[1];
    const what = ns ? describeNamespace(ns) : 'this kind of resource';
    return `This subscription's offer doesn't allow ${what}. Education, Imagine, student and some trial subscriptions only permit a fixed set of resource types. Choose a different subscription.`;
  }

  switch (code) {
    case 'MissingSubscriptionRegistration': {
      const ns = /namespace '?([A-Za-z.]+)'?/i.exec(msg)?.[1];
      return `${ns ? describeNamespace(ns) : 'A required resource provider'} isn't registered for this subscription yet. Register it in the Azure portal under Subscriptions, Resource providers, then try again.`;
    }
    case 'NoRegisteredProviderFound':
      return "Azure doesn't offer this resource in the selected region or API version. Choose another region.";
    case 'RequestDisallowedByPolicy': {
      const policy = /policy (?:assignment )?'([^']+)'/i.exec(msg)?.[1];
      return `An Azure Policy${policy ? ` (${policy})` : ''} blocked this request. Ask your Azure administrator for an exemption, or choose settings the policy allows.`;
    }
    case 'RequestDisallowedByAzure':
      return "Azure doesn't allow this subscription to create resources in the selected region. Some subscriptions are limited to a few regions; try another region.";
    case 'QuotaExceeded':
    case 'PublicIPCountLimitReached':
    case 'SubscriptionPublicIPCountLimitReached':
      return `This would exceed a quota for the subscription or region. ${msg} Request a quota increase in the Azure portal or choose another region.`.trim();
    case 'AuthorizationFailed': {
      const action = /perform action '([^']+)'/i.exec(msg)?.[1];
      return `Your account doesn't have permission${action ? ` for ${action}` : ''}. Ask for a role such as Network Contributor or Contributor on the subscription or resource group.`;
    }
    case 'SubscriptionNotFound':
      return "The subscription wasn't found. It may be disabled or in another directory.";
    case 'ReadOnlyDisabledSubscription':
    case 'SubscriptionDisabled':
      return 'This subscription is disabled or read-only, so nothing can be created in it. Check its status in the Azure portal.';
    default:
      return undefined;
  }
}
