import { useEffect, useState } from 'react';
import { Spinner } from './ui';

const QUIPS = {
  discover: [
    "Knocking on every subscription's door…",
    'Checking under the VNets…',
    'Asking the packets where they have been…',
    'Counting bricks in every firewall…',
    'Following the default route…',
    'Peeking behind the NAT…',
    'Pinging. Still pinging…',
    'Shaking hands with TCP. Three times, to be polite…',
    'Waiting for DNS to propagate. Kidding…',
    "Reading route tables so you don't have to…",
  ],
  policy: [
    'Unrolling the rule base…',
    'Sorting rules by priority, then by drama…',
    'Untangling IP groups…',
    'Asking 0.0.0.0/0 to please sit down…',
    'Dusting off rule collection groups…',
  ],
  deploy: [
    'Measuring your address space…',
    'Looking for a spare /26 between the couch cushions…',
    'Asking regions if they have a vacancy…',
    'Counting virtual hubs…',
  ],
  start: ['Warming up the packets…', 'Polishing the firewall bricks…'],
} as const;

type QuipTopic = keyof typeof QUIPS;

/** A spinner with rotating, lightly humorous status lines while Azure is being queried. */
export function QuipSpinner({
  topic,
  slowAfterMs = 20000,
  slowHint = 'Still going. Tenants with lots of subscriptions take a little longer.',
}: {
  topic: QuipTopic;
  slowAfterMs?: number;
  slowHint?: string;
}) {
  const lines = QUIPS[topic];
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * lines.length),
  );
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const rotate = setInterval(
      () => setIndex((i) => (i + 1) % lines.length),
      2600,
    );
    const hint = setTimeout(() => setSlow(true), slowAfterMs);
    return () => {
      clearInterval(rotate);
      clearTimeout(hint);
    };
  }, [lines.length, slowAfterMs]);

  return (
    <div role="status" aria-live="polite">
      <Spinner label={lines[index % lines.length]} />
      {slow && <p className="ml-6 mt-1 text-xs text-fg-faint">{slowHint}</p>}
    </div>
  );
}
