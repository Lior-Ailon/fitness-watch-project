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
  // 'personal' = every trainee has a watch of their own, remembered for the next workout.
  // 'studio'   = the studio owns numbered bracelets, and who wears which one is chosen for each workout.
  let equip = saved.equip === 'studio' ? 'studio' : 'personal';
  /** Studio bracelets by Bluetooth device id: { id, label, deviceName }. The label sticks to the id. */
  // Rooms of the studio. Every workout belongs to one room, chosen before it starts.
  const DEFAULT_ROOMS = [['aerobic', 'אירובי'], ['pilates', 'פילאטיס'], ['spinning', 'ספינינג'], ['crossfit', 'קרוספיט']];
  let rooms = Array.isArray(saved.rooms) && saved.rooms.length
    ? saved.rooms.filter(r => r && r.id && r.name).map(r => ({ id: String(r.id), name: String(r.name) }))
    : DEFAULT_ROOMS.map(([id, name]) => ({ id, name }));
  if (!rooms.length) rooms = DEFAULT_ROOMS.map(([id, name]) => ({ id, name }));
  let roomId = rooms.some(r => r.id === saved.roomId) ? saved.roomId : null;
  const roomName = () => (rooms.find(r => r.id === roomId) || {}).name || '';
  let bracelets = Array.isArray(saved.bracelets) ? saved.bracelets.filter(b => b && b.id).map(b => ({ ...b })) : [];
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

  function persist() { store.save({ roster, people, speed, layout, mode, equip, bracelets, rooms, roomId }); }

  /* ---------- rooms: which room is this workout in ---------- */
  ui.roomName = () => (mode === 'live' ? roomName() : '');
  function renderRoomChip() {
    const chip = $('#roomChip');
    chip.dataset.empty = roomName() ? '' : '1';
    $('#roomChipText').textContent = roomName() || 'בחירת חדר';
    chip.querySelector('small').hidden = !roomName();
  }
  function pickRoom(id) {
    roomId = id;
    if (sessionKey) unsaved = true;                    // the saved copy gets the new room too
    persist(); renderRoomChip();
    $('#rooms').close('ok');
  }
  function openRooms() {
    if (mode !== 'live') return;
    const box = $('#rmList');
    box.innerHTML = '';
    for (const r of rooms) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'rm-btn'; b.textContent = r.name;
      b.setAttribute('aria-pressed', String(r.id === roomId));
      b.addEventListener('click', () => pickRoom(r.id));
      box.appendChild(b);
    }
    if (!$('#rooms').open) $('#rooms').showModal();
  }
  $('#roomChip').addEventListener('click', openRooms);
  $('#rooms').addEventListener('click', e => { if (e.target === $('#rooms')) $('#rooms').close(); });

  function fillRooms() {
    const box = $('#roomsEditor');
    box.innerHTML = '';
    for (const r of rooms) {
      const row = document.createElement('div');
      row.className = 'rm-edit'; row.dataset.id = r.id;
      row.innerHTML = '<input type="text" maxlength="24" dir="auto" autocomplete="off" aria-label="שם החדר"><button type="button" class="mini-btn danger" aria-label="הסרת החדר" title="הסרת החדר">✕</button>';
      row.querySelector('input').value = r.name;
      row.querySelector('button').addEventListener('click', () => {
        captureRooms();
        if (rooms.length <= 1) { flash('חייב להישאר לפחות חדר אחד', 'error', 4000); return; }
        rooms = rooms.filter(x => x.id !== r.id);
        if (roomId === r.id) roomId = null;
        persist(); fillRooms(); renderRoomChip();
      });
      box.appendChild(row);
    }
  }
  /** Take the names as typed in the settings table. */
  function captureRooms() {
    rooms = rooms.map(r => {
      const inp = document.querySelector('#roomsEditor .rm-edit[data-id="' + r.id + '"] input');
      return { id: r.id, name: (inp && inp.value.trim()) || r.name };
    });
    persist(); renderRoomChip();
  }
  $('#roomsEditor').addEventListener('input', captureRooms);   // names are kept as they are typed
  $('#btnAddRoom').addEventListener('click', () => {
    captureRooms();
    rooms.push({ id: 'r' + Date.now().toString(36), name: 'חדר חדש' });
    persist(); fillRooms();
    const inputs = document.querySelectorAll('#roomsEditor input');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });
  function applyLayout() { document.body.dataset.layout = layout; }

  /* ---------- studio bracelets: a fixed number for each device ---------- */
  const studio = () => equip === 'studio';
  const braceletOf = id => bracelets.find(b => b.id === id) || null;
  const labelOf = id => (braceletOf(id) || {}).label || '';
  function ensureBracelet(id, deviceName) {
    let b = braceletOf(id);
    if (!b) {
      const top = bracelets.reduce((m, x) => Math.max(m, parseInt((String(x.label).match(/(\d+)\s*$/) || [])[1], 10) || 0), 0);
      b = { id, label: 'צמיד ' + (top + 1), deviceName };
      bracelets.push(b);
    } else b.deviceName = deviceName;
    persist();
    return b;
  }
  // On a tile: the bracelet number (studio) or the name of the watch (personal), to tell watches apart.
  ui.tagOf = userId => { const w = mode === 'live' ? watchOf(userId) : null; return w ? (studio() ? labelOf(w.id) : w.name) : ''; };

  function applyEquip() {
    document.body.dataset.equip = equip;
    $('#equipIn').value = equip;
    $('#equipHint').textContent = studio()
      ? 'הצמידים שייכים לסטודיו ומקבלים מספר קבוע. בתחילת כל אימון בוחרים מי עונד איזה צמיד, וההיסטוריה נשמרת למתאמן ולא לצמיד.'
      : 'כל מתאמן מחובר לשעון שלו. שעון שחובר פעם אחת משויך שוב לאותו מתאמן בחיבור הבא.';
    $('#thWatch').textContent = studio() ? 'צמיד' : 'שעון';
    $('#emptyStep3').textContent = studio() ? 'בוחרים מי עונד את הצמיד' : 'משייכים את השעון למתאמן';
    restChip();
  }

  /* ---------- status chip ---------- */
  const chip = $('#watchChip'), chipText = $('#chipText'), chipAct = $('#chipAct');
  let chipTimer = null, chipRun = null;
  function restChip() {
    const n = watches.size;
    chip.hidden = mode !== 'live' || n === 0;
    chip.dataset.state = '';
    const unit = studio() ? ['צמיד אחד מחובר', ' צמידים מחוברים'] : ['שעון אחד מחובר', ' שעונים מחוברים'];
    chipText.textContent = n === 1 ? unit[0] : n + unit[1];
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
    return results.length ? { id: sessionKey, startedAt: sessionStart, durationS: Math.round(session.elapsed), room: roomName(), results } : null;
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
  function startLive(keepWearers) {
    demo.stop();
    clearInterval(liveTimer);
    saveSession();                                     // keep the workout that is about to be replaced
    sessionKey = null; unsaved = false;
    // Studio bracelets stay connected but belong to nobody: who wears which one is chosen again.
    if (studio() && !keepWearers) for (const w of watches.values()) w.userId = null;
    session.setUsers(people.filter(p => watchOf(p.id)));   // the board shows whoever is connected now
    liveRunning = false;
    ui.build();
    ui.showLive();
    liveTimer = setInterval(() => {
      if (liveRunning && !session.ended) session.elapsed += 1;
      ui.update();
    }, 1000);
    if (studio() && !keepWearers && watches.size) openBracelets();
  }

  /** Throw the running workout away and start from zero: same trainees, same watches, nothing saved.
      A copy that was already saved along the way is removed from the server too. */
  async function resetSession() {
    const warn = mode === 'live' && sessionKey
      ? 'לאפס את האימון? הנתונים של האימון הנוכחי יימחקו ולא יישמרו ביומן.'
      : 'לאפס את האימון ולהתחיל מאפס?';
    if (!confirm(warn)) return;
    if (mode === 'demo') { startDemo(); return; }
    const key = sessionKey;
    sessionKey = null; unsaved = false;                // nothing is left to save
    await saveChain;                                   // a save already on its way finishes first
    if (key) {
      try { await HR.Api.removeSession(key); }
      catch (e) { flash('האימון אופס, אבל העותק שנשמר בשרת לא נמחק', 'error', 10000); }
    }
    setSaveNote('');
    startLive(true);
    flash('האימון אופס', '', 4000);
  }
  $('#btnReset').addEventListener('click', resetSession);

  /** A clean start: the workout so far is kept in the logbook, every watch is disconnected and the
      board is empty until watches are connected again. The trainee list itself stays. */
  async function newWorkout(ask) {
    if (mode === 'demo') { fillSettings(); $('#settings').showModal(); return; }
    if (ask && !session.ended && sessionKey && !confirm('להתחיל אימון חדש? האימון הנוכחי יישמר ביומן והשעונים ינותקו.')) return;
    const saved = await saveSession();                 // keep the workout that is about to be replaced
    if (saved === 'failed' && !confirm('האימון הנוכחי לא נשמר בשרת. להמשיך בכל זאת? הנתונים שלו יאבדו.')) return;
    for (const id of [...watches.keys()]) dropWatch(id);
    setSaveNote('');
    startLive();
    refillPeople(); restChip();
    flash('אימון חדש. מחברים שעונים כדי להתחיל', '', 5000);
    openRooms();                                       // the room is chosen before every workout
  }
  $('#btnNewLive').addEventListener('click', () => newWorkout(true));

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
    if (!w.userId) return;                              // a studio bracelet nobody wears yet
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
  function askAssign(deviceName, suggestedId, before) {
    return new Promise(resolve => {
      const dlg = $('#assign'), who = $('#asWho');
      const free = people.filter(p => !watchOf(p.id) || p.id === suggestedId);
      // before = the question comes first ("who is this for?"), then the browser's list of watches opens.
      $('#asTitleA').hidden = !!before; $('#asTitleB').hidden = !before;
      $('#asHint').hidden = !before;
      $('#asOk').textContent = before ? 'המשך לבחירת השעון' : 'שמירה';
      $('#asName').textContent = deviceName || '';
      who.innerHTML = '';
      for (const p of free) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; who.appendChild(o); }
      const o = document.createElement('option'); o.value = '__new'; o.textContent = 'מתאמן חדש (רושמים שם)'; who.appendChild(o);
      // The trainee who wore this watch last time is offered first, but the name can always be changed.
      who.value = free.some(p => p.id === suggestedId) ? suggestedId : '__new';
      $('#asWhoWrap').hidden = free.length === 0;
      $('#asPName').value = '';
      $('#asPName').placeholder = 'מתאמן ' + (people.length + 1);
      const showNew = () => {
        $('#asNew').hidden = who.value !== '__new';
        if (!before) return;
        const p = people.find(x => x.id === who.value);
        $('#asHint').textContent = (p ? 'מחברים שעון של ' + p.name + '.' : 'מחברים שעון למתאמן חדש.') +
          (p && p.deviceName ? ' בפעם הקודמת הוא היה מחובר לשעון "' + p.deviceName + '".' : '') +
          ' בחלון הבא של הדפדפן בוחרים את השעון שלו מהרשימה.';
      };
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

  /** Attach a connected source (Bluetooth watch or the local bridge). Resolves to false when the
      connection was cancelled. A studio bracelet may stay unassigned until "who wears what" is answered. */
  async function attach(devId, src, name, forId) {
    const old = watches.get(devId);
    let person = forId ? people.find(p => p.id === forId) : null;
    // Every time a watch is connected the name is asked again. Only a watch chosen for a named
    // trainee from the settings table skips the question.
    if (!person && !studio()) {
      const last = old ? people.find(p => p.id === old.userId) : people.find(p => p.deviceId === devId);
      person = await askAssign(name, last && last.id);
      if (!person) return false;
    }
    if (!person && studio() && old) person = people.find(p => p.id === old.userId) || null;

    const tag = studio() ? ensureBracelet(devId, name).label : '';
    if (person) {
      const prev = watchOf(person.id);
      if (prev && prev.id !== devId) dropWatch(prev.id);    // one watch per person
      if (!studio()) { person.deviceId = devId; person.deviceName = name; }   // personal watches are remembered
    }
    watches.set(devId, { id: devId, src, userId: person ? person.id : null, name, state: 'on' });
    persist();
    if (person && !session.byId(person.id)) session.addUser(person);
    ui.build(); ui.update();
    refillPeople();
    if (studio() && !forId) { flash(tag + ' מחובר. בוחרים מי עונד אותו או רושמים שם', '', 8000); openBracelets(); }
    else if (person) flash((tag || name) + ' מחובר, משויך אל ' + person.name);
    return true;
  }

  /** Connect a watch. In personal mode the trainee is chosen first and shown on the board with a
      "choosing a watch" mark, so it is clear whose watch is being picked from the browser's list. */
  async function connectWatch(opt = {}) {
    if (mode !== 'live') return;
    if (!opt.forId && !studio()) {
      const free = people.filter(p => !watchOf(p.id));
      const p = await askAssign('', free[0] && free[0].id, true);
      if (!p) return;
      opt = { ...opt, forId: p.id };
    }
    ui.pendingId = opt.forId || null;
    if (opt.forId) {
      const p = people.find(x => x.id === opt.forId);
      if (p && !session.byId(p.id) && !session.ended) { session.addUser(p); ui.build(); }
      ui.update();
    }
    try { await connectWatchInner(opt); }
    finally { ui.pendingId = null; syncLive(); ui.update(); }
  }

  async function connectWatchInner(opt) {
    if (isLocal && !watches.has('bridge') && await bridgeAlive()) return connectBridge(opt.forId);
    if (!HR.BleSource.supported) { showHelp(); return; }

    let devId = null;
    const src = new HR.BleSource(
      (bpm, dt) => { if (devId) onBpm(devId, bpm, dt); },
      (state, info) => {
        if (state === 'choosing') {
          const p = people.find(x => x.id === opt.forId);
          flash(p ? 'בוחרים את השעון של ' + p.name + ' מהרשימה של הדפדפן' : 'בוחרים את השעון מהרשימה של הדפדפן', 'wait', 0);
        }
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
    const ok = await attach(id, src, name, opt.forId);
    if (!ok) { devId = null; if (!old) src.disconnect(); else watches.delete(id); restChip(); flash('החיבור בוטל', '', 4000); }
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
    const ok = await attach('bridge', src, name, forId);
    if (!ok) { flash('החיבור בוטל', '', 4000); return; }
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
  function refillPeople() {
    ui.fillPeople(people, id => {
      const w = watchOf(id);
      return w && { name: studio() ? labelOf(w.id) + ' · ' + w.name : w.name, state: w.state };
    }, studio());
  }

  /* ---------- studio bracelets: who wears which one ---------- */
  const brDraft = new Map();      // what was typed in the dialog, kept while it is redrawn
  const brNum = b => parseInt((String(b.label).match(/(\d+)\s*$/) || [])[1], 10) || 1e9;

  function captureBracelets() {
    for (const r of document.querySelectorAll('#brList .br-row')) {
      brDraft.set(r.dataset.id, {
        label: r.querySelector('.br-label').value, who: r.querySelector('.br-who').value,
        nName: r.querySelector('.br-nname').value, nAge: r.querySelector('.br-nage').value,
        nWeight: r.querySelector('.br-nweight').value, nSex: r.querySelector('.br-nsex').value
      });
    }
  }

  function renderBracelets() {
    const list = $('#brList');
    list.innerHTML = '';
    const live = [...watches.values()].sort((a, b) => brNum(braceletOf(a.id) || {}) - brNum(braceletOf(b.id) || {}));
    $('#brEmpty').hidden = live.length > 0;
    $('#brOk').hidden = live.length === 0;
    const away = bracelets.filter(b => !watches.has(b.id));
    $('#brAway').hidden = away.length === 0;
    $('#brAway').textContent = away.length ? 'רשומים ולא מחוברים כרגע: ' + away.map(b => b.label).join(', ') : '';

    for (const w of live) {
      const b = braceletOf(w.id) || { label: w.name };
      const d = brDraft.get(w.id) || {};
      const row = document.createElement('div');
      row.className = 'br-row';
      row.dataset.id = w.id;
      row.dataset.state = w.state;
      row.innerHTML = `
        <div class="br-id">
          <input type="text" class="br-label" maxlength="16" aria-label="שם הצמיד" autocomplete="off">
          <small class="br-dev"></small>
        </div>
        <select class="br-who" aria-label="מי עונד את הצמיד"></select>
        <div class="br-new" hidden>
          <input type="text" class="br-nname" maxlength="24" dir="auto" autocomplete="off" aria-label="שם המתאמן החדש" placeholder="שם המתאמן">
          <input type="number" class="br-nage" min="10" max="95" inputmode="numeric" aria-label="גיל" value="30">
          <input type="number" class="br-nweight" min="30" max="200" inputmode="numeric" aria-label="משקל" value="70">
          <select class="br-nsex" aria-label="מין"><option value="f">נקבה</option><option value="m">זכר</option></select>
        </div>`;
      row.querySelector('.br-label').value = d.label != null ? d.label : b.label;
      const short = HR.BleSource.shortId(w.id);
      row.querySelector('.br-dev').textContent = w.id === 'bridge' || w.name.includes(short) ? w.name : w.name + ' · ' + short;
      row.querySelector('.br-dev').title = 'מזהה Bluetooth של הצמיד: ' + w.id;

      const who = row.querySelector('.br-who');
      const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; who.appendChild(o); };
      add('', 'בוחרים מתאמן…');
      for (const p of people) add(p.id, p.name);
      add('__new', '＋ מתאמן חדש');
      who.value = d.who != null ? d.who : (w.userId || '');
      if (who.value !== (d.who != null ? d.who : (w.userId || ''))) who.value = '';
      const nw = row.querySelector('.br-new');
      const sync = () => { nw.hidden = who.value !== '__new'; row.dataset.set = who.value ? '1' : ''; };
      who.addEventListener('change', () => { sync(); if (!nw.hidden) row.querySelector('.br-nname').focus(); });
      row.querySelector('.br-nname').value = d.nName || '';
      if (d.nAge) row.querySelector('.br-nage').value = d.nAge;
      if (d.nWeight) row.querySelector('.br-nweight').value = d.nWeight;
      if (d.nSex) row.querySelector('.br-nsex').value = d.nSex;
      sync();
      list.appendChild(row);
    }
  }

  function openBracelets() {
    if (mode !== 'live') return;
    const dlg = $('#bracelets');
    if (dlg.open) captureBracelets(); else brDraft.clear();
    renderBracelets();
    $('#brErr').hidden = true;
    if (!dlg.open) dlg.showModal();
  }

  /** Returns an error text, or '' once everything was applied. */
  function applyBracelets() {
    const rows = [...document.querySelectorAll('#brList .br-row')];
    const num = (el, lo, hi, d) => { const v = parseInt(el.value, 10); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
    const used = new Set();
    for (const r of rows) {
      const v = r.querySelector('.br-who').value;
      if (!v || v === '__new') continue;
      if (used.has(v)) return 'מתאמן אחד לא יכול לעבוד עם שני צמידים. בוחרים מתאמן אחר באחד מהם.';
      used.add(v);
    }
    for (const r of rows) {
      const id = r.dataset.id, w = watches.get(id);
      if (!w) continue;
      const b = braceletOf(id);
      const label = r.querySelector('.br-label').value.trim();
      if (b && label) b.label = label;
      const v = r.querySelector('.br-who').value;
      let person = null;
      if (v === '__new') {
        person = newPerson({
          name: r.querySelector('.br-nname').value.trim() || ('מתאמן ' + (people.length + 1)),
          age: num(r.querySelector('.br-nage'), 10, 95, 30), weight: num(r.querySelector('.br-nweight'), 30, 200, 70),
          sex: r.querySelector('.br-nsex').value === 'm' ? 'm' : 'f'
        });
        people.push(person);
      } else if (v) person = people.find(p => p.id === v) || null;
      w.userId = person ? person.id : null;
    }
    persist();
    syncLive();
    refillPeople();
    restChip();
    return '';
  }

  $('#brOk').addEventListener('click', () => {
    const err = applyBracelets();
    const e = $('#brErr');
    e.textContent = err; e.hidden = !err;
    if (!err) { $('#bracelets').close('ok'); flash('השיוך נשמר', '', 4000); }
  });
  $('#brConnect').addEventListener('click', () => { captureBracelets(); connectWatch(); });
  $('#btnBracelets').addEventListener('click', openBracelets);
  $('#bracelets').addEventListener('click', e => { if (e.target === $('#bracelets')) $('#bracelets').close(); });
  $('#equipIn').addEventListener('change', e => {
    if (settings.open) applyPeopleEdits();
    equip = e.target.value === 'studio' ? 'studio' : 'personal';
    persist(); applyEquip(); refillPeople(); syncLive(); ui.update();
  });
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
  function fillSettings() { ui.fillRoster(roster); refillPeople(); fillRooms(); }
  $('#btnSettings').addEventListener('click', fillSettings);
  settings.addEventListener('close', () => {
    const rv = settings.returnValue;
    settings.returnValue = '';
    if (rv !== 'start' && rv !== 'save') return;
    if (mode === 'demo') { roster = ui.readRoster(roster); persist(); startWorkout(); }
    else { applyPeopleEdits(); captureRooms(); }
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 's' || e.key === 'S' || e.key === 'ד') && !e.target.closest('input,select')) fillSettings();
  });

  $('#btnEnd').addEventListener('click', () => {
    if (confirm('לסיים את האימון ולהציג סיכום?')) endWorkout();
  });
  $('#btnBack').addEventListener('click', () => { session.ended = false; setSaveNote(''); ui.showLive(); if (mode === 'demo') demo.start(); });
  $('#btnNew').addEventListener('click', () => newWorkout(false));   // the workout was ended and saved already

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
  applyEquip();
  fillSettings();
  renderRoomChip();
  setMode(mode);
  if (mode === 'live' && !roomName()) openRooms();    // first run: ask which room before anything starts

  if (params.get('summary') === '1') endWorkout();   // handy for design checks
})(window.HR);
