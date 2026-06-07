import { useState, useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { getProfile, ensureIdentity, pruneStalePeers } from "./db/db.js";
import { initNotifications } from "./utils/notify.js";
import { ToastProvider } from "./components/Toast.jsx";
import { MeshProvider } from "./context/MeshContext.jsx";
import BottomNav from "./components/BottomNav.jsx";
import Onboarding from "./pages/Onboarding.jsx";
import Market from "./pages/Market.jsx";
import MyItems from "./pages/MyItems.jsx";
import Connect from "./pages/Connect.jsx";
import Trades from "./pages/Trades.jsx";
import Profile from "./pages/Profile.jsx";
import Navigate from "./pages/Navigate.jsx";
import Chat from "./pages/Chat.jsx";

export default function App() {
  const [ready, setReady] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await getProfile();
      if (p) {
        await ensureIdentity();          // backfill keys for pre-signing profiles
        pruneStalePeers().catch(() => {}); // bound storage growth (fire-and-forget)
        initNotifications().catch(() => {}); // ask for notification permission
      }
      setHasProfile(!!p);
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen bg-barter-bg flex items-center justify-center">
        <div className="text-barter-accent animate-pulse text-2xl">⟳</div>
      </div>
    );
  }

  if (!hasProfile) {
    return (
      <ToastProvider>
        <Onboarding onDone={() => setHasProfile(true)} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      {/* MeshProvider runs the BLE mesh continuously, regardless of current page */}
      <MeshProvider>
        <HashRouter>
          <div className="flex flex-col h-screen">
            <main className="flex-1 overflow-hidden">
              <Routes>
                <Route path="/"          element={<Market />} />
                <Route path="/my-items"  element={<MyItems />} />
                <Route path="/connect"   element={<Connect />} />
                <Route path="/trades"    element={<Trades />} />
                <Route path="/profile"   element={<Profile onReset={() => setHasProfile(false)} />} />
                <Route path="/navigate"  element={<Navigate />} />
                <Route path="/chat"      element={<Chat />} />
              </Routes>
            </main>
            {/* Hide bottom nav on full-screen pages */}
            <Routes>
              <Route path="/navigate" element={null} />
              <Route path="/chat"     element={null} />
              <Route path="*"         element={<BottomNav />} />
            </Routes>
          </div>
        </HashRouter>
      </MeshProvider>
    </ToastProvider>
  );
}
