/* Demo data source: simulates an aerobics class for up to 20 people. */
(function (HR) {
  HR.ROSTER = [
    ['דניאלה לוי', 31, 62], ['מיכל כהן', 27, 58], ['ענבר ביטון', 34, 66], ['רוני פרץ', 25, 60],
    ['יעל מזרחי', 41, 70], ['שיר אברהם', 29, 57], ['נועה דהן', 38, 64], ['לירון פרידמן', 33, 61],
    ['מאי שפירא', 24, 55], ['טל גולן', 36, 68], ['הדס אזולאי', 44, 72], ['עדי חדד', 30, 59],
    ['ספיר כץ', 52, 75], ['גל אביב', 28, 56], ['אורית רוזן', 47, 78], ['אלה שטרן', 23, 54],
    ['נטע בר', 35, 63], ['תמר ישראלי', 40, 67], ['רותם קורן', 26, 60], ['ליאת מלכה', 45, 73]
  ].map(([name, age, weight], i) => ({ id: 'u' + (i + 1), name, age, weight, sex: 'f', present: true }));

  // Zohar Barda leads the roster. Age and weight are placeholders until she enters hers in Settings.
  HR.ROSTER.unshift({ id: 'u21', name: 'זוהר ברדה', age: 35, weight: 62, sex: 'f', present: true });

  // Class intensity over a 16-minute loop, as % of max heart rate.
  const CURVE = [
    [0, 50], [120, 62], [240, 72], [420, 76], [450, 88], [540, 89],
    [570, 62], [600, 62], [630, 90], [720, 92], [750, 70], [960, 52]
  ];
  const LOOP = 960;

  function intensityAt(t) {
    t = ((t % LOOP) + LOOP) % LOOP;
    for (let i = 1; i < CURVE.length; i++) {
      if (t <= CURVE[i][0]) {
        const [t0, v0] = CURVE[i - 1], [t1, v1] = CURVE[i];
        return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      }
    }
    return CURVE[CURVE.length - 1][1];
  }

  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.6;

  HR.DemoSource = class DemoSource {
    constructor(session, onTick) {
      this.session = session;
      this.onTick = onTick;
      this.t = 0;
      this.speed = 1;
      this.timer = null;
      this.sim = new Map();
    }

    init() {
      this.t = 0;
      this.sim.clear();
      for (const u of this.session.users) {
        this.sim.set(u.id, {
          fit: 0.92 + Math.random() * 0.17,       // personal effort factor
          lag: -15 + Math.random() * 30,          // seconds off the class beat
          hr: 66 + Math.random() * 16
        });
      }
    }

    step() {
      this.t += 1;
      for (const u of this.session.users) {
        const s = this.sim.get(u.id);
        const target = (intensityAt(this.t + s.lag) / 100) * s.fit * u.maxHr;
        s.hr += (target - s.hr) * 0.08 + gauss();
        s.hr = Math.max(58, Math.min(u.maxHr * 1.02, s.hr));
        this.session.push(u.id, s.hr, 1);
      }
      this.session.elapsed = this.t;
    }

    /** Run `seconds` of class instantly so the screen opens mid-workout. */
    prime(seconds) { for (let i = 0; i < seconds; i++) this.step(); }

    start() {
      this.stop();
      this.timer = setInterval(() => { this.step(); this.onTick && this.onTick(); }, 1000 / this.speed);
    }

    stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

    setSpeed(x) { this.speed = x; if (this.timer) this.start(); }
  };
})(window.HR);
