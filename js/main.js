(function (HR) {
  const params = new URLSearchParams(location.search);
  const STORE = 'hr.board.v2', OLD_STORE = 'hr.board.v1';

  const store = {
    load() {
      try { return JSON.parse(localStorage.getItem(STORE)) || JSON.parse(localStorage.getItem(OLD_STORE)) || {}; }
      catch (e) { return {}; }
    },
    save(obj) { try { localStorage.setItem(STORE, JSON.stringify(obj)); } catch (e) { /* storage unavailable */ } }
  };

  const saved = store.load();
  // Demo roster: saved profile edits (name / age / weight / present) merged onto the defaults.
  let roster = HR.ROSTER.map(p => ({ ...p, ...((saved.roster || []).find(s => s.id === p.id) || {}) }));
  const nParam = parseInt(params.get('n'), 10);
  if (nParam) roster.forEach((p, i) => { p.present = i < nParam; });

  // Real board: the people of this studio and the watch each one wore last time.
  let people = Array.isArray(saved.people) ? saved.people.map(p => ({ ...p })) : [];

  let speed = parseInt(params.get('speed'), 10) || saved.speed || 1;
  let layout = saved.layout || 'ref';
  // 'live' = real watches only. 'demo' = the simulated class, kept as a showcase.
  const devDemo = params.get('n') || params.get('speed') || params.get('summary');
  let mode = params.get('mode') || (devDemo ? 'demo' : saved.mode) || 'live';
  if (mode !== 'demo') mode = 'live';

  const session = new HR.Session();
  const ui = new HR.UI(session);
  const demo = new HR.DemoSource(session, () => ui.update());
  demo.speed = speed;

  const $ = s => document.querySelector(s);
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

  /** Connected watches by device id: { id, src, userId, name, state: 'on' | 'lost' }. */
  const watches = new Map();
  const watchOf = userId => { for (const w of watches.values()) if (w.userId === userId) return w; return null; };
  ui.watchState = id => (mode === 'demo' ? 'demo' : (watchOf(id) || { state: 'none' }).state);

  function persist() { store.save({ roster, people, speed, layout, mode }); }
  function applyLayout() { document.body.dataset.layout = layout; }

  /* ---------- status chip ---------- */
  const chip = $('#watchChip'), chipText = $('#chipText'), chipAct = $('#chipAct');
  let chipTimer = null, chipRun = null;
  function restChip() {
    const n = watches.size;
    chip.hidden = mode !== 'live' || n === 0;
    chip.dataset.state = '';
    chipText.textContent = n === 1 ? 'שעון אחד מחובר' : n + ' שעונים מחוברים';
    chipAct.hidden = true; chipRun = null;
  }
  /** A short message next to the buttons. ms = 0 keeps it until the next message. */
  function flash(text, state, ms = 6000, action) {
    clearTimeout(chipTimer);
    chip.hidden = false;
    chip.dataset.state = state || '';
    chipText.textContent = text;
    chipAct.hidden = !action;
    chipRun = action ? action.run : null;
    if (action) chipAct.textContent = action.label;
    if (ms) chipTimer = setTimeout(restChip, ms);
  }
  chipAct.addEventListener('click', () => { const run = chipRun; restChip(); if (run) run(); });

  /* ---------- workouts ---------- */
  let liveTimer = null, liveRunning = false;

  /* ---------- saving workouts to the server ----------
     A workout is saved under one key, so saving again only updates it: once a minute while it runs,
     when it ends, and before the board is reset or switched to the demo. If the server cannot be
     reached the workout stays marked unsaved and the next save tries again. */
  let sessionKey = null, sessionStart = 0, unsaved = false, saveChain = Promise.resolve(), warnedSave = false;
  const newKey = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /** One value per 5 seconds (average), enough to redraw the workout later. */
  function thin(h, step = 5) {
    const out = [];
    for (let i = 0; i < h.length; i += step) {
      const part = h.slice(i, i + step);
      out.push(Math.round(part.reduce((a, b) => a + b, 0) / part.length));
    }
    return out;
  }

  function buildPayload() {
    const results = session.users.filter(u => u.n > 0).map(u => ({
      id: u.id, name: u.name, age: u.ageAtStart, weight: u.weight, sex: u.sex, maxHr: u.maxHr,
      avgHr: session.avgOf(u), peakHr: u.peak, kcal: u.kcal, points: u.points,
      zoneSecs: u.zoneSecs.map(v => Math.round(v * 10) / 10), series: thin(u.history)
    }));
    return results.length ? { id: sessionKey, startedAt: sessionStart, durationS: Math.round(session.elapsed), results } : null;
  }

  /** Resolves to 'saved', 'failed' or 'none' (nothing to save). */
  function saveSession() {
    if (mode !== 'live' || !sessionKey || !unsaved) return Promise.resolve('none');
    const payload = buildPayload();
    if (!payload) return Promise.resolve('none');
    unsaved = false;                                   // a heartbeat that arrives meanwhile marks it again
    saveChain = saveChain.then(async () => {
      try { await HR.Api.saveSession(payload); warnedSave = false; return 'saved'; }
      catch (e) { unsaved = true; return 'failed'; }
    });
    return saveChain;
  }

  function setSaveNote(text, state) {
    const n = $('#sumSave');
    n.textContent = text || '';
    n.dataset.state = state || '';
  }

  setInterval(async () => {
    if (mode !== 'live' || session.ended) return;
    if (await saveSession() === 'failed' && !warnedSave) {
      warnedSave = true;
      flash('האימון לא נשמר בשרת. ננסה שוב בעוד דקה', 'error', 10000);
    }
  }, 60000);

  /** Real board: the clock starts with the first heartbeat that arrives. */
  function startLive() {
    demo.stop();
    clearInterval(liveTimer);
    saveSession();                                     // keep the workout that is about to be replaced
    sessionKey = null; unsaved = false;
    session.setUsers(people.filter(p => watchOf(p.id)));   // the board shows whoever is connected now
    liveRunning = false;
    ui.build();
    ui.showLive();
    liveTimer = setInterval(() => {
      if (liveRunning && !session.ended) session.elapsed += 1;
      ui.update();
    }, 1000);
  }

  /** Demo: ages are read now, and max HR / zones are fixed from them. */
  function startDemo() {
    clearInterval(liveTimer); liveTimer = null;
    demo.stop();
    demo.skip.clear();
    const present = roster.filter(p => p.present);
    session.setUsers(present.length >= 1 ? present : roster.slice(0, 1));
    demo.init();
    demo.prime(1500);         // open mid-class so the screen is alive immediately
    ui.build();
    ui.showLive();
    demo.start();
  }

  function startWorkout() { mode === 'demo' ? startDemo() : startLive(); }

  function endWorkout() {
    demo.stop();
    session.ended = true;
    ui.showSummary();
    setSaveNote(mode === 'live' && unsaved ? 'שומר בהיסטוריה…' : '', '');
    saveSession().then(r => {
      if (r === 'saved') setSaveNote('האימון נשמר בהיסטוריה', 'ok');
      else if (r === 'failed') setSaveNote('האימון עוד לא נשמר: אין חיבור לשרת. ננסה שוב מעצמנו', 'error');
      else if (mode === 'live' && sessionKey) setSaveNote('האימון נשמר בהיסטוריה', 'ok');
    });
  }

  function setMode(m) {
    if (mode === 'live') saveSession();                // leaving the real board: keep what was measured
    mode = m === 'demo' ? 'demo' : 'live';
    document.body.dataset.mode = mode;
    $('#modeChip').hidden = mode !== 'demo';
    $('#btnDemo').textContent = mode === 'demo' ? 'חזרה ללוח האמיתי' : 'הדגמה';
    persist();
    startWorkout();
    clearTimeout(chipTimer); restChip();
  }

  /** Bring the running session in line with the people list without losing anyone's numbers. */
  function syncLive() {
    if (mode !== 'live') return;
    // On the board: trainees with a connected watch, and anyone who already has numbers this workout.
    for (const p of people) {
      if (session.byId(p.id)) session.updateProfile(p.id, p);
      else if (watchOf(p.id)) session.addUser(p);
    }
    for (const u of [...session.users]) {
      if (!people.some(p => p.id === u.id) || (!watchOf(u.id) && !u.n)) session.removeUser(u.id);
    }
    ui.build();
    ui.update();
  }

  /* ---------- watches ---------- */
  function onBpm(devId, bpm, dt) {
    const w = watches.get(devId);
    if (!w || mode !== 'live' || session.ended) return;
    w.state = 'on';
    if (!liveRunning) { liveRunning = true; if (!sessionKey) { sessionKey = newKey(); sessionStart = Date.now(); } }
    unsaved = true;
    session.push(w.userId, bpm, dt);
    ui.update();
  }

  function dropWatch(devId) {
    const w = watches.get(devId);
    if (!w) return;
    watches.delete(devId);
    try { w.src.disconnect(); } catch (e) { /* already gone */ }
  }

  const newPerson = (over = {}) => ({ id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), name: 'מתאמן ' + (people.length + 1), age: 30, weight: 70, sex: 'f', ...over });

  /** Ask who wears the watch that was just connected. Resolves to a person, or null on cancel. */
  function askAssign(deviceName) {
    return new Promise(resolve => {
      const dlg = $('#assign'), who = $('#asWho');
      const free = people.filter(p => !watchOf(p.id));
      $('#asName').textContent = deviceName;
      who.innerHTML = '';
      for (const p of free) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; who.appendChild(o); }
      const o = document.createElement('option'); o.value = '__new'; o.textContent = 'מתאמן חדש'; who.appendChild(o);
      who.value = '__new';
      $('#asWhoWrap').hidden = free.length === 0;
      $('#asPName').value = '';
      $('#asPName').placeholder = 'מתאמן ' + (people.length + 1);
      const showNew = () => { $('#asNew').hidden = who.value !== '__new'; };
      who.onchange = showNew; showNew();
      dlg.returnValue = '';
      dlg.addEventListener('close', () => {
        if (dlg.returnValue !== 'ok') return resolve(null);
        if (who.value !== '__new') return resolve(people.find(p => p.id === who.value) || null);
        const num = (el, lo, hi, d) => { const v = parseInt(el.value, 10); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
        const p = newPerson({
          name: $('#asPName').value.trim() || $('#asPName').placeholder,
          age: num($('#asAge'), 10, 95, 30), weight: num($('#asWeight'), 30, 200, 70),
          sex: $('#asSex').value === 'm' ? 'm' : 'f'
        });
        people.push(p);
        resolve(p);
      }, { once: true });
      dlg.showModal();
      setTimeout(() => $('#asPName').focus(), 50);
    });
  }

  /** Attach a connected source (Bluetooth watch or the local bridge) to a person. */
  async function attach(devId, src, name, forId) {
    const old = watches.get(devId);
    let person = forId ? people.find(p => p.id === forId) : null;
    if (!person && old) person = people.find(p => p.id === old.userId);
    if (!person) person = people.find(p => p.deviceId === devId && !watchOf(p.id));
    if (!person) person = await askAssign(name);
    if (!person) return null;
    const prev = watchOf(person.id);
    if (prev && prev.id !== devId) dropWatch(prev.id);      // one watch per person
    person.deviceId = devId; person.deviceName = name;
    watches.set(devId, { id: devId, src, userId: person.id, name, state: 'on' });
    persist();
    if (!session.byId(person.id)) session.addUser(person);
    ui.build(); ui.update();
    refillPeople();
    flash(name + ' מחובר, משויך אל ' + person.name);
    return person;
  }

  async function connectWatch(opt = {}) {
    if (mode !== 'live') return;
    if (isLocal && !watches.has('bridge') && await bridgeAlive()) return connectBridge(opt.forId);
    if (!HR.BleSource.supported) { showHelp(); return; }

    let devId = null;
    const src = new HR.BleSource(
      (bpm, dt) => { if (devId) onBpm(devId, bpm, dt); },
      (state, info) => {
        if (state === 'choosing') flash('בוחרים את השעון מהרשימה של הדפדפן', 'wait', 0);
        else if (state === 'connecting') flash('מתחבר אל ' + info.name, 'wait', 0);
        else if (state === 'reconnecting') { const w = watches.get(devId); if (w) w.state = 'lost'; flash(info.name + ' התנתק, מנסה לחבר מחדש', 'wait', 0); ui.update(); }
        else if (state === 'connected' && info.again) { const w = watches.get(devId); if (w) w.state = 'on'; flash(info.name + ' חזר להיות מחובר'); ui.update(); }
        else if (state === 'disconnected' && devId && watches.get(devId) && watches.get(devId).src === src) {
          watches.delete(devId);
          if (!info || !info.manual) flash(((info && info.name) || 'השעון') + ' התנתק. לוחצים על "חיבור שעון" כדי לחבר שוב', 'error', 12000);
          syncLive(); refillPeople();
        }
      }
    );
    try {
      await src.connect({ all: !!opt.all });
    } catch (e) {
      if (e && e.name === 'NotFoundError') {
        flash(opt.all ? 'לא נבחר מכשיר' : 'לא נבחר שעון. השעון לא הופיע ברשימה?', 'error', 15000,
          opt.all ? null : { label: 'הצגת כל המכשירים', run: () => connectWatch({ ...opt, all: true }) });
      } else if (e && e.message === 'no-hr-service') {
        flash((e.deviceName || 'המכשיר') + ' לא משדר דופק. מפעילים בשעון "שידור דופק" ומנסים שוב', 'error', 15000);
      } else {
        flash('החיבור נכשל: ' + (e && e.message ? e.message : e), 'error', 15000);
      }
      return;
    }
    const id = src.id;
    let name = src.name;
    // Two devices with the same name (two iPhones): add the short tag so each can be told apart.
    if ([...watches.values()].some(w => w.id !== id && w.name === name)) name += ' · ' + HR.BleSource.shortId(id);
    const old = watches.get(id);
    if (old && old.src !== src) { old.src.manual = true; old.src._cleanup(); }   // same watch picked twice
    devId = id;
    const person = await attach(id, src, name, opt.forId);
    if (!person) { devId = null; if (!old) src.disconnect(); else watches.delete(id); restChip(); flash('החיבור בוטל', '', 4000); }
  }

  /* Local bridge (tools/hr_bridge.py): reads one watch through Windows when the browser
     cannot see it. Only tried when the board itself runs on this computer. */
  async function bridgeAlive() {
    try {
      const c = new AbortController(); setTimeout(() => c.abort(), 1200);
      const r = await fetch('http://127.0.0.1:5174/hr', { cache: 'no-store', signal: c.signal });
      return r.ok;
    } catch (e) { return false; }
  }
  async function connectBridge(forId) {
    let timer = null, name = 'שעון דרך הגשר';
    try { const d = await (await fetch('http://127.0.0.1:5174/hr', { cache: 'no-store' })).json(); if (d.name) name = d.name; } catch (e) { /* keep default name */ }
    const src = { disconnect() { clearInterval(timer); } };
    const person = await attach('bridge', src, name, forId);
    if (!person) { flash('החיבור בוטל', '', 4000); return; }
    timer = setInterval(async () => {
      const w = watches.get('bridge');
      if (!w) { clearInterval(timer); return; }
      try {
        const d = await (await fetch('http://127.0.0.1:5174/hr', { cache: 'no-store' })).json();
        if (d.connected && d.bpm > 0 && d.age != null && d.age < 5) onBpm('bridge', d.bpm, 1);
        else if (w.state !== 'lost') { w.state = 'lost'; ui.update(); }
      } catch (e) {
        watches.delete('bridge'); clearInterval(timer);
        flash('הגשר המקומי נעצר. מפעילים שוב את start_bridge.bat', 'error', 12000);
        ui.update(); refillPeople();
      }
    }, 1000);
  }

  function showHelp() {
    $('#helpUnsupported').hidden = HR.BleSource.supported || isLocal;
    $('#help').showModal();
  }

  /* ---------- settings: people & watches ---------- */
  function refillPeople() { ui.fillPeople(people, id => watchOf(id)); }
  function applyPeopleEdits() {
    if (mode !== 'live') return;
    people = ui.readPeople(people);
    persist();
    syncLive();
  }
  ui.onPeople = async (act, id) => {
    if ($('#settings').open) applyPeopleEdits();          // keep what was typed before the table is rebuilt
    if (act === 'watch') await connectWatch({ forId: id });
    else if (act === 'unwatch') { const w = watchOf(id); if (w) { dropWatch(w.id); flash(w.name + ' נותק', '', 4000); syncLive(); } }
    else if (act === 'remove') {
      const p = people.find(x => x.id === id);
      if (!p || !confirm('להסיר את ' + p.name + ' מהלוח?')) return;
      const w = watchOf(id); if (w) dropWatch(w.id);
      people = people.filter(x => x.id !== id);
      persist(); syncLive();
    }
    refillPeople(); ui.update();
  };
  $('#btnAddPerson').addEventListener('click', () => {
    applyPeopleEdits();
    people.push(newPerson());
    persist(); syncLive(); refillPeople();
    const rows = document.querySelectorAll('#peopleTable tbody tr');
    const last = rows[rows.length - 1];
    if (last) { const inp = last.querySelector('.r-name-in'); inp.focus(); inp.select(); }
  });

  /* ---------- controls ---------- */
  $('#speedIn').value = String(speed);
  $('#layoutIn').value = layout;
  $('#speedIn').addEventListener('change', e => { speed = parseInt(e.target.value, 10); demo.setSpeed(speed); persist(); });
  $('#layoutIn').addEventListener('change', e => { layout = e.target.value; applyLayout(); persist(); setTimeout(() => ui.update(), 0); });

  const settings = $('#settings');
  function fillSettings() { ui.fillRoster(roster); refillPeople(); }
  $('#btnSettings').addEventListener('click', fillSettings);
  settings.addEventListener('close', () => {
    const rv = settings.returnValue;
    settings.returnValue = '';
    if (rv !== 'start' && rv !== 'save') return;
    if (mode === 'demo') { roster = ui.readRoster(roster); persist(); startWorkout(); }
    else applyPeopleEdits();
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 's' || e.key === 'S' || e.key === 'ד') && !e.target.closest('input,select')) fillSettings();
  });

  $('#btnEnd').addEventListener('click', () => {
    if (confirm('לסיים את האימון ולהציג סיכום?')) endWorkout();
  });
  $('#btnBack').addEventListener('click', () => { session.ended = false; setSaveNote(''); ui.showLive(); if (mode === 'demo') demo.start(); });
  $('#btnNew').addEventListener('click', () => {
    if (mode === 'demo') { fillSettings(); settings.showModal(); }
    else startLive();                                     // same people and watches, numbers from zero
  });

  $('#btnWatch').addEventListener('click', () => connectWatch());
  $('#btnWatch2').addEventListener('click', () => connectWatch());
  const toggleDemo = () => setMode(mode === 'demo' ? 'live' : 'demo');
  $('#btnDemo').addEventListener('click', toggleDemo);
  $('#btnDemo2').addEventListener('click', toggleDemo);
  $('#btnHelp').addEventListener('click', showHelp);
  $('#btnHelp2').addEventListener('click', showHelp);

  // Signed-in build only: the login page sets HR_AUTH before it loads the board.
  if (window.HR_AUTH && typeof window.HR_AUTH.logout === 'function') {
    $('#btnLogout').hidden = false;
    $('#btnLogout').addEventListener('click', () => { if (confirm('לצאת מהחשבון במחשב הזה?')) window.HR_AUTH.logout(); });
  }

  window.addEventListener('resize', () => ui.update());
  applyLayout();
  fillSettings();
  setMode(mode);

  if (params.get('summary') === '1') endWorkout();   // handy for design checks
})(window.HR);
