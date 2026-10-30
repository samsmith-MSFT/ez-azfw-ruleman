import { describe, it, expect } from 'vitest';
import { explainAzureError } from './azureErrors';

describe('explainAzureError', () => {
  it('explains offer-restricted subscriptions that block Microsoft.Network', () => {
    const msg =
      "The subscription is not registered for the resource type 'azureFirewalls' in namespace 'Microsoft.Network'. List of permitted provider namespaces is 'Microsoft.Resources,Microsoft.Authorization,Microsoft.Education'.";
    const text = explainAzureError(undefined, msg);
    expect(text).toContain('networking (Microsoft.Network)');
    expect(text).toContain('Choose a different subscription');
  });

  it('explains an unregistered provider', () => {
    expect(
      explainAzureError(
        'MissingSubscriptionRegistration',
        "The subscription is not registered to use namespace 'Microsoft.Network'.",
      ),
    ).toContain("isn't registered");
  });

  it('names the blocking policy when present', () => {
    expect(
      explainAzureError(
        'RequestDisallowedByPolicy',
        "Resource 'fw' was disallowed by policy assignment 'Allowed locations'.",
      ),
    ).toContain('(Allowed locations)');
  });

  it('includes the missing action for authorization failures', () => {
    expect(
      explainAzureError(
        'AuthorizationFailed',
        "The client 'x' does not have authorization to perform action 'Microsoft.Network/azureFirewalls/write' over scope '/subscriptions/1'.",
      ),
    ).toContain('Microsoft.Network/azureFirewalls/write');
  });

  it('returns undefined for unknown errors', () => {
    expect(explainAzureError('SomethingElse', 'Boom')).toBeUndefined();
  });
});
