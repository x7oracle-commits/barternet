import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight, CheckCircle, XCircle, Clock, Bell,
  Star, MapPin, ChevronDown, ChevronUp, MessageCircle,
} from "lucide-react";
import { updateTrade, getTrades, updateItem } from "../db/db.js";
import { useToast } from "../components/Toast.jsx";
import Modal from "../components/Modal.jsx";
import { useMesh } from "../context/MeshContext.jsx";

const STATUS_META = {
  pending_send:   { color: "text-barter-amber",  label: "Offer pending sync",    Icon: Clock },
  offered:        { color: "text-barter-accent",  label: "Offer sent",            Icon: Clock },
  incoming:       { color: "text-barter-accent",  label: "Incoming offer",        Icon: Bell },
  accepted:       { color: "text-barter-green",   label: "Accepted — meet up!",   Icon: CheckCircle },
  declined:       { color: "text-barter-red",     label: "Declined",              Icon: XCircle },
  declined_by_me: { color: "text-barter-red",     label: "You declined",          Icon: XCircle },
  completed:      { color: "text-barter-green",   label: "Completed",             Icon: CheckCircle },
  incoming_want:  { color: "text-barter-accent",  label: "They want your item",   Icon: Bell },
};

function StarRating({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[1,2,3,4,5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} className="p-0.5">
          <Star size={28} className={n <= value ? "text-barter-amber fill-barter-amber" : "text-barter-muted"} />
        </button>
      ))}
    </div>
  );
}

