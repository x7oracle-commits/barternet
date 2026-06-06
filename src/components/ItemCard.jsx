import { Tag, ArrowRight } from "lucide-react";

const CATEGORY_COLORS = {
  Electronics: "bg-blue-500/20 text-blue-300",
  Clothing:    "bg-pink-500/20 text-pink-300",
  Food:        "bg-green-500/20 text-green-300",
  Tools:       "bg-orange-500/20 text-orange-300",
  Books:       "bg-yellow-500/20 text-yellow-300",
  Furniture:   "bg-purple-500/20 text-purple-300",
  Services:    "bg-cyan-500/20 text-cyan-300",
  Other:       "bg-gray-500/20 text-gray-300",
};

export default function ItemCard({ item, actions, peerName }) {
  const catColor = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.Other;

  return (
    <div className="card flex gap-3">
      {/* Image or placeholder */}
      <div className="w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-barter-surface flex items-center justify-center">
        {item.image ? (
          <img src={item.image} alt={item.title} className="w-full h-full object-cover" />
        ) : (
          <Tag size={28} className="text-barter-muted" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-barter-text leading-tight truncate">{item.title}</h3>
          <span className={`badge shrink-0 ${catColor}`}>{item.category}</span>
        </div>

        {peerName && (
          <p className="text-xs text-barter-accent mt-0.5">by {peerName}</p>
        )}

        {item.description && (
          <p className="text-sm text-barter-muted mt-1 line-clamp-2">{item.description}</p>
        )}

        {item.wants && (
          <div className="flex items-center gap-1 mt-2">
            <ArrowRight size={12} className="text-barter-accent shrink-0" />
            <span className="text-xs text-barter-accent truncate">Wants: {item.wants}</span>
          </div>
        )}

        {item.condition && (
          <span className="text-xs text-barter-muted mt-1 inline-block">Condition: {item.condition}</span>
        )}

        {actions && <div className="flex gap-2 mt-3">{actions}</div>}
      </div>
    </div>
  );
}
