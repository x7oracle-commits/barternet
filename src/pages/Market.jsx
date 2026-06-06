import { useState, useEffect } from "react";
import { Search, Package } from "lucide-react";
import { db, getProfile, addTrade } from "../db/db.js";
import ItemCard from "../components/ItemCard.jsx";
import Modal from "../components/Modal.jsx";
import { useToast } from "../components/Toast.jsx";
import { genId } from "../utils/id.js";
import { locationLabel } from "../utils/location.js";
import { useMesh } from "../context/MeshContext.jsx";

const CATEGORIES = ["All", "Electronics", "Clothing", "Food", "Tools", "Books", "Furniture", "Services", "Other"];

export default function Market() {
  const toast = useToast();
  const mesh  = useMesh();
  const [query,        setQuery]        = useState("");
  const [cat,          setCat]          = useState("All");
  const [allItems,     setAllItems]     = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [myItems,      setMyItems]      = useState([]);
  const [offerItemId,  setOfferItemId]  = useState("");
  const [, setMyProfile] = useState(null);

  // Reload when mesh syncs new data (dataVersion bumps)
  useEffect(() => { loadData(); }, [mesh?.dataVersion]);

  async function loadData() {
    const [peers, profile, mine] = await Promise.all([
      db.peers.toArray(),
      getProfile(),
      db.items.toArray(),
    ]);
    setMyProfile(profile);

    // Only show items I can offer (not want-list entries)
    setMyItems(mine.filter((i) => i.status === "available" && i.type !== "want"));

    const myPeerId = profile?.uid || profile?.id;

    // Collect peer items — skip our own device if it somehow got saved as a peer
    const peerItems = peers
      .filter((p) => p.id !== myPeerId)
      .flatMap((p) =>
        (p.items || []).map((item) => ({
          ...item,
          _peerId:       p.id,
          _peerName:     p.name,
          _peerLocation: p.location,  // keep as object — render via locationLabel()
        }))
      );
    setAllItems(peerItems);
  }

  const filtered = allItems.filter((i) => {
    const matchCat = cat === "All" || i.category === cat;
    const matchQ   = !query || [i.title, i.description, i.wants, i._peerName].some(
      (f) => f && f.toLowerCase().includes(query.toLowerCase())
    );
    return matchCat && matchQ;
  });

  async function sendOffer() {
    if (!offerItemId) return toast("Pick an item to offer", "error");
    const offeringItem = myItems.find((i) => String(i.id) === String(offerItemId));
    await addTrade({
      id:           genId(),
      status:       "pending_send",
      withPeerId:   selectedItem._peerId,
      withPeerName: selectedItem._peerName,
      theirItem:    selectedItem,
      myItem:       offeringItem,
      initiatedByMe: true,
    });
    toast("Offer created! It sends automatically next time you're near them.", "success");
    setSelectedItem(null);
    setOfferItemId("");
    mesh?.bumpData?.(); // refresh advertised bundle to include the new offer
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-2 space-y-3">
        <h1 className="text-xl font-bold">Nearby Market</h1>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-barter-muted" />
          <input
            className="pl-9"
            placeholder="Search items, people, categories…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                cat === c ? "bg-barter-accent text-white" : "bg-barter-card text-barter-muted"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center text-barter-muted mt-20 space-y-3">
            <Package size={48} className="mx-auto opacity-30" />
            <p className="font-medium">No items found</p>
            <p className="text-sm">Sync with nearby people via Bluetooth<br />to see their listings here</p>
          </div>
        ) : (
          filtered.map((item, i) => (
            <ItemCard
              key={i}
              item={item}
              peerName={item._peerName}
              actions={
                <button
                  className="btn-primary text-sm py-2 px-4"
                  onClick={() => { setSelectedItem(item); setOfferItemId(""); }}
                >
                  Offer Trade
                </button>
              }
            />
          ))
        )}
      </div>

      {selectedItem && (
        <Modal title="Make a Trade Offer" onClose={() => { setSelectedItem(null); setOfferItemId(""); }}>
          <div className="space-y-4">
            {/* Their item */}
            <div className="card">
              <p className="text-xs text-barter-muted mb-1">They have</p>
              <p className="font-semibold">{selectedItem.title}</p>
              <p className="text-sm text-barter-accent">
                {selectedItem._peerName}
                {selectedItem._peerLocation
                  ? ` · ${locationLabel(selectedItem._peerLocation)}`
                  : ""}
              </p>
            </div>

            {/* My item picker */}
            <div>
              <label className="block text-sm font-medium mb-2">What you offer in return</label>
              {myItems.length === 0 ? (
                <div className="card bg-barter-surface text-sm text-barter-muted space-y-1">
                  <p>You have no items listed for trade yet.</p>
                  <p>Add items in the <strong className="text-barter-text">My Items</strong> tab first.</p>
                </div>
              ) : (
                <select value={offerItemId} onChange={(e) => setOfferItemId(e.target.value)}>
                  <option value="">Select one of your items…</option>
                  {myItems.map((i) => (
                    <option key={i.id} value={i.id}>{i.title}</option>
                  ))}
                </select>
              )}
            </div>

            <p className="text-xs text-barter-muted">
              The offer is saved locally. Next time you sync with{" "}
              <strong>{selectedItem._peerName}</strong> via Bluetooth they will see it.
            </p>

            <button
              className="btn-primary w-full"
              onClick={sendOffer}
              disabled={!offerItemId}
            >
              Create Offer
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
