(function (HR) {
  const params = new URLSearchParams(location.search);
  const STORE = 'hr.board.v1';

  const store = {
    load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } },
    save(obj) { try { localStorage.setItem(STORE, JSON.stringify(obj)); } catch (e) { /* storage unavailable */ } }
  };

  const saved = store.load();
  // Merge saved profile edits (name / age / weight / present) onto the default roster.
  let roster = HR.ROSTER.map(p => ({ ...p, ...((saved.roster || []).find(s => s.id === p.id) || {}) }));
  const nParam = parseInt(params.get('n'), 10);
  if (nParam) roster.forEach((p, i) => { p.present = i < nParam; });

  let speed = parseInt(params.get('speed'), 10) || saved.speed || 1;
  let layout = saved.layout || 'ref';

  const session = new HR.Session();
  const ui = new HR.UI(session);
  const demo = new HR.DemoSource(session, () => ui.update());
  demo.speed = speed;

  const $ = s => document.querySelector(s);

  function applyLayout() { document.body.dataset.layout = layout; }

  /** Begin a workout: ages are read now, and max HR / zones are fixed from them. */
  function startWorkout() {
    demo.stop();
    const present = roster.filter(p => p.present);
    session.setUsers(present.length >= 1 ? present : roster.slice(0, 1));
    if (typeof ble !== 'undefined' && ble.connected && watchUser) {   // keep the real watch on the same person
      watchUser = session.byId(watchUser.id) || session.users[0];
      demo.skip.clear(); demo.skip.add(watchUser.id);
    }
    demo.init();
    demo.prime(1500);         // open mid-class so the screen is alive immediately
    ui.build();
    ui.showLive();
    demo.start();
  }

  function endWorkout() {
    demo.stop();
    session.ended = true;
    ui.showSummary();
  }

  function persist() { store.save({ roster, speed, layout }); }

  // ----- controls -----
  $('#speedIn').value = String(speed);
  $('#layoutIn').value = layout;
  $('#speedIn').addEventListener('change', e => { speed = parseInt(e.target.value, 10); demo.setSpeed(speed); persist(); });
  $('#layoutIn').addEventListener('change', e => { layout = e.target.value; applyLayout(); persist(); setTimeout(() => ui.update(), 0); });

  const settings = $('#settings');
  $('#btnSettings').addEventListener('click', () => ui.fillRoster(roster));
  settings.addEventListener('close', () => {
    if (settings.returnValue === 'start') {
      roster = ui.readRoster(roster);
      persist();
      startWorkout();
    }
    settings.returnValue = '';
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 's' || e.key === 'S' || e.key === 'ד') && !e.target.closest('input,select')) ui.fillRoster(roster);
  });

  $('#btnEnd').addEventListener('click', () => {
    if (confirm('לסיים את האימון ולהציג סיכום?')) endWorkout();
  });
  $('#btnBack').addEventListener('click', () => { ui.showLive(); if (!session.ended) demo.start(); });
  $('#btnNew').addEventListener('click', () => { ui.fillRoster(roster); settings.showModal(); });

  // ----- real watch over Bluetooth (standard Heart Rate service) -----
  const chip = $('#watchChip');
  let watchUser = null, watchName = '', watchBpm = 0;
  function setChip(text, state) { chip.hidden = !text; chip.textContent = text || ''; chip.dataset.state = state || ''; }
  const ble = new HR.BleSource(
    (bpm, dt) => {
      if (!watchUser) return;
      watchBpm = bpm;
      session.push(watchUser.id, bpm, dt);
      setChip('⌚ ' + watchName + ' → ' + watchUser.name + ' · ' + bpm + ' ♥');
      ui.update();
    },
    (state, info) => {
      if (state === 'choosing') setChip('בחר/י את השעון מהרשימה…', 'wait');
      else if (state === 'connecting') setChip('מתחבר ל-' + info.name + '…', 'wait');
      else if (state === 'connected') { watchName = info.name; setChip('⌚ ' + watchName + ' מחובר, ממתין לדופק…', 'wait'); }
      else if (state === 'disconnected') { demo.skip.clear(); watchUser = null; setChip('השעון התנתק', 'error'); $('#btnWatch').textContent = '⌚ חיבור שעון'; }
    }
  );
  $('#btnWatch').addEventListener('click', async () => {
    if (ble.connected) { ble.disconnect(); return; }
    if (!HR.BleSource.supported) { setChip('Bluetooth זמין רק ב-Chrome או Edge, בכתובת localhost או https', 'error'); return; }
    watchUser = session.users[0];                 // the first participant wears the watch
    demo.skip.clear(); demo.skip.add(watchUser.id);
    try {
      await ble.connect();
      $('#btnWatch').textContent = '⌚ ניתוק שעון';
    } catch (e) {
      demo.skip.clear(); watchUser = null;
      if (e && e.name === 'NotFoundError') setChip('לא נבחר שעון', 'error');
      else if (e && e.message === 'no-hr-service') setChip((e.deviceName || 'המכשיר') + ' לא משדר דופק. הפעל/י בשעון "שידור דופק"', 'error');
      else setChip('החיבור נכשל: ' + (e && e.message ? e.message : e), 'error');
    }
  });

  window.addEventListener('resize', () => ui.update());
  applyLayout();
  ui.fillRoster(roster);
  startWorkout();

  if (params.get('summary') === '1') endWorkout();   // handy for design checks
})(window.HR);
