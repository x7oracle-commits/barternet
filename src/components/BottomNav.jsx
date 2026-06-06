import { NavLink } from "react-router-dom";
import { Store, PlusSquare, Bluetooth, ArrowLeftRight, User } from "lucide-react";

const tabs = [
  { to: "/",         label: "Market",   Icon: Store },
  { to: "/my-items", label: "My Items", Icon: PlusSquare },
  { to: "/connect",  label: "Connect",  Icon: Bluetooth },
  { to: "/trades",   label: "Trades",   Icon: ArrowLeftRight },
  { to: "/profile",  label: "Profile",  Icon: User },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-barter-surface border-t border-white/10 pb-safe z-50">
      <div className="flex">
        {tabs.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                isActive ? "text-barter-accent" : "text-barter-muted"
              }`
            }
          >
            <Icon size={20} strokeWidth={1.8} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
