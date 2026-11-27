/* Server storage and the trainee logbook.
   HR.Api talks to server/server.js. HR.History is the dialog that lays one trainee's workouts side by side. */
(function (HR) {
  const $ = s => document.querySelector(s);

  /* ---------- api ---------- */
  const token = () => { try { return localStorage.getItem('hr.token') || ''; } catch (e) { return ''; } };

  async function call(method, url, body) {
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (token()) headers.Authorization = 'Bearer ' + token();
    const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }

  HR.Api = {
    saveSession: payload => call('POST', '/api/sessions', payload),
    removeSession: id => call('DELETE', '/api/sessions/' + encodeURIComponent(id)),
    athletes: () => call('GET', '/api/athletes'),
    history: id => call('GET', '/api/athletes/' + encodeURIComponent(id) + '/history'),
    removeAthlete: id => call('DELETE', '/api/athletes/' + encodeURIComponent(id))
  };

  /* ---------- logbook ---------- */
  const fmtTime = s => { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const fmtDate = ms => new Date(ms).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });
  const fmtClock = ms => new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const hardSecs = s => s.zoneSecs[3] + s.zoneSecs[4] + s.zoneSecs[5];

  const METRICS = {
    points: { label: 'נקודות מאמץ', get: s => Math.floor(s.points), fmt: v => String(Math.round(v)) },
    avgHr:  { label: 'דופק ממוצע', get: s => s.avgHr, fmt: v => String(Math.round(v)) },
    kcal:   { label: 'קלוריות', get: s => Math.round(s.kcal), fmt: v => String(Math.round(v)) },
    hard:   { label: 'הזמן באזורים 3–5', get: hardSecs, fmt: fmtTime }
  };

  let current = null;   // { athlete, sessions } newest first
  let metric = 'points';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function setMsg(text) {
    const m = $('#hiMsg');
    m.textContent = text || '';
    m.hidden = !text;
  }

  async function open(athleteId) {
    const dlg = $('#history');
    setMsg('טוען…');
    $('#hiBody').hidden = true;
    if (!dlg.open) dlg.showModal();
    let list;
    try {
      list = await HR.Api.athletes();
    } catch (e) {
      setMsg(e.status === 401 ? 'השרת דורש מפתח גישה, והוא לא הוגדר בדפדפן הזה.' : 'אין חיבור לשרת, ולכן אי אפשר להציג את היומן. מפעילים את השרת עם start_server.bat.');
      return;
    }
    const known = list.filter(a => a.sessions > 0);
    const sel = $('#hiWho');
    sel.innerHTML = '';
    for (const a of known) { const o = el('option', '', a.name); o.value = a.id; sel.appendChild(o); }
    if (!known.length) { setMsg('עדיין לא נשמר אף אימון. האימון הראשון נשמר מעצמו, בזמן האימון ובסיומו.'); return; }
    const want = athleteId && known.some(a => a.id === athleteId) ? athleteId : known[0].id;
    sel.value = want;
    setMsg(athleteId && want !== athleteId ? 'למתאמן הזה אין עדיין אימונים שמורים.' : '');
    await show(want);
  }

  async function show(id) {
    try { current = await HR.Api.history(id); }
    catch (e) { setMsg('לא הצלחתי לטעון את היומן.'); return; }
    $('#hiBody').hidden = false;
    render();
  }

  /** One plain sentence instead of a wall of numbers. */
  function leadText(m, vals) {
    const n = vals.length;
    if (n === 1) return 'אימון אחד שמור. בפעם הבאה אפשר יהיה להשוות אליו.';
    const last = vals[n - 1], prev = vals[n - 2];
    const avg = vals.reduce((a, b) => a + b, 0) / n;
    let change;
    if (prev === 0 || m.fmt(last) === m.fmt(prev)) change = m.fmt(last) === m.fmt(prev) ? 'בדיוק כמו באימון שלפניו' : 'באימון שלפניו לא נמדד כלום';
    else {
      const pc = Math.round(Math.abs(last - prev) / prev * 100);
      change = pc === 0 ? 'כמעט בדיוק כמו באימון שלפניו' : (last > prev ? pc + '% יותר' : pc + '% פחות') + ' מהאימון שלפניו';
    }
    return `${m.label} באימון האחרון: ${m.fmt(last)}, ${change}. ממוצע ב-${n} אימונים: ${m.fmt(avg)}. הכי גבוה עד היום: ${m.fmt(Math.max(...vals))}.`;
  }

  function render() {
    const { athlete, sessions } = current;
    if (!athlete || !sessions.length) { $('#hiBody').hidden = true; return; }
    const m = METRICS[metric];
    const chrono = [...sessions].reverse();            // oldest first
    const vals = chrono.map(m.get);

    $('#hiSub').textContent = `גיל ${athlete.age}, ${sessions.length === 1 ? 'אימון אחד' : sessions.length + ' אימונים'}`;
    $('#hiLead').textContent = leadText(m, vals);
    for (const b of document.querySelectorAll('#hiTabs button')) b.setAttribute('aria-pressed', String(b.dataset.m === metric));
    drawTrend(chrono, vals, m);

    const tbody = $('#hiTable tbody');
    tbody.innerHTML = '';
    sessions.forEach((s, i) => {
      const older = sessions[i + 1];
      const tr = el('tr');
      const date = el('td'); date.append(el('span', 'num', fmtDate(s.startedAt)), el('span', 'hi-clock num', fmtClock(s.startedAt)));

      const zones = el('td'); zones.append(zoneBar(s));

      const vs = el('td', 'num');
      const a = Math.floor(s.points), b = older ? Math.floor(older.points) : 0;
      if (older && b > 0) {
        const pc = Math.round((a - b) / b * 100);
        vs.textContent = pc === 0 ? '=' : (pc > 0 ? '+' : '−') + Math.abs(pc) + '%';
      } else vs.textContent = '·';

      tr.append(date,
        el('td', 'num', fmtTime(s.durationS)),
        el('td', 'num hi-key', String(a)),
        el('td', 'num', String(s.avgHr)),
        el('td', 'num', String(s.peakHr)),
        el('td', 'num', String(Math.round(s.kcal))),
        zones, vs);
      tbody.appendChild(tr);
    });
  }

  /** Time in each zone, as the width of one thin bar. */
  function zoneBar(s) {
    const total = s.zoneSecs.slice(1).reduce((a, b) => a + b, 0);
    const bar = el('span', 'hi-zones');
    bar.title = HR.ZONES.slice(1).map(z => `${z.tag} ${fmtTime(s.zoneSecs[z.id])}`).join('  ·  ');
    if (total <= 0) return bar;
    for (const z of HR.ZONES.slice(1)) {
      if (s.zoneSecs[z.id] <= 0) continue;
      const seg = el('i');
      seg.style.flexGrow = s.zoneSecs[z.id];
      seg.style.background = z.color;
      bar.appendChild(seg);
    }
    return bar;
  }

  /** One metric across workouts: a bare line with the values written next to the points.
      Time runs right to left, like the live chart. */
  function drawTrend(chrono, vals, m) {
    const W = 680, H = 190, left = 76, right = 76, top = 26, bottom = 28;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const flat = hi === lo;
    const n = vals.length;
    const x = i => (n === 1 ? W / 2 : W - right - (i / (n - 1)) * (W - left - right));
    const y = v => (flat ? (top + H - bottom) / 2 : H - bottom - ((v - lo) / (hi - lo)) * (H - top - bottom));
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', m.label + ' לאורך האימונים');
    const add = (tag, attrs, text) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (text != null) e.textContent = text;
      svg.appendChild(e); return e;
    };
    // two ruled lines: the lowest and the highest value
    const rules = flat ? [lo] : [lo, hi];
    for (const v of rules) {
      add('line', { x1: left - 14, x2: W - right + 14, y1: y(v), y2: y(v), stroke: 'rgb(150 160 230 / .2)', 'stroke-dasharray': '2 5' });
      add('text', { x: left - 24, y: y(v) + 4, 'text-anchor': 'end', fill: 'var(--ink-dim)', 'font-size': 13 }, m.fmt(v));
    }
    if (n > 1) add('polyline', { points: vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' '), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linejoin': 'round' });
    vals.forEach((v, i) => {
      const latest = i === n - 1;
      add('circle', { cx: x(i), cy: y(v), r: latest ? 5.5 : 3.5, fill: latest ? 'var(--ink)' : 'var(--panel)', stroke: 'var(--ink)', 'stroke-width': 2 });
      if (n <= 8 || latest) add('text', { x: x(i), y: y(v) - 12, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': latest ? 16 : 13, 'font-weight': latest ? 800 : 600 }, m.fmt(v));
    });
    add('text', { x: x(0), y: H - 6, 'text-anchor': 'middle', fill: 'var(--ink-dim)', 'font-size': 12 }, fmtDate(chrono[0].startedAt));
    if (n > 1) add('text', { x: x(n - 1), y: H - 6, 'text-anchor': 'middle', fill: 'var(--ink-dim)', 'font-size': 12 }, fmtDate(chrono[n - 1].startedAt));
    const host = $('#hiChart');
    host.innerHTML = '';
    host.appendChild(svg);
  }

  /* ---------- wiring ---------- */
  $('#hiWho').addEventListener('change', e => show(e.target.value));
  $('#hiTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    metric = b.dataset.m;
    if (current) render();
  });
  $('#hiDelete').addEventListener('click', async () => {
    if (!current || !current.athlete) return;
    const a = current.athlete;
    if (!confirm('למחוק את כל ההיסטוריה של ' + a.name + '? אי אפשר לשחזר.')) return;
    try { await HR.Api.removeAthlete(a.id); } catch (e) { setMsg('המחיקה נכשלה.'); return; }
    open();
  });
  const dlg = $('#history');
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  $('#btnHistory').addEventListener('click', () => open());

  HR.History = { open };
})(window.HR);
