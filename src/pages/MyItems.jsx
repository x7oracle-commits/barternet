import { useState, useEffect } from "react";
import { Plus, Trash2, Edit3, Bell } from "lucide-react";
import { addItem, updateItem, deleteItem, getMyItems } from "../db/db.js";
import ItemCard from "../components/ItemCard.jsx";
import Modal from "../components/Modal.jsx";
import { useToast } from "../components/Toast.jsx";
import { useMesh } from "../context/MeshContext.jsx";

const CATEGORIES = ["Electronics", "Clothing", "Food", "Tools", "Books", "Furniture", "Services", "Other"];
const CONDITIONS = ["New", "Like New", "Good", "Fair", "For Parts"];

const BLANK = { title: "", category: "Other", description: "", wants: "", condition: "Good", image: "" };

export default function MyItems() {
  const toast = useToast();
  const mesh  = useMesh();
  const [items, setItems] = useState([]);
  const [wants, setWants] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showWantForm, setShowWantForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState(null);
  const [wantText, setWantText] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("offer"); // offer | want

  useEffect(() => { loadItems(); }, []);

  async function loadItems() {
    const all = await getMyItems();
    setItems(all.filter((i) => i.type !== "want"));
    setWants(all.filter((i) => i.type === "want"));
  }

  function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500_000) return toast("Image too large (max 500 KB)", "error");
    const reader = new FileReader();
    reader.onload = (ev) => setForm((f) => ({ ...f, image: ev.target.result }));
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!form.title.trim()) return toast("Title is required", "error");
    setSaving(true);
    if (editId) {
      await updateItem(editId, { ...form });
    } else {
      await addItem({ ...form, type: "offer" });
    }
    setSaving(false);
    setShowForm(false);
    setForm(BLANK);
    setEditId(null);
    loadItems();
    mesh?.bumpData?.();
    toast(editId ? "Item updated" : "Item added", "success");
  }

  async function remove(id) {
    await deleteItem(id);
    loadItems();
    mesh?.bumpData?.();
    toast("Item removed", "info");
  }

  async function addWant() {
    if (!wantText.trim()) return;
    await addItem({ title: wantText.trim(), type: "want", category: "Other", status: "searching", searching: true });
    setWantText("");
    setShowWantForm(false);
    loadItems();
    mesh?.bumpData?.();
    toast("Added to your Want List — will alert when found in the mesh!", "success");
  }

  async function removeWant(id) {
    await deleteItem(id);
    loadItems();
    mesh?.bumpData?.();
  }

  function openEdit(item) {
    setForm({ title: item.title, category: item.category, description: item.description || "", wants: item.wants || "", condition: item.condition || "Good", image: item.image || "" });
    setEditId(item.id);
    setShowForm(true);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">My Items</h1>
          <button
            className="btn-primary py-2 px-4 text-sm flex items-center gap-1"
            onClick={() => tab === "offer" ? setShowForm(true) : setShowWantForm(true)}
          >
            <Plus size={16} /> Add
          </button>
        </div>

        <div className="flex gap-1 bg-barter-card rounded-xl p-1 mb-4">
          {[["offer", "Offering"], ["want", "Want List"]].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === v ? "bg-barter-accent text-white" : "text-barter-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-3">
        {tab === "offer" && (
          items.length === 0 ? (
            <div className="text-center text-barter-muted mt-20 space-y-2">
              <p className="text-lg">Nothing to trade yet</p>
              <p className="text-sm">Add items you want to barter</p>
            </div>
          ) : (
            items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                actions={
                  <>
                    <button className="text-barter-muted p-2 rounded-lg active:bg-white/10" onClick={() => openEdit(item)}>
                      <Edit3 size={16} />
                    </button>
                    <button className="text-barter-red p-2 rounded-lg active:bg-red-500/10" onClick={() => remove(item.id)}>
                      <Trash2 size={16} />
                    </button>
                  </>
                }
              />
            ))
          )
        )}

        {tab === "want" && (
          <>
            <div className="card bg-barter-accent/10 border border-barter-accent/20">
              <div className="flex items-start gap-3">
                <Bell size={18} className="text-barter-accent mt-0.5 shrink-0" />
                <p className="text-sm text-barter-muted">
                  Add what you're looking for. Every time you connect to someone via Bluetooth,
                  the app checks their inventory AND their network for matches — and alerts you instantly.
                </p>
              </div>
            </div>

            {wants.length === 0 ? (
              <div className="text-center text-barter-muted mt-10 space-y-2">
                <p className="text-sm">Nothing in your want list yet</p>
              </div>
            ) : (
              wants.map((w) => (
                <div key={w.id} className="card flex items-center gap-3">
                  <Bell size={18} className="text-barter-accent shrink-0" />
                  <span className="flex-1 font-medium">{w.title}</span>
                  <span className="badge bg-barter-green/20 text-barter-green text-xs">Searching</span>
                  <button className="text-barter-red p-1" onClick={() => removeWant(w.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* Add Item Modal */}
      {showForm && (
        <Modal title={editId ? "Edit Item" : "Add Item to Trade"} onClose={() => { setShowForm(false); setForm(BLANK); setEditId(null); }}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Title *</label>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="What are you trading?" maxLength={80} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1.5">Category</label>
                <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Condition</label>
                <select value={form.condition} onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))}>
                  {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Description</label>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Details, specs, age…" rows={3} className="resize-none" maxLength={300} />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Looking for in return</label>
              <input value={form.wants} onChange={(e) => setForm((f) => ({ ...f, wants: e.target.value }))} placeholder="e.g. Rice, bicycle parts, haircut…" maxLength={100} />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Photo (optional)</label>
              <input type="file" accept="image/*" onChange={handleImageUpload} className="text-sm" />
              {form.image && <img src={form.image} className="mt-2 rounded-xl h-32 w-full object-cover" alt="" />}
            </div>

            <button className="btn-primary w-full" onClick={save} disabled={saving}>
              {saving ? "Saving…" : editId ? "Update Item" : "Add Item"}
            </button>
          </div>
        </Modal>
      )}

      {/* Add Want Modal */}
      {showWantForm && (
        <Modal title="What are you looking for?" onClose={() => setShowWantForm(false)} center>
          <div className="space-y-4">
            <input
              value={wantText}
              onChange={(e) => setWantText(e.target.value)}
              placeholder="e.g. Rice, used phone, bicycle…"
              maxLength={100}
              onKeyDown={(e) => e.key === "Enter" && addWant()}
            />
            <p className="text-sm text-barter-muted">
              The app will search for this automatically every time you Bluetooth-connect to someone.
            </p>
            <button className="btn-primary w-full" onClick={addWant}>Add to Want List</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
