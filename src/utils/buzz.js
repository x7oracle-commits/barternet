// Yahoo-Messenger-style "buzz": a short, harsh nudge — generated with the Web
// Audio API (no audio file needed, works fully offline) plus a haptic vibration.

let audioCtx = null;

function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  // Browsers suspend the context until a user gesture; resume opportunistically.
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** Play the buzz sound + vibrate the device. Safe to call anywhere. */
export function playBuzz() {
  try {
    const ac = ctx();
    if (ac) {
      const now = ac.currentTime;
      // Two quick low-frequency rasps, like the classic IM buzz.
      [0, 0.22].forEach((offset) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(200, now + offset);
        osc.frequency.exponentialRampToValueAtTime(120, now + offset + 0.18);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.22);
      });
    }
  } catch { /* audio not available */ }

  try { navigator.vibrate?.([140, 70, 140]); } catch { /* no haptics */ }
}

/** Briefly shake the whole screen — pairs with the buzz sound. */
export function shakeScreen() {
  try {
    const el = document.body;
    el.classList.remove("buzz-shake");
    // force reflow so the animation restarts if buzzed twice quickly
    void el.offsetWidth;
    el.classList.add("buzz-shake");
    setTimeout(() => el.classList.remove("buzz-shake"), 600);
  } catch { /* no DOM */ }
}
