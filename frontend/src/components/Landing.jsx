import { Fragment, useEffect } from "react";
import { mountLanding } from "./landing/effects.js";
import "../Landing.css";

const HEADLINE = "If you go silent, your assets won't.".split(" ");

const MARQUEE = [
  "You keep your keys",
  "Check in with one transaction",
  "Grace period built in",
  "Change beneficiaries anytime",
  "Withdraw whenever you like",
  "Settles on Monad",
];

// The extruded mark on the middle card: copies of the logo stacked along Z,
// closer than a pixel apart so the sides read as one solid edge. Both end
// faces are bright so it looks right through a full turn.
const LAYERS = 44;
const MARK_LAYERS = Array.from({ length: LAYERS }, (_, i) => ({
  transform: `translateZ(${((i - (LAYERS - 1) / 2) * 0.5).toFixed(2)}px)`,
  color: `hsl(250 ${i === 0 || i === LAYERS - 1 ? "78% 76%" : "48% 30%"})`,
}));

// The public page. Its calls to action open the wallet dialog; everything
// else, including the vault in the demo panel, is a self-contained model.
export default function Landing({ onLaunch }) {
  useEffect(() => mountLanding(), []);

  const launch = (event) => {
    event.preventDefault();
    onLaunch?.();
  };

  return (
    <div className="lp">
<svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
  <symbol id="mark" viewBox="0 0 64 64"><g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round"><path d="M28 10A18 18 0 0 0 28 46"/><path d="M36 54A18 18 0 0 0 36 18"/></g><circle cx="32" cy="32" r="4.5" fill="currentColor"/></symbol>
</svg>

<header className="nav" id="nav">
  <div className="wrap">
    <a className="brand" href="#top"><svg><use href="#mark"/></svg>Legatum Arca</a>
    <nav className="links" aria-label="Sections">
      <a href="#demo">Live demo</a><a href="#how">How it works</a><a href="#trust">Safeguards</a><a href="#faq">Questions</a>
    </nav>
    <a className="btn" href="#demo" onClick={launch}>Open a vault</a>
  </div>
</header>

<main id="top">
<div className="hero" id="hero">
  <div className="aurora"><i className="a1"></i><i className="a2"></i><i className="a3"></i></div>
  <canvas id="stars" aria-hidden="true"></canvas>
  <div className="wrap">
    <div className="pills"><span className="pill"><b>Built on</b> Monad</span><span className="pill">Non-custodial</span><span className="pill">MON and stablecoins</span></div>
    <h1 className="grad" id="h1">
      {HEADLINE.map((word, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="word" style={{ "--i": i }}>{word}</span>
        </Fragment>
      ))}
    </h1>
    <p className="sub">Legatum Arca is a dead man's switch for the MON and stablecoins in your wallet. Create a vault, name the people you trust, and check in on your own schedule. If you ever stop, the vault releases to them.</p>
    <div className="cta"><a className="btn solid" href="#demo" onClick={launch}>Create your vault</a><a className="btn" href="#how">See how it works</a></div>

    <div className="stage" aria-hidden="true">
      <div className="fan" id="fan">
        <div className="card c-left"><div className="card-in">
          <div className="k">Check-in window</div><div className="big">90 days</div><div className="small">+ 7 day grace period</div>
        </div></div>
        <div className="card c-right"><div className="card-in">
          <div className="k">Beneficiary</div><div className="big">Amara Okafor</div><div className="small">50% of vault</div>
        </div></div>
        <div className="card c-mid"><div className="card-in">
          <div className="k">Vault</div>
          <div className="mark3d" id="mark3d">
            {MARK_LAYERS.map((style, i) => (
              <svg key={i} style={style}><use href="#mark"/></svg>
            ))}
          </div>
          <div className="foot"><span>0x7A3f…E21c</span><span><i className="dot"></i>Armed</span></div>
        </div></div>
      </div>
    </div>
  </div>
  <div className="feather"></div>
</div>

<div className="marq" aria-hidden="true"><div id="marq">
  {[...MARQUEE, ...MARQUEE].map((line, i) => (
    <span key={i}>{line}</span>
  ))}
</div></div>

<section id="demo"><div className="wrap">
  <div className="head rv">
    <span className="eyebrow">Try the switch</span>
    <h2>One tap says you're still here.</h2>
    <p>This is a working model of a vault. Check in and the timer resets. Stay silent and watch what your family receives.</p>
  </div>
  <div className="demo rv" id="demoBox">
    <div className="dial">
      <div className="ringbox" id="ringbox">
        <svg viewBox="0 0 200 200" role="img" aria-label="Check-in countdown">
          <circle className="ticks" cx="100" cy="100" r="96" fill="none" stroke="var(--line-2)" strokeWidth="1" strokeDasharray="1 5.7"/>
          <circle cx="100" cy="100" r="84" fill="none" stroke="var(--line)" strokeWidth="6"/>
          <circle id="arc" cx="100" cy="100" r="84" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray="527.8" strokeDashoffset="0" style={{ color: "var(--mint)" }}/>
        </svg>
        <div className="ringtxt"><div id="num">62</div><div id="unit">days to check in</div></div>
      </div>
      <div className="ctrls">
        <button className="btn solid" id="checkin" type="button">Check in</button>
        <button className="btn" id="silent" type="button">Go silent</button>
        <button className="btn" id="reset" type="button" hidden>Reset demo</button>
      </div>
      <div className="sim">Simulation · 1 second ≈ 1 day</div>
    </div>
    <div className="side">
      <div className="status"><div><div className="eyebrow">Example vault</div><div style={{ fontFamily: "var(--display)", fontSize: "30px", letterSpacing: "-.03em" }}>48,250 USDC</div></div><span id="state">Armed</span></div>
      <canvas id="ecg" aria-hidden="true"></canvas>
      <div className="heirs" id="heirs">
        <div className="heir" data-amt="24125"><span><span className="n">Amara</span> <span className="a">0x91bC…4f0A</span></span><span className="v">50% · locked</span><div className="bar"><i></i></div></div>
        <div className="heir" data-amt="14475"><span><span className="n">Tobi</span> <span className="a">0x3De8…a77B</span></span><span className="v">30% · locked</span><div className="bar"><i style={{ transitionDelay: ".25s" }}></i></div></div>
        <div className="heir" data-amt="9650"><span><span className="n">Mum</span> <span className="a">0xF402…19cE</span></span><span className="v">20% · locked</span><div className="bar"><i style={{ transitionDelay: ".5s" }}></i></div></div>
      </div>
      <ul className="log" id="log" aria-live="polite"><li>Vault armed. Check-in window is 90 days.</li></ul>
    </div>
  </div>
</div></section>

<section id="how" style={{ paddingTop: "0" }}><div className="wrap">
  <div className="head rv"><span className="eyebrow">How it works</span><h2>Four steps, then you get on with your life.</h2></div>
  <div className="steps">
    <div className="rail"></div>
    <div className="step rv"><div className="no">1</div><h3>Create a vault</h3><p>Connect your wallet on Monad and deposit the MON, USDC or AUSD you want protected. It stays yours and you can withdraw at any time.</p></div>
    <div className="step rv" style={{ "--rd": ".1s" }}><div className="no">2</div><h3>Name your people</h3><p>Add the wallet addresses of family or friends and set each person's share. Split it any way you like.</p></div>
    <div className="step rv" style={{ "--rd": ".2s" }}><div className="no">3</div><h3>Check in</h3><p>Pick a window, from 30 days to a year. One signed tap before it ends resets the clock. A calendar entry reminds you well ahead.</p></div>
    <div className="step rv" style={{ "--rd": ".3s" }}><div className="no">4</div><h3>Silence releases it</h3><p>Miss the window and a grace period begins. If that passes too, the vault sends each person their share, straight to their wallet.</p></div>
  </div>
</div></section>

<section id="trust" style={{ paddingTop: "0" }}><div className="wrap">
  <div className="head rv"><span className="eyebrow">Safeguards</span><h2>Built so nothing moves by accident.</h2><p>A switch that guards a lifetime of savings has to be hard to trip and impossible to hijack.</p></div>
  <div className="trust rv" id="trustGrid">
    <div className="t"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><h3>Your keys stay yours</h3><p>The vault is a contract only you control. Legatum Arca never holds your keys and cannot move your funds.</p></div>
    <div className="t"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><h3>A grace period you set</h3><p>Add one and a missed check-in starts a second countdown. One tap during it cancels the release, so a long trip costs you nothing.</p></div>
    <div className="t"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><h3>Reminders before the deadline</h3><p>Add a vault's deadline to your calendar and it alerts you 14 days, 7 days and 1 day before your window closes.</p></div>
    <div className="t"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 12h16M12 4v16"/><circle cx="12" cy="12" r="9"/></svg><h3>Nobody is paid early</h3><p>Beneficiaries cannot touch a vault while its timer is running. The contract enforces the dates and no one can override it.</p></div>
    <div className="t"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M4 12h16M4 18h10"/></svg><h3>Change your mind anytime</h3><p>Add or remove people, adjust shares, withdraw funds or close the vault. Every change takes one transaction.</p></div>
    <div className="t"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z"/></svg><h3>Made for Monad</h3><p>Fees are low and blocks land in under a second, so a check-in costs very little and a payout arrives moments after it is sent.</p></div>
  </div>
</div></section>

<section id="faq" style={{ paddingTop: "0" }}><div className="wrap faq">
  <div className="head rv"><span className="eyebrow">Questions</span><h2>What people ask before they trust it.</h2></div>
  <div className="rv">
    <details open><summary>What if I'm fine and I just forget?</summary><p>Your dashboard counts down to the deadline, a calendar entry can alert you before it, and the grace period gives you extra time after it. Checking in at any point before the grace period ends resets everything.</p></details>
    <details><summary>Can my beneficiaries take the funds while I'm alive?</summary><p>No. Nothing can be paid out until both the check-in window and the grace period have passed without a check-in from you.</p></details>
    <details><summary>Do my beneficiaries need to do anything now?</summary><p>Nothing. They only need access to the wallet address you listed. If the vault releases, their share is sent to that wallet automatically.</p></details>
    <details><summary>What happens if I lose access to my wallet?</summary><p>You can no longer check in, so the timer runs out and the vault releases to the people you named. Your funds reach them and are not lost.</p></details>
  </div>
</div></section>

<section className="close"><div className="wrap rv">
  <h2 className="grad">Leave instructions,<br />not a locked wallet.</h2>
  <p>Setting up a vault takes a few minutes. It protects the people you love for as long as you keep it.</p>
  <div className="cta"><a className="btn solid" href="#demo" onClick={launch}>Create your vault</a></div>
</div></section>
</main>

<footer><div className="wrap"><span>Legatum Arca · A dead man's switch for on-chain assets</span><span>Unaudited software · not a legal will · figures shown are examples</span></div></footer>
    </div>
  );
}
