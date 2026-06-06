import { X } from "lucide-react";
import { useEffect } from "react";

/**
 * Mobile  (<640px): full screen — no clipping, no height issues
 * Tablet  (≥640px): centered dialog with max-height cap
 * center prop: always centered (for small popups like sync request, QR)
 */
export default function Modal({ title, onClose, children, center = false }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm
        ${center
          ? "items-center justify-center p-4"
          : "flex-col sm:items-center sm:justify-center sm:p-4"
        }`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`bg-barter-surface flex flex-col
          ${center
            // Small centered popup on all screens
            ? "w-full max-w-sm rounded-2xl max-h-[85vh]"
            // Mobile: full screen. Tablet: centered with max-height
            : "w-full h-full sm:h-auto sm:max-w-md sm:rounded-2xl sm:max-h-[85vh]"
          }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10 shrink-0">
          <h2 className="font-bold text-lg">{title}</h2>
          <button
            onClick={onClose}
            className="text-barter-muted p-2 rounded-xl active:bg-white/10"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable content — min-height:0 lets flex child actually scroll */}
        <div
          className="overflow-y-auto flex-1 p-4"
          style={{
            minHeight: 0,
            paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
