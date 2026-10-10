// The landing page's motion and its working vault model: starfield, pointer
// tilt, scroll reveal, and the check-in simulation in the demo panel. Drives
// the markup in Landing.jsx by id; returns a function that undoes all of it.
export function mountLanding() {
  var ac = new AbortController(), on = {signal: ac.signal}, raf = 0, stopped = false, io;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function(id){ return document.getElementById(id); };

  // nav border
  var nav = $('nav');
  addEventListener('scroll', function(){ nav.classList.toggle('stuck', scrollY > 10); }, {passive:true, signal:ac.signal});

  // pointer tilt + glow shift
  var hero = $('hero'), fan = $('fan');
  if (!reduce) hero.addEventListener('pointermove', function(e){
    var r = hero.getBoundingClientRect(), x = (e.clientX-r.left)/r.width-.5, y = (e.clientY-r.top)/r.height-.5;
    fan.style.setProperty('--ry', (x*16).toFixed(2)+'deg');
    fan.style.setProperty('--rx', (-y*10).toFixed(2)+'deg');
    hero.style.setProperty('--gx', (x*120).toFixed(0)+'px');
  }, on);
  $('trustGrid').addEventListener('pointermove', function(e){
    var t = e.target.closest('.t'); if(!t) return;
    var r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX-r.left)+'px'); t.style.setProperty('--my', (e.clientY-r.top)+'px');
  }, on);

  // scroll reveal
  if ('IntersectionObserver' in window){
    io = new IntersectionObserver(function(es){ es.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } }); }, {threshold:.12});
    document.querySelectorAll('.rv').forEach(function(el){ io.observe(el); });
  } else document.querySelectorAll('.rv').forEach(function(el){ el.classList.add('in'); });

  function fit(c){
    var d = Math.min(devicePixelRatio||1, 2), w = c.clientWidth, h = c.clientHeight;
    c.width = w*d; c.height = h*d;
    var x = c.getContext('2d'); x.setTransform(d,0,0,d,0,0);
    return {x:x, w:w, h:h};
  }

  // starfield
  var sc = $('stars'), S = fit(sc), stars = [];
  for (var k=0;k<130;k++) stars.push({x:Math.random(), y:Math.random(), r:Math.random()*1.2+.2, p:Math.random()*6.28, v:Math.random()*.012+.003});
  function drawStars(t){
    S.x.clearRect(0,0,S.w,S.h);
    for (var i=0;i<stars.length;i++){
      var s = stars[i];
      if(!reduce){ s.y -= s.v/60; if(s.y<0) s.y = 1; }
      S.x.globalAlpha = .25 + .55*Math.abs(Math.sin(t/1400 + s.p));
      S.x.fillStyle = '#dcd5ff';
      S.x.beginPath(); S.x.arc(s.x*S.w, s.y*S.h, s.r, 0, 6.28); S.x.fill();
    }
  }

  // ---- vault simulation ----
  var TOTAL = 90, GRACE = 7, C = 527.8;
  var left = 62, grace = GRACE, silent = false, released = false, warned = {};
  var arc = $('arc'), num = $('num'), unit = $('unit'), state = $('state'), log = $('log'), box = $('demoBox'), ringbox = $('ringbox');
  var bCheck = $('checkin'), bSilent = $('silent'), bReset = $('reset');
  var heirs = [].slice.call(document.querySelectorAll('.heir'));
  var pct = ['50%','30%','20%'];
  var css = getComputedStyle(document.documentElement);
  var COL = {ok:css.getPropertyValue('--accent').trim(), warn:css.getPropertyValue('--warn').trim(), alert:css.getPropertyValue('--alert').trim(), hi:css.getPropertyValue('--accent-hi').trim()};

  function say(msg){
    var li = document.createElement('li'); li.textContent = msg; log.prepend(li);
    while (log.children.length > 4) log.lastChild.remove();
  }
  function phase(){ return released ? 'released' : left <= 0 ? 'grace' : left <= 14 ? 'warn' : 'ok'; }
  function color(){ var p = phase(); return p==='ok' ? COL.ok : p==='warn' ? COL.warn : p==='grace' ? COL.alert : COL.hi; }
  function paint(){
    var p = phase(), c = color();
    arc.style.color = c; state.style.color = c;
    if (p === 'released'){ arc.style.strokeDashoffset = 0; num.textContent = '✓'; unit.textContent = 'released to 3 people'; state.textContent = 'Released'; }
    else if (p === 'grace'){ arc.style.strokeDashoffset = C*(1-grace/GRACE); num.textContent = Math.ceil(grace); unit.textContent = 'days of grace left'; state.textContent = 'Grace period'; }
    else { arc.style.strokeDashoffset = C*(1-left/TOTAL); num.textContent = Math.ceil(left); unit.textContent = 'days to check in'; state.textContent = p==='warn' ? 'Check in soon' : 'Armed'; }
  }
  function countUp(el, to, share){
    var t0 = performance.now();
    (function f(t){
      var k = Math.min(1,(t-t0)/1600), v = Math.round(to*(1-Math.pow(1-k,3)));
      el.textContent = v.toLocaleString('en-US')+' USDC · paid';
      if (k<1 && !stopped) requestAnimationFrame(f);
    })(t0);
  }
  function release(){
    released = true; box.classList.add('released');
    heirs.forEach(function(h){ countUp(h.querySelector('.v'), +h.dataset.amt); });
    say('Grace period ended. Vault released to 3 beneficiaries.');
    bCheck.disabled = true; bSilent.hidden = true; bReset.hidden = false;
  }
  function step(dt){
    if (released) return;
    var d = dt * (silent ? 14 : 1.1);
    if (left > 0){
      left = Math.max(0, left - d);
      [14,7,1].forEach(function(w){ if (left <= w && !warned[w]){ warned[w] = 1; say('Calendar alert: '+w+' day'+(w>1?'s':'')+' left to check in.'); } });
      if (left === 0) say('Window missed. '+GRACE+'-day grace period started.');
    } else {
      grace -= dt * (silent ? 2.2 : 1.1);
      if (grace <= 0) release();
    }
  }
  function resetTimer(){ left = TOTAL; grace = GRACE; warned = {}; silent = false; bSilent.textContent = 'Go silent'; }
  bCheck.addEventListener('click', function(){
    if (released) return;
    resetTimer(); say('Checked in. Timer reset to '+TOTAL+' days.');
    ringbox.classList.remove('pulse'); void ringbox.offsetWidth; ringbox.classList.add('pulse');
    beat = 1; paint();
  }, on);
  bSilent.addEventListener('click', function(){
    silent = !silent; bSilent.textContent = silent ? 'Pause' : 'Go silent';
    if (silent) say('Owner has gone silent. Time is running faster.');
  }, on);
  bReset.addEventListener('click', function(){
    released = false; box.classList.remove('released'); resetTimer(); left = 62;
    heirs.forEach(function(h,i){ h.querySelector('.v').textContent = pct[i]+' · locked'; });
    bCheck.disabled = false; bSilent.hidden = false; bReset.hidden = true;
    log.innerHTML = ''; say('Vault armed. Check-in window is '+TOTAL+' days.'); paint();
  }, on);

  // heartbeat trace
  var ec = $('ecg'), E = fit(ec), samples = [], beat = 0, bt = 0;
  function pushSample(dt){
    var p = phase(), period = p==='ok' ? 1.1 : p==='warn' ? 1.5 : 2.2;
    bt += dt;
    if (p !== 'released' && bt > period){ bt = 0; beat = 1; }
    var v = 0;
    if (beat > 0){
      var u = 1-beat, amp = p==='grace' ? .4 : 1;
      v = (u<.15 ? -u*2 : u<.3 ? (u-.15)*9-.3 : u<.45 ? 1.05-(u-.3)*11 : u<.6 ? -.6+(u-.45)*4 : 0) * amp;
      beat -= dt*3.2;
    }
    samples.push(v); if (samples.length > 260) samples.shift();
  }
  function drawEcg(){
    var x = E.x, n = 260, mid = E.h*.6;
    x.clearRect(0,0,E.w,E.h);
    x.strokeStyle = color(); x.lineWidth = 1.6; x.lineJoin = 'round'; x.shadowColor = color(); x.shadowBlur = 10;
    x.beginPath();
    for (var i=0;i<samples.length;i++){
      var px = E.w - (samples.length-1-i)*(E.w/n), py = mid - samples[i]*E.h*.42;
      i ? x.lineTo(px,py) : x.moveTo(px,py);
    }
    x.stroke(); x.shadowBlur = 0;
  }
  for (var j=0;j<260;j++) pushSample(1/60);

  addEventListener('resize', function(){ S = fit(sc); E = fit(ec); drawStars(0); drawEcg(); }, on);

  paint(); drawStars(0); drawEcg();
  function unmount(){ stopped = true; cancelAnimationFrame(raf); ac.abort(); if (io) io.disconnect(); }
  if (reduce) return unmount;
  var last = performance.now();
  (function loop(t){
    var dt = Math.min(.05,(t-last)/1000); last = t;
    drawStars(t); step(dt); pushSample(dt); paint(); drawEcg();
    if (!stopped) raf = requestAnimationFrame(loop);
  })(last);
  return unmount;
}
