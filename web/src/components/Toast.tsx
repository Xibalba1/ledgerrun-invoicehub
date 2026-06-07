import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Check } from "./icons";

// Minimal toast layer: the payoff channel for "an invoice just cleared" and other
// optimistic confirmations. popIn + shadow-pop come straight from the design tokens.
type Tone = "success" | "info";
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}
interface ToastApi {
  success: (message: string) => void;
  info: (message: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((tone: Tone, message: string) => {
    const id = ++seq;
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const api: ToastApi = {
    success: (m) => push("success", m),
    info: (m) => push("info", m),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex animate-popIn items-center gap-2.5 rounded-card border border-line bg-card px-3.5 py-2.5 text-[14px] text-ink shadow-pop"
          >
            <span
              className={
                "grid h-5 w-5 place-items-center rounded-full " +
                (t.tone === "success" ? "bg-accent-green/15 text-accent-green" : "bg-accent/15 text-accent")
              }
            >
              {t.tone === "success" ? <Check size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </span>
            <span className="font-medium">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
