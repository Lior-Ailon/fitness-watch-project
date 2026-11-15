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

  window.addEventListener('resize', () => ui.update());
  applyLayout();
  ui.fillRoster(roster);
  startWorkout();

  if (params.get('summary') === '1') endWorkout();   // handy for design checks
})(window.HR);
