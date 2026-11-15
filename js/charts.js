/* Canvas charts. Time flows right-to-left (RTL): oldest sample on the right,
   newest toward the left, so it reads naturally for Hebrew viewers. */
(function (HR) {
  const LO = 0.40, HI = 1.05;   // visible range as a fraction of max HR

  function prep(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h, dpr };
  }

  /**
   * data: array of bpm. opts: { window, maxHr, lineWidth, bands, dot }
   */
  HR.drawSeries = function (canvas, data, opts) {
    const { ctx, w, h, dpr } = prep(canvas);
    const N = opts.window;
    const yOf = v => {
      const f = (v / opts.maxHr - LO) / (HI - LO);
      return h - Math.max(0, Math.min(1, f)) * h;
    };

    if (opts.bands) {
      for (let z = 1; z < HR.ZONES.length; z++) {
        const next = HR.ZONES[z + 1] ? HR.ZONES[z + 1].min : 105;
        const y1 = yOf((next / 100) * opts.maxHr);
        const y0 = yOf((HR.ZONES[z].min / 100) * opts.maxHr);
        ctx.fillStyle = HR.ZONES[z].color + '1f';
        ctx.fillRect(0, y1, w, y0 - y1);
      }
    }

    const d = data.slice(-N);
    if (d.length < 2) return;
    const step = w / (N - 1);
    ctx.lineWidth = (opts.lineWidth || 2) * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let j = 1; j < d.length; j++) {
      const x0 = w - (j - 1) * step, x1 = w - j * step;
      const zone = HR.zoneOf((d[j] / opts.maxHr) * 100);
      ctx.strokeStyle = zone.color;
      ctx.beginPath();
      ctx.moveTo(x0, yOf(d[j - 1]));
      ctx.lineTo(x1, yOf(d[j]));
      ctx.stroke();
    }

    if (opts.dot) {
      const j = d.length - 1;
      const x = w - j * step, y = yOf(d[j]);
      const zone = HR.zoneOf((d[j] / opts.maxHr) * 100);
      ctx.fillStyle = zone.color;
      ctx.beginPath();
      ctx.arc(Math.max(x, 4 * dpr), y, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  };
})(window.HR);
