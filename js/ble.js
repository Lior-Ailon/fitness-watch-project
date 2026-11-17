/* Bluetooth heart-rate source (Web Bluetooth, standard GATT "Heart Rate" service 0x180D).
   Works with any watch / strap that broadcasts heart rate (Polar, Garmin "broadcast HR",
   Amazfit/Xiaomi "HR sharing", most chest straps...).
   Needs Chrome or Edge, and a secure origin (https or http://localhost).
   One BleSource per watch: the board holds several at once, one for each participant. */
(function (HR) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  HR.BleSource = class BleSource {
    /** @param {(bpm:number, dt:number)=>void} onBpm  @param {(state:string, info?:any)=>void} onState */
    constructor(onBpm, onState) {
      this.onBpm = onBpm;
      this.onState = onState || (() => {});
      this.device = null;
      this.char = null;
      this.last = 0;
      this.manual = false;       // true once we asked for the disconnect ourselves
      this._handler = e => this._onValue(e);
      this._gone = () => { if (!this.manual) this._lost(); };
    }

    static get supported() { return !!(navigator.bluetooth && window.isSecureContext); }

    get connected() { return !!(this.device && this.device.gatt && this.device.gatt.connected); }
    get id() { return this.device ? this.device.id : null; }
    get name() { return (this.device && this.device.name) || 'שעון'; }

    /** @param {{all?:boolean}} opt  all=true lists every nearby Bluetooth device, for watches
     *  that broadcast heart rate without advertising the service. */
    async connect(opt = {}) {
      if (!BleSource.supported) throw new Error('unsupported');
      this.onState('choosing');
      const optionalServices = ['heart_rate', 'battery_service', 'device_information'];
      const device = await navigator.bluetooth.requestDevice(
        opt.all ? { acceptAllDevices: true, optionalServices }
                : { filters: [{ services: ['heart_rate'] }], optionalServices }
      );
      this.device = device;
      this.manual = false;
      device.addEventListener('gattserverdisconnected', this._gone);
      this.onState('connecting', { name: this.name });
      try {
        await this._open();
      } catch (e) {
        this.manual = true;
        try { device.gatt.disconnect(); } catch (x) { /* never connected */ }
        const name = device.name;
        this._cleanup();
        if (e && e.message === 'no-hr-service') e.deviceName = name;
        throw e;
      }
      this.onState('connected', { name: this.name });
    }

    async _open() {
      const server = await this.device.gatt.connect();
      let service;
      try { service = await server.getPrimaryService('heart_rate'); }
      catch (e) { throw new Error('no-hr-service'); }
      if (this.char) { try { this.char.removeEventListener('characteristicvaluechanged', this._handler); } catch (e) { /* stale */ } }
      this.char = await service.getCharacteristic('heart_rate_measurement');
      this.char.addEventListener('characteristicvaluechanged', this._handler);
      await this.char.startNotifications();
      this.last = performance.now();
    }

    /** The link dropped by itself (out of range, watch asleep): try to get it back quietly. */
    async _lost() {
      if (this._retrying) return;
      this._retrying = true;
      this.onState('reconnecting', { name: this.name });
      for (let i = 0; i < 8; i++) {
        await sleep(1500 + i * 1500);
        if (this.manual || !this.device) { this._retrying = false; return; }
        try {
          await this._open();
          this._retrying = false;
          this.onState('connected', { name: this.name, again: true });
          return;
        } catch (e) { /* still away, try again */ }
      }
      this._retrying = false;
      const name = this.name;
      this._cleanup();
      this.onState('disconnected', { name });
    }

    disconnect() {
      this.manual = true;
      const name = this.name;
      try { if (this.device && this.device.gatt.connected) this.device.gatt.disconnect(); } catch (e) { /* already gone */ }
      this._cleanup();
      this.onState('disconnected', { name, manual: true });
    }

    _cleanup() {
      if (this.char) { try { this.char.removeEventListener('characteristicvaluechanged', this._handler); } catch (e) { /* ignore */ } }
      if (this.device) this.device.removeEventListener('gattserverdisconnected', this._gone);
      this.char = null; this.device = null;
    }

    /** Heart Rate Measurement: flags byte, then 8-bit or 16-bit bpm (flag bit 0). */
    _onValue(e) {
      const dv = e.target.value;
      const flags = dv.getUint8(0);
      const bpm = (flags & 1) ? dv.getUint16(1, true) : dv.getUint8(1);
      const now = performance.now();
      const dt = Math.min(2, Math.max(0.2, (now - this.last) / 1000));
      this.last = now;
      if (bpm > 0) this.onBpm(bpm, dt);
    }
  };
})(window.HR);
