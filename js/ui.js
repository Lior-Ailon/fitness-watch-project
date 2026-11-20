/* Rendering: live tiles, leaderboard, header numbers, summary screen, dialogs. */
(function (HR) {
  const $ = s => document.querySelector(s);
  const STALE_MS = 6000;
  const BOARD_ROWS = 10;
  const RING_LEN = 2 * Math.PI * 42;
  const MEDAL = ['#ffc21f', '#cfd6ea', '#e0894a'];

  const crown = c => `<svg class="crown" viewBox="0 0 32 24" aria-hidden="true"><path d="M3 21 1 6l8 6 7-10 7 10 8-6-2 15z" fill="${c}"/></svg>`;
  const FLAME = '<svg class="flame" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4c1 8 10 12 10 24a10 10 0 0 1-20 0c0-5 3-8 5-11 1 4 3 5 4 5 1-6-1-11 1-18z" fill="currentColor"/></svg>';

  const pad = n => String(n).padStart(2, '0');
  const fmtTime = s => { s = Math.floor(s); return pad(Math.floor(s / 60)) + ':' + pad(s % 60); };
  const fmtInt = n => Math.round(n).toLocaleString('en-US');
  const initials = name => name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('');

  /** Pick columns x rows so tiles come out close to a 1.3:1 landscape card. */
  function gridShape(n, areaAspect) {
    let best = null;
    for (let cols = n < 3 ? 1 : 2; cols <= 7; cols++) {
      const rows = Math.ceil(n / cols);
      if (rows * cols < n) continue;
      const tileAspect = areaAspect * rows / cols;
      const portrait = tileAspect < 1.05 ? 0.6 : 0;   // tall, narrow tiles squeeze the text
      const score = Math.abs(Math.log(tileAspect / 1.3)) + portrait + (cols * rows - n) * 0.12;
      if (!best || score < best.score) best = { cols, rows, score };
    }
    return best;
  }

  HR.UI = class UI {
    constructor(session) {
      this.session = session;
      this.tiles = new Map();
      this.rows = new Map();
      this.openId = null;
      this.buildLegend();
      this.bindDialogs();
      this.tickClock();
      setInterval(() => this.tickClock(), 1000);
    }

    tickClock() {
      const d = new Date();
      $('#nowClock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    /* ---------- build ---------- */
    buildLegend() {
      const ul = $('#legend');
      ul.innerHTML = '';
      this.legendCounts = HR.ZONES.filter(z => z.id > 0).map(z => {
        const li = document.createElement('li');
        li.style.setProperty('--zc', z.color);
        li.innerHTML = `<i></i><b>${z.tag}</b><span class="lg-name">${z.name}</span><span class="lg-range num">${z.label}</span><em class="lg-count num">0</em>`;
        ul.appendChild(li);
        return li.querySelector('.lg-count');
      });
    }

    build() {
      const users = this.session.users;
      const grid = $('#grid');
      grid.innerHTML = '';
      this.tiles.clear();
      // Nobody yet (real board before the first watch): show the invitation instead of an empty grid.
      const none = users.length === 0;
      $('#stage').classList.toggle('is-empty', none);
      $('#empty').hidden = !none;
      $('#boardEmpty').hidden = !none;
      const box = grid.getBoundingClientRect();
      const { cols, rows } = gridShape(Math.max(1, users.length), box.width && box.height ? box.width / box.height : 1.65);
      grid.style.setProperty('--cols', cols);
      grid.style.setProperty('--rows', rows);

      for (const u of users) {
        const el = document.createElement('article');
        el.className = 'tile';
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.innerHTML = `
          <div class="content">
            <div class="t-name"><span class="name"></span><span class="crown-slot"></span><i class="w-dot" aria-hidden="true"></i></div>
            <div class="t-body">
              <div class="t-data">
                <div class="bpm num"><b>--</b><small>BPM</small></div>
                <div class="cal num">${FLAME}<b>0</b><small>cal</small></div>
              </div>
              <div class="t-ring">
                <div class="ring-box">
                  <svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
                    <circle class="track" cx="50" cy="50" r="42"/>
                    <circle class="prog" cx="50" cy="50" r="42" stroke-dasharray="${RING_LEN.toFixed(1)}" stroke-dashoffset="${RING_LEN.toFixed(1)}"/>
                  </svg>
                  <div class="ring-c num"><b>0%</b><small>HRmax</small></div>
                </div>
                <span class="badge">Z0</span>
              </div>
            </div>
          </div>`;
        el.querySelector('.name').textContent = u.name;
        el.addEventListener('click', () => this.openDetail(u.id));
        el.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openDetail(u.id); }
        });
        grid.appendChild(el);
        this.tiles.set(u.id, {
          el,
          crown: el.querySelector('.crown-slot'),
          bpm: el.querySelector('.bpm b'),
          cal: el.querySelector('.cal b'),
          pct: el.querySelector('.ring-c b'),
          prog: el.querySelector('.prog'),
          badge: el.querySelector('.badge')
        });
      }

      const board = $('#board');
      board.innerHTML = '';
      this.rows.clear();
      board.style.setProperty('--n', Math.min(BOARD_ROWS, users.length));
      for (const u of users) {
        const li = document.createElement('li');
        li.className = 'row';
        li.innerHTML = `
          <span class="r-rank num"></span>
          <span class="r-crown"></span>
          <span class="r-name"></span>
          <span class="r-pts num"></span>`;
        li.querySelector('.r-name').textContent = u.name;
        board.appendChild(li);
        this.rows.set(u.id, {
          el: li,
          rank: li.querySelector('.r-rank'),
          crown: li.querySelector('.r-crown'),
          pts: li.querySelector('.r-pts')
        });
      }
    }

    /* ---------- per-second update ---------- */
    update() {
      const s = this.session;
      const now = performance.now();
      $('#elapsed').textContent = fmtTime(s.elapsed);
      $('#kcalTotal').textContent = fmtInt(s.totalKcal);

      const ranking = s.ranking;
      const counts = new Array(HR.ZONES.length).fill(0);
      let hrSum = 0, hrN = 0;

      ranking.forEach((u, i) => {
        const stale = !u.live || now - u.lastSeen > STALE_MS;
        const z = u.zone;
        if (!stale) { counts[z.id]++; hrSum += u.hr; hrN++; }

        const t = this.tiles.get(u.id);
        // 'demo' (simulated), 'on' (watch connected), 'lost' (reconnecting), 'none' (no watch yet)
        const ws = this.watchState ? this.watchState(u.id) : 'demo';
        const quiet = ws === 'none' ? 'אין שעון' : ws === 'lost' ? 'מתחבר מחדש' : 'אין אות';
        t.el.style.setProperty('--zc', z.color);
        t.el.classList.toggle('off', stale);
        t.el.dataset.watch = ws;
        t.el.title = stale ? quiet : z.name;
        t.bpm.textContent = stale ? '--' : u.hr;
        t.cal.textContent = fmtInt(u.kcal);
        t.pct.textContent = stale ? '--' : Math.round(u.pct) + '%';
        const frac = stale ? 0 : Math.max(0, Math.min(1, u.pct / 100));
        t.el.style.setProperty('--lvl', (frac * 100).toFixed(1));
        t.prog.style.strokeDashoffset = (RING_LEN * (1 - frac)).toFixed(1);
        t.badge.textContent = stale ? quiet : (z.tag || 'מנוחה');
        t.crown.innerHTML = i < 3 ? crown(MEDAL[i]) : '';

        const r = this.rows.get(u.id);
        const visible = i < BOARD_ROWS;
        r.el.hidden = !visible;
        r.el.style.setProperty('--i', i);
        r.el.style.setProperty('--zc', z.color);
        r.el.dataset.rank = i + 1;
        r.rank.textContent = (i + 1) + '.';
        r.crown.innerHTML = i < 3 ? crown(MEDAL[i]) : '';
        r.pts.textContent = Math.floor(u.points);
      });

      $('#avgHr').textContent = hrN ? Math.round(hrSum / hrN) : '--';
      this.legendCounts.forEach((el, i) => { el.textContent = counts[i + 1]; });
      if (this.openId) this.renderDetail();
    }

    /* ---------- detail dialog ---------- */
    openDetail(id) {
      this.openId = id;
      $('#detail').showModal();
      this.renderDetail();
    }

    renderDetail() {
      const u = this.session.byId(this.openId);
      if (!u) return;
      $('#dName').textContent = u.name;
      $('#dSub').textContent = `גיל ${u.ageAtStart} בתחילת האימון, דופק מקסימלי ${u.maxHr}`;
      const ws = this.watchState ? this.watchState(u.id) : 'demo';
      $('#dWatch').textContent = ws === 'none' ? 'חיבור שעון' : 'ניתוק השעון';
      $('#dWatch').dataset.act = ws === 'none' ? 'connect' : 'disconnect';
      const stats = [
        ['דופק עכשיו', u.hr || '--', u.zone.color],
        ['אחוז מהמקסימום', Math.round(u.pct) + '%', u.zone.color],
        ['אזור', u.zone.tag || 'מנוחה', u.zone.color],
        ['דופק ממוצע', this.session.avgOf(u), null],
        ['קלוריות', fmtInt(u.kcal), null],
        ['נקודות מאמץ', Math.floor(u.points), null]
      ];
      $('#dStats').innerHTML = stats.map(([k, v, c]) =>
        `<div class="stat"><span class="stat-v num" ${c ? `style="color:${c}"` : ''}>${v}</span><span class="stat-k">${k}</span></div>`
      ).join('');

      HR.drawSeries($('#dChart'), u.history, { window: 600, maxHr: u.maxHr, lineWidth: 2.4, bands: true, dot: true });

      const total = Math.max(1, u.zoneSecs.reduce((a, b) => a + b, 0));
      $('#dZones').innerHTML = HR.ZONES.map(z => {
        const secs = u.zoneSecs[z.id];
        return `<div class="dz" style="--zc:${z.color}">
          <span class="dz-name">${z.tag ? z.tag + ' ' : ''}${z.name}</span>
          <span class="dz-track"><span class="dz-bar" style="width:${(secs / total * 100).toFixed(1)}%"></span></span>
          <span class="dz-time num">${fmtTime(secs)}</span>
        </div>`;
      }).join('');
    }

    /* ---------- summary screen ---------- */
    showSummary() {
      const s = this.session;
      const ranking = s.ranking;
      document.body.dataset.view = 'summary';
      $('#live').hidden = true;
      $('#summary').hidden = false;

      $('#sumMeta').innerHTML =
        `<span>משך האימון <b class="num">${fmtTime(s.elapsed)}</b></span>` +
        `<span><b class="num">${ranking.length}</b> מתאמנים</span>` +
        `<span><b class="num">${fmtInt(s.totalKcal)}</b> קלוריות</span>`;

      // Podium: 2nd, 1st, 3rd (as in the design)
      const order = [1, 0, 2].filter(i => ranking[i]);
      $('#podium').innerHTML = order.map(i => {
        const u = ranking[i];
        return `<div class="pod p${i + 1}" style="--c:${MEDAL[i]}">
          <div class="avatar"><span>${initials(u.name)}</span><i class="medal num">${i + 1}</i></div>
          <div class="pod-card"><b>${u.name}</b><span><span class="num">${Math.floor(u.points)}</span> נקודות</span></div>
        </div>`;
      }).join('');

      const tbody = $('#sumTable tbody');
      $('#sumTable').style.setProperty('--rows', ranking.length);
      tbody.innerHTML = ranking.map((u, i) => `
        <tr>
          <td class="c-rank num">${i + 1}</td>
          <td class="c-name"><bdi>${u.name}</bdi></td>
          <td class="z5 num">${fmtTime(u.zoneSecs[5])}</td>
          <td class="z4 num">${fmtTime(u.zoneSecs[4])}</td>
          <td class="z3 num">${fmtTime(u.zoneSecs[3])}</td>
          <td class="z2 num">${fmtTime(u.zoneSecs[2])}</td>
          <td class="z1 num">${fmtTime(u.zoneSecs[1])}</td>
          <td class="num">${s.avgOf(u)}</td>
          <td class="num">${fmtInt(u.kcal)}</td>
        </tr>`).join('');
    }

    showLive() {
      document.body.dataset.view = 'live';
      $('#summary').hidden = true;
      $('#live').hidden = false;
      this.update();
    }

    /* ---------- roster (settings dialog) ---------- */
    fillRoster(roster) {
      const tbody = $('#rosterTable tbody');
      tbody.innerHTML = '';
      for (const p of roster) {
        const tr = document.createElement('tr');
        tr.dataset.id = p.id;
        tr.innerHTML = `
          <td><input type="checkbox" class="r-present" aria-label="משתתפת" ${p.present ? 'checked' : ''}></td>
          <td><input type="text" class="r-name-in" dir="auto" maxlength="24"></td>
          <td><input type="number" class="r-age" min="14" max="90" inputmode="numeric"></td>
          <td><input type="number" class="r-weight" min="35" max="160" inputmode="numeric"></td>
          <td class="r-max num"></td>`;
        tr.querySelector('.r-name-in').value = p.name;
        tr.querySelector('.r-age').value = p.age;
        tr.querySelector('.r-weight').value = p.weight;
        const upd = () => {
          const age = parseInt(tr.querySelector('.r-age').value, 10);
          tr.querySelector('.r-max').textContent = age > 0 ? HR.maxHrForAge(age) : '--';
        };
        tr.querySelector('.r-age').addEventListener('input', upd);
        upd();
        tbody.appendChild(tr);
      }
    }

    readRoster(base) {
      const clamp = (v, lo, hi, d) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
      return [...document.querySelectorAll('#rosterTable tbody tr')].map(tr => {
        const p = base.find(x => x.id === tr.dataset.id) || {};
        return {
          ...p,
          id: tr.dataset.id,
          present: tr.querySelector('.r-present').checked,
          name: tr.querySelector('.r-name-in').value.trim() || p.name,
          age: clamp(tr.querySelector('.r-age').value, 14, 90, p.age || 30),
          weight: clamp(tr.querySelector('.r-weight').value, 35, 160, p.weight || 65)
        };
      });
    }

    /* ---------- people & watches (settings dialog, real board) ---------- */
    /** @param {Array} people  @param {(id:string)=>{name:string,state:string}|null} watchOf */
    fillPeople(people, watchOf) {
      const tbody = $('#peopleTable tbody');
      tbody.innerHTML = '';
      $('#peopleEmpty').hidden = people.length > 0;
      for (const p of people) {
        const w = watchOf(p.id);
        const tr = document.createElement('tr');
        tr.dataset.id = p.id;
        tr.innerHTML = `
          <td><input type="text" class="r-name-in" dir="auto" maxlength="24" aria-label="שם"></td>
          <td><input type="number" class="r-age" min="10" max="95" inputmode="numeric" aria-label="גיל"></td>
          <td><input type="number" class="r-weight" min="30" max="200" inputmode="numeric" aria-label="משקל"></td>
          <td><select class="r-sex" aria-label="מין"><option value="f">נקבה</option><option value="m">זכר</option></select></td>
          <td class="r-max num"></td>
          <td class="r-watch"><span class="w-state"></span><button type="button" class="mini-btn w-btn"></button></td>
          <td><button type="button" class="mini-btn danger w-del" aria-label="הסרת המתאמן" title="הסרת המתאמן">✕</button></td>`;
        tr.querySelector('.r-name-in').value = p.name;
        tr.querySelector('.r-age').value = p.age;
        tr.querySelector('.r-weight').value = p.weight;
        tr.querySelector('.r-sex').value = p.sex === 'm' ? 'm' : 'f';
        const st = tr.querySelector('.w-state'), btn = tr.querySelector('.w-btn');
        st.textContent = w ? (w.state === 'lost' ? w.name + ' · מתחבר מחדש' : w.name) : (p.deviceName ? p.deviceName + ' · לא מחובר' : 'אין שעון');
        st.dataset.state = w ? w.state : 'none';
        btn.textContent = w ? 'ניתוק' : 'חיבור';
        btn.addEventListener('click', () => this.onPeople && this.onPeople(w ? 'unwatch' : 'watch', p.id));
        tr.querySelector('.w-del').addEventListener('click', () => this.onPeople && this.onPeople('remove', p.id));
        const upd = () => {
          const age = parseInt(tr.querySelector('.r-age').value, 10);
          tr.querySelector('.r-max').textContent = age > 0 ? HR.maxHrForAge(age) : '--';
        };
        tr.querySelector('.r-age').addEventListener('input', upd);
        upd();
        tbody.appendChild(tr);
      }
    }

    readPeople(base) {
      const clamp = (v, lo, hi, d) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
      return [...document.querySelectorAll('#peopleTable tbody tr')].map(tr => {
        const p = base.find(x => x.id === tr.dataset.id) || {};
        return {
          ...p,
          id: tr.dataset.id,
          name: tr.querySelector('.r-name-in').value.trim() || p.name || 'מתאמן',
          age: clamp(tr.querySelector('.r-age').value, 10, 95, p.age || 30),
          weight: clamp(tr.querySelector('.r-weight').value, 30, 200, p.weight || 70),
          sex: tr.querySelector('.r-sex').value === 'm' ? 'm' : 'f'
        };
      });
    }

    /* ---------- dialogs & controls ---------- */
    bindDialogs() {
      const detail = $('#detail');
      detail.addEventListener('close', () => { this.openId = null; });
      detail.addEventListener('click', e => { if (e.target === detail) detail.close(); });
      $('#dWatch').addEventListener('click', e => {
        const id = this.openId, act = e.currentTarget.dataset.act;
        detail.close();
        if (this.onPeople && id) this.onPeople(act === 'connect' ? 'watch' : 'unwatch', id);
      });
      $('#dHistory').addEventListener('click', () => {
        const id = this.openId;
        detail.close();
        if (HR.History && id) HR.History.open(id);
      });
      const help = $('#help');
      help.addEventListener('click', e => { if (e.target === help) help.close(); });

      const settings = $('#settings');
      settings.addEventListener('click', e => { if (e.target === settings) settings.close(); });
      $('#btnSettings').addEventListener('click', () => settings.showModal());
      $('#btnFull').addEventListener('click', toggleFull);

      document.addEventListener('keydown', e => {
        if (e.target.closest && e.target.closest('input,select,textarea')) return;
        if (e.key === 'f' || e.key === 'F' || e.key === 'כ') toggleFull();
        if (e.key === 's' || e.key === 'S' || e.key === 'ד') {
          settings.open ? settings.close() : settings.showModal();
        }
      });

      let idle;
      const wake = () => {
        document.body.classList.remove('idle');
        clearTimeout(idle);
        idle = setTimeout(() => document.body.classList.add('idle'), 4000);
      };
      ['mousemove', 'keydown', 'pointerdown'].forEach(ev => document.addEventListener(ev, wake));
      wake();
    }
  };

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  }
})(window.HR);
