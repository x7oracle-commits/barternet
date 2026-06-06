import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Bluetooth } from "lucide-react";
import { getProfile, addMessage, messageId, getMessagesWith } from "../db/db.js";
import { useMesh } from "../context/MeshContext.jsx";

export default function Chat() {
  const [params] = useSearchParams();
  const nav      = useNavigate();
  const mesh     = useMesh();

  const peerId   = params.get("peerId")   || "";
  const peerName = params.get("peerName") || "Trader";

  const [messages, setMessages] = useState([]);
  const [text,     setText]     = useState("");
  const [myId,     setMyId]     = useState(null);
  const endRef = useRef();

  // Load my profile id
  useEffect(() => {
    getProfile().then((p) => setMyId(p?.uid || p?.id));
  }, []);

  // Load + live-reload messages whenever data changes (incoming sync bumps dataVersion)
  useEffect(() => {
    if (!peerId) return;
    getMessagesWith(peerId).then(setMessages);
  }, [peerId, mesh?.dataVersion]);

  // Scroll to bottom on new message
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || !myId) return;
    const ts = Date.now();
    const id = messageId(myId, peerId, ts, body);
    await addMessage({
      id,
      peerId,            // the other person
      peerName,
      text: body,
      ts,
      mine: true,        // I sent it
      synced: false,     // will sync next time we're near
    });
    setText("");
    const fresh = await getMessagesWith(peerId);
    setMessages(fresh);
    mesh?.bumpData?.();      // rebuild outgoing bundle so it includes this message
    mesh?.refreshBundle?.(); // push to native advertiser immediately
  }

  return (
    <div className="flex flex-col h-screen bg-barter-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0 bg-barter-surface">
        <button onClick={() => nav(-1)} className="p-2 rounded-xl active:bg-white/10 text-barter-muted">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{peerName}</p>
          <p className="text-xs text-barter-muted flex items-center gap-1">
            <Bluetooth size={11} className="text-barter-accent" />
            Messages sync over Bluetooth when nearby
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 ? (
          <div className="text-center text-barter-muted mt-20 space-y-2">
            <p className="text-sm">No messages yet</p>
            <p className="text-xs">
              Say hi! Messages deliver next time you and {peerName} are near each other.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                  m.mine
                    ? "bg-barter-accent text-white rounded-br-md"
                    : "bg-barter-card text-barter-text rounded-bl-md"
                }`}
              >
                <p className="text-sm break-words whitespace-pre-wrap">{m.text}</p>
                <p className={`text-[10px] mt-1 ${m.mine ? "text-white/60" : "text-barter-muted"}`}>
                  {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {m.mine && (m.synced ? " · sent" : " · pending")}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-white/10 p-3 shrink-0 bg-barter-surface"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="flex gap-2 items-end">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={`Message ${peerName}…`}
            rows={1}
            className="flex-1 resize-none max-h-28"
            style={{ minHeight: 0 }}
          />
          <button
            onClick={send}
            disabled={!text.trim()}
            className="btn-primary p-3 rounded-xl shrink-0 disabled:opacity-40"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
