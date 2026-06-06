import { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle, AlertCircle, Info } from "lucide-react";

const ToastCtx = createContext(null);

const ICONS = {
  success: <CheckCircle size={18} className="text-barter-green shrink-0" />,
  error:   <AlertCircle size={18} className="text-barter-red shrink-0" />,
  info:    <Info size={18} className="text-barter-accent shrink-0" />,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed top-4 inset-x-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="bg-barter-card border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3 shadow-xl animate-fade-in"
          >
            {ICONS[t.type]}
            <span className="text-sm">{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
