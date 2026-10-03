import { useEffect } from "react";
import { AlertTriangle, Check } from "lucide-react";

export interface ToastData {
  id: number;
  text: string;
  error?: boolean;
}

export function Toast({ toast, onDismiss }: { toast: ToastData | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  return (
    <div className="toast-region" aria-live="polite">
      {toast && (
        <div key={toast.id} className={toast.error ? "toast error" : "toast"}>
          {toast.error ? <AlertTriangle size={15} aria-hidden /> : <Check size={15} aria-hidden />}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
