import { useEffect, useRef, useState } from "react";
import { Contract } from "ethers";
import { useWeb3 } from "../../Web3Context.jsx";
import { VAULT_ABI } from "../../abis/Vault.js";
import { txError } from "./format.js";

// The check-in panel: the countdown ring, the selected vault's dates, a
// heartbeat trace, and the one button that matters.

// Circumference of the ring's r=84 circle.
const C = 527.8;

// Scrolling heartbeat. It beats faster while the vault is comfortably armed,
// slower once a check-in is due, and flatlines once the vault is finished.
// Setting `beat.current = 1` fires a beat immediately.
function useHeartbeat(canvasRef, phase, beat) {
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const canvas = canvasRef.current;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const samples = [];
    let ctx, W, H;
    let sinceBeat = 0;
    let raf = 0;

    function fit() {
      const d = Math.min(devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * d;
      canvas.height = H * d;
      ctx = canvas.getContext("2d");
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }

    function push(dt) {
      const p = phaseRef.current;
      sinceBeat += dt;
      if (p !== "released" && p !== "closed" && sinceBeat > (p === "ok" ? 1.1 : 1.7)) {
        sinceBeat = 0;
        beat.current = 1;
      }
      let v = 0;
      if (beat.current > 0) {
        const u = 1 - beat.current;
        v = u < 0.15 ? -u * 2 : u < 0.3 ? (u - 0.15) * 9 - 0.3 : u < 0.45 ? 1.05 - (u - 0.3) * 11 : u < 0.6 ? -0.6 + (u - 0.45) * 4 : 0;
        beat.current -= dt * 3.2;
      }
      samples.push(v);
      if (samples.length > 240) samples.shift();
    }

    function draw() {
      // The canvas carries the vault's tone class, so its text colour is the trace colour.
      const c = getComputedStyle(canvas).color;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.shadowColor = c;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const px = W - (samples.length - 1 - i) * (W / 240);
        const py = H * 0.6 - samples[i] * H * 0.42;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }

    fit();
    for (let j = 0; j < 240; j++) push(1 / 60);
    draw();

    const onResize = () => {
      fit();
      draw();
    };
    addEventListener("resize", onResize);

    if (!reduce) {
      let last = performance.now();
      const loop = (t) => {
        const dt = Math.min(0.05, (t - last) / 1000);
        last = t;
        push(dt);
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
    };
  }, [canvasRef, beat]);
}

function Ring({ ringRef, tone, fill, big, caption }) {
  // Starts empty and sweeps to its value, like the rest of the page's entrance.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => setDrawn(true), []);

  return (
    <div className="ring" ref={ringRef}>
      <svg viewBox="0 0 200 200" role="img" aria-label={`${big} ${caption}`}>
        <circle className="ticks" cx="100" cy="100" r="96" fill="none" stroke="var(--line-2)" strokeDasharray="1 5.700" />
        <circle cx="100" cy="100" r="84" fill="none" stroke="var(--line)" strokeWidth="7" />
        <circle
          id="arc"
          className={tone}
          cx="100"
          cy="100"
          r="84"
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          style={{ strokeDashoffset: C * (1 - (drawn ? fill : 0)) }}
        />
      </svg>
      <div className="mid">
        <div id="days">{big}</div>
        <div className="label">{caption}</div>
      </div>
    </div>
  );
}

// With `onManage` the panel is the overview's summary and links to the vault's
// own page; without it, it carries the vault's money controls.
export default function Pulse({ vault, view, onDone, onError, onManage, onDeposit, onWithdraw, onCloseVault }) {
  const { signer } = useWeb3();
  const [busy, setBusy] = useState(null);
  const ringRef = useRef(null);
  const canvasRef = useRef(null);
  const beat = useRef(0);
  useHeartbeat(canvasRef, view.phase, beat);

  const editable = vault.storedState === "Active";
  // Money put into a vault whose window has already closed goes to its
  // beneficiaries unless the owner also checks in, so that comes first.
  const lapsed = view.phase === "grace" || view.phase === "due";
  const canCheckIn = ["Active", "Due"].includes(vault.storedState);

  async function send(label, call, message, celebrate) {
    setBusy(label);
    try {
      await (await call(new Contract(vault.address, VAULT_ABI, signer))).wait();
      if (celebrate) {
        beat.current = 1;
        const ring = ringRef.current;
        ring.classList.remove("hit");
        void ring.offsetWidth;
        ring.classList.add("hit");
      }
      await onDone({ message });
    } catch (err) {
      onError(txError(err, "Transaction failed"));
    } finally {
      setBusy(null);
    }
  }

  const checkIn = () =>
    send("checkin", (c) => c.checkIn(), `Checked in. ${view.name} is reset to ${view.window}.`, true);
  const payOut = () => send("payout", (c) => c.distribute(), `${view.name} paid out to every beneficiary.`);

  return (
    <section className="box span2 pulse" aria-label="Check-in status">
      <Ring ringRef={ringRef} tone={view.tone} fill={view.fill} big={view.big} caption={view.caption} />
      <div className="pinfo">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 id="vName">{view.name}</h2>
          <span className={`pill ${view.tone}`} id="vState">
            {view.state}
          </span>
        </div>
        <div className="facts">
          <div>
            <span className="label">Check in by</span>
            <b id="vDue">{view.due}</b>
          </div>
          <div>
            <span className="label">Window</span>
            <b id="vWin">{view.window}</b>
          </div>
          <div>
            <span className="label">Grace period</span>
            <b>{view.grace}</b>
          </div>
        </div>
        <canvas id="ecg" className={view.tone} ref={canvasRef} aria-hidden="true"></canvas>
        <div className="go">
          <button className="btn solid big" id="checkBtn" type="button" onClick={checkIn} disabled={Boolean(busy) || !canCheckIn}>
            {busy === "checkin" ? "Checking in…" : "I'm still here · Check in"}
          </button>
          {view.phase === "due" && (
            <button className="btn big" type="button" onClick={payOut} disabled={Boolean(busy)}>
              {busy === "payout" ? "Paying out…" : "Pay out now"}
            </button>
          )}
        </div>
        <div className="manage">
          {onManage ? (
            <button className="btn" type="button" onClick={onManage}>
              Manage vault
            </button>
          ) : (
            <>
              <button
                className="btn"
                type="button"
                onClick={onDeposit}
                disabled={!editable || lapsed}
                title={lapsed ? "Check in first: this vault's window has closed" : undefined}
              >
                Deposit
              </button>
              <button className="btn" type="button" onClick={onWithdraw} disabled={!editable}>
                Withdraw
              </button>
              <button className="btn" type="button" onClick={onCloseVault} disabled={!editable}>
                Close vault
              </button>
            </>
          )}
        </div>
        {lapsed && !onManage && editable && (
          <p className="hint">Check in before depositing: this vault's window has closed and it pays out next.</p>
        )}
      </div>
    </section>
  );
}

// Shown in the same slot before the wallet has a vault.
export function EmptyPulse({ loading, onCreate }) {
  return (
    <section className="box span2 pulse" aria-label="Check-in status">
      <Ring tone="off" fill={0} big="–" caption={loading ? "loading" : "no vault yet"} />
      <div className="pinfo">
        <h2>{loading ? "Reading your vaults…" : "Create your first vault"}</h2>
        {!loading && (
          <>
            <p style={{ color: "var(--mute)" }}>
              Put aside what you'd want your family to have, name them, and pick how often you'll confirm you're still
              here. If one day you can't, the vault pays them.
            </p>
            <div>
              <button className="btn solid big" type="button" onClick={onCreate}>
                + New vault
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
