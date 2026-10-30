import { useCallback } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import type { MenuItem } from './Dropdown';
import { errorMessage, useToast } from './Toast';

/** Builds the "Open in Azure portal" and "Copy resource ID" menu items for a resource. */
export function useResourceMenuItems(): (resourceId: string) => MenuItem[] {
  const toast = useToast();
  return useCallback(
    (resourceId: string) => [
      {
        label: 'Open in Azure portal',
        icon: <ExternalLink size={14} />,
        onSelect: () =>
          void window.api
            .openInPortal(resourceId)
            .catch((err) => toast('error', errorMessage(err))),
      },
      {
        label: 'Copy resource ID',
        icon: <Copy size={14} />,
        onSelect: () =>
          void navigator.clipboard
            .writeText(resourceId)
            .catch((err) =>
              toast('error', `Couldn't copy: ${errorMessage(err)}`),
            ),
      },
    ],
    [toast],
  );
}
