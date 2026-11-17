/* Core model: heart-rate zones and a session that holds every participant.
   Any data source (demo simulator now, Bluetooth / ANT+ later) only needs to
   call session.push(userId, bpm, dtSeconds). */
window.HR = window.HR || {};

(function (HR) {
  // Zones by % of the participant's max heart rate (fixed from her age at the
  // start of the workout, so everyone is measured fairly).
  // `rate` = effort points earned per minute in the zone.
  HR.ZONES = [
    { id: 0, tag: '',   name: 'מנוחה',     min: 0,  label: 'עד 49%', color: '#6a7597', rate: 0 },
    { id: 1, tag: 'Z1', name: 'קל מאוד',   min: 50, label: '50–59%', color: '#3d7bff', rate: 1 },
    { id: 2, tag: 'Z2', name: 'קל',        min: 60, label: '60–69%', color: '#22c7f0', rate: 2 },
    { id: 3, tag: 'Z3', name: 'בינוני',    min: 70, label: '70–79%', color: '#27d680', rate: 3 },
    { id: 4, tag: 'Z4', name: 'קשה',       min: 80, label: '80–89%', color: '#ffc21f', rate: 4 },
    { id: 5, tag: 'Z5', name: 'מקסימום',   min: 90, label: '90%+',   color: '#ff3d5a', rate: 5 }
  ];

  HR.zoneOf = function (pct) {
    for (let i = HR.ZONES.length - 1; i >= 0; i--) {
      if (pct >= HR.ZONES[i].min) return HR.ZONES[i];
    }
    return HR.ZONES[0];
  };

  /** Max heart rate from age at the start of the workout (classic 220 - age). */
  HR.maxHrForAge = age => 220 - age;

  /** Calories per minute from heart rate (Keytel et al. 2005). An estimate. */
  HR.kcalPerMin = function (u, hr) {
    const w = u.weight || 65, a = u.age;
    const kj = u.sex === 'm'
      ? -55.0969 + 0.6309 * hr + 0.1988 * w + 0.2017 * a
      : -20.4022 + 0.4472 * hr - 0.1263 * w + 0.074 * a;
    return Math.max(0, kj / 4.184);
  };

  HR.Session = class Session {
    constructor() {
      this.users = [];
      this.elapsed = 0;          // seconds of workout time
      this.maxHistory = 3600;    // keep up to an hour of 1 Hz samples
      this.ended = false;
    }

    /** Start a workout: max HR is computed once, from age at this moment. */
    setUsers(list) {
      this.elapsed = 0;
      this.ended = false;
      this.users = list.map(u => this._fresh(u));
    }

    _fresh(u) {
      return {
        sex: 'f', weight: 65,
        ...u,
        ageAtStart: u.age,
        maxHr: HR.maxHrForAge(u.age),
        hr: 0, pct: 0, zone: HR.ZONES[0],
        history: [], points: 0, kcal: 0,
        zoneSecs: [0, 0, 0, 0, 0, 0],
        peak: 0, sum: 0, n: 0,
        lastSeen: 0, live: false
      };
    }

    /** Someone joins mid-workout (a watch was just connected): the others keep their numbers. */
    addUser(u) { if (!this.byId(u.id)) this.users.push(this._fresh(u)); }

    removeUser(id) { this.users = this.users.filter(u => u.id !== id); }

    /** Profile edit during a workout: the name changes at once, and max HR follows the new age. */
    updateProfile(id, p) {
      const u = this.byId(id);
      if (!u) return;
      u.name = p.name; u.age = p.age; u.weight = p.weight; u.sex = p.sex;
      u.ageAtStart = p.age;
      u.maxHr = HR.maxHrForAge(p.age);
    }

    byId(id) { return this.users.find(u => u.id === id); }

    push(id, bpm, dt = 1) {
      const u = this.byId(id);
      if (!u || !(bpm > 0)) return;
      u.hr = Math.round(bpm);
      u.pct = (u.hr / u.maxHr) * 100;
      u.zone = HR.zoneOf(Math.round(u.pct));   // same rounded number the screen shows
      u.history.push(u.hr);
      if (u.history.length > this.maxHistory) u.history.shift();
      u.zoneSecs[u.zone.id] += dt;
      u.points += (u.zone.rate * dt) / 60;
      u.kcal += (HR.kcalPerMin(u, u.hr) * dt) / 60;
      u.peak = Math.max(u.peak, u.hr);
      u.sum += u.hr * dt;
      u.n += dt;
      u.lastSeen = performance.now();
      u.live = true;
    }

    get ranking() {
      return [...this.users].sort((a, b) => b.points - a.points);
    }

    get totalKcal() { return this.users.reduce((s, u) => s + u.kcal, 0); }

    avgOf(u) { return u.n ? Math.round(u.sum / u.n) : 0; }
  };
})(window.HR);
