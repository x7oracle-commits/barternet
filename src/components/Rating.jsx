import { Star } from "lucide-react";

// Compact reputation display: ★ 4.3 (12). Renders "No ratings yet" when empty.
export default function Rating({ avg = 0, count = 0, size = 12, showCount = true, muted = true }) {
  if (!count) {
    return <span className="text-xs text-barter-muted">No ratings yet</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${muted ? "text-barter-muted" : ""}`}>
      <Star size={size} className="text-barter-amber fill-barter-amber shrink-0" />
      <span className="text-barter-text font-medium">{avg.toFixed(1)}</span>
      {showCount && <span>({count})</span>}
    </span>
  );
}