export default function Trades() {
  const toast = useToast();
  const nav   = useNavigate();
  const mesh  = useMesh();
  const [trades,    setTrades]    = useState([]);
  const [tab,       setTab]       = useState("active");
  const [expanded,  setExpanded]  = useState(null);

  // Deny modal
  const [denying,      setDenying]      = useState(null); // trade being denied
  const [denyReason,   setDenyReason]   = useState("");
  const [denyingSaving, setDenyingSaving] = useState(false);

  // Record exchange modal
  const [completing,     setCompleting]     = useState(null);
  const [actualGiven,    setActualGiven]    = useState("");
  const [actualReceived, setActualReceived] = useState("");
  const [meetLocation,   setMeetLocation]   = useState("");
  const [notes,          setNotes]          = useState("");
  const [rating,         setRating]         = useState(0);
  const [saving,         setSaving]         = useState(false);

  // Reload when mesh syncs (incoming offers / responses) or on mount
  useEffect(() => { loadData(); }, [mesh?.dataVersion]);

  async function loadData() {
    setTrades(await getTrades());
  }

  // ── Accept incoming offer ─────────────────────────────────────────────────
  async function accept(trade) {
    await updateTrade(trade.id, { status: "accepted", acceptedAt: Date.now() });
    toast("Accepted! They'll be notified next time you're both nearby.", "success");
    loadData();
    mesh?.bumpData?.();
  }

  // ── Deny incoming offer ───────────────────────────────────────────────────
  function openDeny(trade) {
    setDenying(trade);
    setDenyReason("");
  }

  async function confirmDeny() {
    if (!denying) return;
    setDenyingSaving(true);
    await updateTrade(denying.id, {
      status:        "declined_by_me",
      declineReason: denyReason.trim(),
      declinedAt:    Date.now(),
    });
    setDenyingSaving(false);
    setDenying(null);
    toast("Declined. They'll see your reason next sync.", "info");
    loadData();
    mesh?.bumpData?.();
  }

  // ── Their offer accepted our outgoing — mark their offer as responded ─────
  async function markComplete(trade) {
    setActualGiven(trade.myItem?.title || "");
    setActualReceived(trade.theirItem?.title || "");
    setMeetLocation("");
    setNotes("");
    setRating(0);
    setCompleting(trade);
  }

  async function confirmComplete() {
    if (rating === 0) return toast("Please give a star rating", "error");
    setSaving(true);
    await updateTrade(completing.id, {
      status:         "completed",
      completedAt:    Date.now(),
      actualGiven:    actualGiven.trim()    || completing.myItem?.title    || "",
      actualReceived: actualReceived.trim() || completing.theirItem?.title || "",
      meetLocation:   meetLocation.trim(),
      notes:          notes.trim(),
      rating,
    });
    if (completing.myItem?.id) {
      await updateItem(completing.myItem.id, { status: "traded" });
    }
    setSaving(false);
    setCompleting(null);
    toast("Trade recorded! Great barter!", "success");
    loadData();
    mesh?.bumpData?.();
  }

  const incoming = trades.filter((t) => t.status === "incoming");
  const active   = trades.filter((t) => !["completed","declined","declined_by_me"].includes(t.status) && t.status !== "incoming");
  const history  = trades.filter((t) => ["completed","declined","declined_by_me"].includes(t.status));

  const displayed = tab === "incoming" ? incoming : tab === "active" ? active : history;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-2">
        <h1 className="text-xl font-bold mb-4">Trades</h1>

        {/* Tabs */}
        <div className="flex gap-1 bg-barter-card rounded-xl p-1">
          {[
            ["incoming", "Offers",  incoming.length],
            ["active",   "Active",  active.length],
            ["history",  "History", 0],
          ].map(([v, label, count]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors relative ${
                tab === v ? "bg-barter-accent text-white" : "text-barter-muted"
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`ml-1 text-xs font-bold ${tab === v ? "text-white/80" : "text-barter-accent"}`}>
                  ({count})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-3 mt-3">
        {displayed.length === 0 ? (
          <div className="text-center text-barter-muted mt-20 space-y-2">
            <ArrowLeftRight size={40} className="mx-auto opacity-30" />
            <p>{tab === "incoming" ? "No incoming offers yet" : tab === "active" ? "No active trades" : "No history yet"}</p>
          </div>
        ) : (
          displayed.map((trade) => {
            const s   = STATUS_META[trade.status] || STATUS_META.pending_send;
            const { Icon } = s;
            const isOpen = expanded === trade.id;

            return (
              <div key={trade.id} className="card space-y-3">
                {/* Status */}
                <div className="flex items-center justify-between">
                  <div className={`flex items-center gap-2 ${s.color}`}>
                    <Icon size={15} />
                    <span className="text-sm font-medium">{s.label}</span>
                  </div>
                  {trade.status === "completed" && (
                    <button onClick={() => setExpanded(isOpen ? null : trade.id)} className="text-barter-muted">
                      {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  )}
                </div>

                {/* Partner */}
                <p className="text-sm">
                  <span className="text-barter-muted">{trade.initiatedByMe ? "Offering to " : "From "}</span>
                  <strong>{trade.withPeerName}</strong>
                </p>

                {/* Items */}
                {(trade.myItem || trade.theirItem) && (
                  <div className="flex items-center gap-2 text-sm">
                    <div className="flex-1 bg-barter-surface rounded-xl py-2 px-3 text-center">
                      <p className="text-xs text-barter-muted">{trade.initiatedByMe ? "You offer" : "They offer"}</p>
                      <p className="font-medium">{(trade.initiatedByMe ? trade.myItem : trade.theirItem)?.title || "—"}</p>
                    </div>
                    <ArrowLeftRight size={14} className="text-barter-accent shrink-0" />
                    <div className="flex-1 bg-barter-surface rounded-xl py-2 px-3 text-center">
                      <p className="text-xs text-barter-muted">{trade.initiatedByMe ? "For your" : "For your"}</p>
                      <p className="font-medium">{(trade.initiatedByMe ? trade.theirItem : trade.myItem)?.title || "—"}</p>
                    </div>
                  </div>
                )}

                {/* Message from offerer */}
                {trade.fromMessage && (
                  <p className="text-sm text-barter-muted italic bg-barter-surface rounded-xl px-3 py-2">
                    "{trade.fromMessage}"
                  </p>
                )}

                {/* Decline reason (shown to the one who got declined) */}
                {trade.declineReason && trade.status === "declined" && (
                  <div className="bg-barter-red/10 rounded-xl px-3 py-2">
                    <p className="text-xs text-barter-muted">Reason: <span className="text-barter-text">{trade.declineReason}</span></p>
                  </div>
                )}

                {/* Note */}
                {trade.note && <p className="text-sm text-barter-muted">{trade.note}</p>}

                {/* Completion record */}
                {trade.status === "completed" && isOpen && (
                  <div className="border-t border-white/10 pt-3 space-y-2 text-sm">
                    <p className="font-semibold">Exchange Record</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-barter-surface rounded-xl p-3">
                        <p className="text-xs text-barter-muted mb-1">Gave</p>
                        <p className="font-medium">{trade.actualGiven || "—"}</p>
                      </div>
                      <div className="bg-barter-surface rounded-xl p-3">
                        <p className="text-xs text-barter-muted mb-1">Received</p>
                        <p className="font-medium">{trade.actualReceived || "—"}</p>
                      </div>
                    </div>
                    {trade.meetLocation && (
                      <p className="text-xs text-barter-muted flex items-center gap-1">
                        <MapPin size={12} />{trade.meetLocation}
                      </p>
                    )}
                    {trade.rating > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="flex gap-0.5">
                          {[1,2,3,4,5].map((n) => (
                            <Star key={n} size={13} className={n <= trade.rating ? "text-barter-amber fill-barter-amber" : "text-barter-muted"} />
                          ))}
                        </div>
                        <span className="text-xs text-barter-muted">{["","Poor","Fair","Good","Great","Excellent"][trade.rating]}</span>
                      </div>
                    )}
                    {trade.notes && <p className="text-xs text-barter-muted italic">"{trade.notes}"</p>}
                    <p className="text-xs text-barter-muted">
                      {trade.completedAt && new Date(trade.completedAt).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" })}
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 flex-wrap">
                  {/* Incoming offer — Accept / Deny */}
                  {trade.status === "incoming" && (
                    <>
                      <button className="btn-primary flex-1 py-2 text-sm" onClick={() => accept(trade)}>
                        Accept
                      </button>
                      <button className="btn-danger flex-1 py-2 text-sm" onClick={() => openDeny(trade)}>
                        Deny
                      </button>
                    </>
                  )}

                  {/* Accepted trade — record exchange + chat */}
                  {trade.status === "accepted" && (
                    <>
                      <button className="btn-primary flex-1 py-2 text-sm" onClick={() => markComplete(trade)}>
                        Record Exchange
                      </button>
                      <button
                        className="flex items-center gap-1.5 px-4 py-2 bg-barter-card rounded-xl text-sm text-barter-accent active:opacity-80"
                        onClick={() =>
                          nav(`/chat?peerId=${trade.withPeerId}&peerName=${encodeURIComponent(trade.withPeerName)}`)
                        }
                      >
                        <MessageCircle size={16} /> Chat
                      </button>
                    </>
                  )}

                  {/* Pending outgoing */}
                  {trade.status === "pending_send" && (
                    <p className="text-xs text-barter-muted flex-1">
                      Will be sent automatically next time you're near {trade.withPeerName}
                    </p>
                  )}

                  {/* Incoming want (legacy) */}
                  {trade.status === "incoming_want" && (
                    <p className="text-xs text-barter-muted flex-1">{trade.note}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Deny Modal ────────────────────────────────────────────────────────── */}
      {denying && (
        <Modal title="Decline Trade Offer" onClose={() => setDenying(null)} center>
          <div className="space-y-4">
            <div className="card bg-barter-surface text-sm">
              <p className="text-barter-muted mb-1">Declining offer from</p>
              <p className="font-semibold">{denying.withPeerName}</p>
              <p className="text-barter-muted text-xs mt-1">
                {denying.theirItem?.title} → your {denying.myItem?.title}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Reason <span className="text-barter-muted font-normal">(optional — helps them understand)</span>
              </label>
              <textarea
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                placeholder="e.g. Already found a trade, item is no longer available, price doesn't feel right…"
                rows={3}
                className="resize-none"
                maxLength={200}
              />
            </div>

            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => setDenying(null)}>Cancel</button>
              <button className="btn-danger flex-1" onClick={confirmDeny} disabled={denyingSaving}>
                {denyingSaving ? "Saving…" : "Decline Offer"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Record Exchange Modal ─────────────────────────────────────────────── */}
      {completing && (
        <Modal title="Record the Exchange" onClose={() => setCompleting(null)}>
          <div className="space-y-5">
            <p className="text-sm text-barter-muted">Fill in what actually changed hands.</p>

            <div>
              <label className="block text-sm font-medium mb-1.5">What did you give?</label>
              <input value={actualGiven} onChange={(e) => setActualGiven(e.target.value)}
                placeholder={completing.myItem?.title} maxLength={100} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">What did you receive?</label>
              <input value={actualReceived} onChange={(e) => setActualReceived(e.target.value)}
                placeholder={completing.theirItem?.title} maxLength={100} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Where did you meet? <span className="text-barter-muted font-normal">(optional)</span></label>
              <input value={meetLocation} onChange={(e) => setMeetLocation(e.target.value)}
                placeholder="East Market, Gate 3…" maxLength={100} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Notes <span className="text-barter-muted font-normal">(optional)</span></label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                rows={3} className="resize-none" maxLength={300} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">How was the experience? *</label>
              <StarRating value={rating} onChange={setRating} />
              {rating > 0 && (
                <p className="text-xs text-barter-muted mt-1">{["","Poor","Fair","Good","Great","Excellent!"][rating]}</p>
              )}
            </div>
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => setCompleting(null)}>Cancel</button>
              <button className="btn-primary flex-1" onClick={confirmComplete} disabled={saving || rating === 0}>
                {saving ? "Saving…" : "Save Record"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
