import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<(kind: ToastKind, message: string) => void>(
  () => undefined,
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) =>
    setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 4000);
  }, []);

  const icon = {
    success: <CheckCircle2 size={16} className="text-allow" />,
    error: <AlertTriangle size={16} className="text-deny" />,
    info: <Info size={16} className="text-azure" />,
  };

  const edge = {
    success: 'border-l-allow',
    error: 'border-l-deny',
    info: 'border-l-azure',
  };

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-16 right-4 z-50 flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-2 border border-l-2 border-line bg-ink-850 p-3 shadow-[0_12px_30px_rgba(4,10,20,0.5)] ${edge[t.kind]}`}
          >
            {icon[t.kind]}
            <p className="flex-1 whitespace-pre-line break-words text-sm">
              {t.message}
            </p>
            <button
              type="button"
              className="text-fg-muted hover:text-fg"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
