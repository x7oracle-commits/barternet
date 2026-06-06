import { useState } from "react";
import { Bluetooth, ChevronRight } from "lucide-react";
import { saveProfile } from "../db/db.js";
import { generateIdentity } from "../utils/crypto.js";
import { useToast } from "../components/Toast.jsx";
import LocationPicker from "../components/LocationPicker.jsx";

const AVATARS = ["🦁", "🐻", "🦊", "🐺", "🐸", "🦋", "🦅", "🐬", "🦄", "🐙"];

export default function Onboarding({ onDone }) {
  const toast  = useToast();
  const [step,     setStep]    = useState(0);
  const [name,     setName]    = useState("");
  const [location, setLocation] = useState(null); // { lat, lng, accuracy, label }
  const [avatar,   setAvatar]  = useState(AVATARS[0]);
  const [saving,   setSaving]  = useState(false);

  async function finish() {
    if (!name.trim()) return toast("Enter your name", "error");
    if (!location?.label && !location?.lat) return toast("Add your location so others can find you", "error");
    setSaving(true);
    // Generate this device's signing identity. The public-key fingerprint becomes
    // our peer id, so no one else can publish data or messages under it.
    const identity = generateIdentity();
    await saveProfile({
      uid:      identity.uid,
      pub:      identity.pub,
      priv:     identity.priv,
      name:     name.trim(),
      location,               // full object with coords + label
      avatar,
      createdAt: Date.now(),
    });
    setSaving(false);
    onDone();
  }

  return (
    <div className="min-h-screen bg-barter-bg flex flex-col items-center justify-center p-6 text-center">
      {step === 0 && (
        <div className="max-w-sm w-full space-y-8 animate-fade-in">
          <div>
            <div className="w-20 h-20 rounded-2xl bg-barter-accent/20 flex items-center justify-center mx-auto mb-6">
              <Bluetooth size={40} className="text-barter-accent" />
            </div>
            <h1 className="text-3xl font-bold mb-3">BarterNet</h1>
            <p className="text-barter-muted leading-relaxed">
              Trade anything, anywhere — completely offline.<br />
              Connect via Bluetooth and let your needs ripple through the network.
            </p>
          </div>

          <div className="space-y-3 text-left text-sm text-barter-muted">
            {[
              ["📦", "List items you want to trade"],
              ["📡", "Connect to nearby people via Bluetooth"],
              ["🌐", "Your requests travel hop-by-hop across the mesh"],
              ["📍", "GPS pins your location so matches can find you"],
            ].map(([icon, text]) => (
              <div key={text} className="flex items-center gap-3">
                <span className="text-xl">{icon}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>

          <button className="btn-primary w-full flex items-center justify-center gap-2" onClick={() => setStep(1)}>
            Get Started <ChevronRight size={18} />
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="max-w-sm w-full space-y-6 animate-fade-in text-left">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-2">Your Profile</h2>
            <p className="text-barter-muted text-sm">Shared with people you trade with</p>
          </div>

          {/* Avatar */}
          <div>
            <label className="block text-sm font-medium mb-2">Pick an avatar</label>
            <div className="flex flex-wrap gap-2">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={`text-2xl w-12 h-12 rounded-xl transition-all ${
                    avatar === a
                      ? "bg-barter-accent/30 ring-2 ring-barter-accent"
                      : "bg-barter-card"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-2">Your name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Raj, Maria, 田中…"
              maxLength={40}
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium mb-2">Your location *</label>
            <LocationPicker
              value={location}
              onChange={setLocation}
              labelPlaceholder="e.g. East Market, Block 4B, Koramangala…"
            />
          </div>

          <button
            className="btn-primary w-full"
            onClick={finish}
            disabled={saving || !name.trim()}
          >
            {saving ? "Setting up…" : "Start Trading"}
          </button>
        </div>
      )}
    </div>
  );
}
