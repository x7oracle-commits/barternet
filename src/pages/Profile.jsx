import { useState, useEffect } from "react";
import { Edit3, Download, Trash2, Info, MapPin, Copy, CheckCircle } from "lucide-react";
import { getProfile, saveProfile, db } from "../db/db.js";
import { useToast } from "../components/Toast.jsx";
import Modal from "../components/Modal.jsx";
import LocationPicker from "../components/LocationPicker.jsx";
import { shortId } from "../utils/id.js";
import { locationLabel, formatCoords, geoUri, copyCoords } from "../utils/location.js";

const AVATARS = ["🦁", "🐻", "🦊", "🐺", "🐸", "🦋", "🦅", "🐬", "🦄", "🐙"];

export default function Profile({ onReset }) {
  const toast = useToast();
  const [profile,   setProfile]   = useState(null);
  const [editing,   setEditing]   = useState(false);
  const [form,      setForm]      = useState({});
  const [stats,     setStats]     = useState({ items: 0, trades: 0, peers: 0 });
  const [showAbout, setShowAbout] = useState(false);
  const [copied,    setCopied]    = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [prof, items, trades, peers] = await Promise.all([
      getProfile(),
      db.items.count(),
      db.trades.count(),
      db.peers.count(),
    ]);
    setProfile(prof);
    setForm(prof || {});
    setStats({ items, trades, peers });
  }

  async function saveEdit() {
    if (!form.name?.trim()) return toast("Name required", "error");
    await saveProfile({ ...profile, ...form });
    toast("Profile updated", "success");
    setEditing(false);
    loadData();
  }

  async function handleCopyCoords() {
    const loc = profile?.location;
    if (!loc?.lat) return;
    await copyCoords(loc.lat, loc.lng);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function exportAllData() {
    const [items, trades, peers, prof] = await Promise.all([
      db.items.toArray(), db.trades.toArray(), db.peers.toArray(), getProfile(),
    ]);
    const blob = new Blob([JSON.stringify({ profile: prof, items, trades, peers, exportedAt: Date.now() }, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "barternet-backup.json"; a.click();
    URL.revokeObjectURL(url);
    toast("Full backup downloaded", "success");
  }

  async function clearAll() {
    await Promise.all([db.items.clear(), db.trades.clear(), db.peers.clear(), db.profile.clear()]);
    onReset?.();
  }

  if (!profile) return (
    <div className="flex items-center justify-center h-full text-barter-muted text-sm">
      Loading profile…
    </div>
  );

  const loc    = profile.location;
  const hasGPS = loc?.lat != null;

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-24">
      <div className="p-4 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">My Profile</h1>
          <button className="text-barter-muted p-2 rounded-lg active:bg-white/10" onClick={() => setShowAbout(true)}>
            <Info size={20} />
          </button>
        </div>

        {/* Card */}
        <div className="card text-center space-y-2">
          <div className="text-6xl">{profile.avatar || "👤"}</div>
          <h2 className="text-xl font-bold">{profile.name}</h2>

          {/* Location display */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1.5 text-barter-muted text-sm">
              <MapPin size={13} className={hasGPS ? "text-barter-green" : ""} />
              <span>{locationLabel(loc)}</span>
            </div>
            {hasGPS && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-barter-muted">
                  {formatCoords(loc.lat, loc.lng)}
                </span>
                <button onClick={handleCopyCoords} className="text-barter-muted">
                  {copied
                    ? <CheckCircle size={13} className="text-barter-green" />
                    : <Copy size={13} />
                  }
                </button>
                <a
                  href={geoUri(loc.lat, loc.lng, locationLabel(loc))}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-barter-accent underline"
                >
                  Open map
                </a>
              </div>
            )}
            {hasGPS && loc.accuracy && (
              <span className="text-xs text-barter-muted">±{loc.accuracy} m accuracy</span>
            )}
          </div>

          <p className="text-xs text-barter-muted font-mono">ID: {shortId(profile.uid || profile.id)}</p>
          <button
            className="btn-primary text-sm py-2 px-4 flex items-center gap-2 mx-auto"
            onClick={() => { setForm({ ...profile }); setEditing(true); }}
          >
            <Edit3 size={14} /> Edit Profile
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[["Items", stats.items], ["Trades", stats.trades], ["Network", stats.peers]].map(([label, val]) => (
            <div key={label} className="card text-center">
              <p className="text-2xl font-bold text-barter-accent">{val}</p>
              <p className="text-xs text-barter-muted mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <button className="w-full card flex items-center gap-3 active:opacity-80" onClick={exportAllData}>
            <Download size={18} className="text-barter-green" />
            <div className="text-left">
              <p className="font-medium">Export Backup</p>
              <p className="text-xs text-barter-muted">Download all your data as JSON</p>
            </div>
          </button>
          <button className="w-full card flex items-center gap-3 active:opacity-80" onClick={() => {
            if (confirm("Delete all data and start over? This cannot be undone.")) clearAll();
          }}>
            <Trash2 size={18} className="text-barter-red" />
            <div className="text-left">
              <p className="font-medium text-barter-red">Reset Everything</p>
              <p className="text-xs text-barter-muted">Delete all local data</p>
            </div>
          </button>
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <Modal title="Edit Profile" onClose={() => setEditing(false)}>
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-2">Avatar</label>
              <div className="flex flex-wrap gap-2">
                {AVATARS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setForm((f) => ({ ...f, avatar: a }))}
                    className={`text-2xl w-11 h-11 rounded-xl transition-all ${
                      form.avatar === a ? "bg-barter-accent/30 ring-2 ring-barter-accent" : "bg-barter-card"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Name</label>
              <input
                value={form.name || ""}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={40}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Location</label>
              <LocationPicker
                value={typeof form.location === "string"
                  ? { label: form.location }   // migrate old string format
                  : form.location}
                onChange={(loc) => setForm((f) => ({ ...f, location: loc }))}
              />
            </div>

            <button className="btn-primary w-full" onClick={saveEdit}>Save Changes</button>
          </div>
        </Modal>
      )}

      {/* About Modal */}
      {showAbout && (
        <Modal title="About BarterNet" onClose={() => setShowAbout(false)} center>
          <div className="space-y-4 text-sm text-barter-muted">
            <p>
              <strong className="text-barter-text">BarterNet</strong> is a fully offline, peer-to-peer
              bartering platform. No servers, no internet, no accounts.
            </p>
            <p>
              Items spread <strong className="text-barter-text">hop-by-hop</strong> through Bluetooth —
              like a living marketplace that grows one handshake at a time.
            </p>
            <p>
              GPS works completely offline — it reads directly from your device's satellite receiver.
              Coordinates are shared only in your exported bundles, never uploaded anywhere.
            </p>
            <div className="card bg-barter-surface text-xs">
              <p className="font-semibold text-barter-text mb-1">Privacy</p>
              <p>All data stays on your device. You decide what to share and when.</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
