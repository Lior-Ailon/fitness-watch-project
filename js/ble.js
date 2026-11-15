/* Bluetooth heart-rate source (Web Bluetooth, standard GATT "Heart Rate" service 0x180D).
   Works with any watch / strap that broadcasts heart rate (Polar, Garmin "broadcast HR",
   Amazfit/Xiaomi "HR sharing", most chest straps...).
   Needs Chrome or Edge, and a secure origin (https or http://localhost). */
(function (HR) {
  HR.BleSource = class BleSource {
    /** @param {(bpm:number, dt:number)=>void} onBpm  @param {(state:string, info?:any)=>void} onState */
    constructor(onBpm, onState) {
      this.onBpm = onBpm;
      this.onState = onState || (() => {});
      this.device = null;
      this.char = null;
      this.last = 0;
      this._handler = e => this._onValue(e);
      this._gone = () => { this._cleanup(); this.onState('disconnected'); };
    }

    static get supported() { return !!(navigator.bluetooth && window.isSecureContext); }

    get connected() { return !!(this.device && this.device.gatt && this.device.gatt.connected); }

    async connect() {
      if (!BleSource.supported) throw new Error('unsupported');
      this.onState('choosing');
      // Show every nearby Bluetooth device, so a watch that does not advertise the HR
      // service in its ads (many don't) can still be picked from the list.
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['heart_rate', 'battery_service', 'device_information']
      });
      this.device = device;
      device.addEventListener('gattserverdisconnected', this._gone);
      this.onState('connecting', { name: device.name || 'device' });
      const server = await device.gatt.connect();
      let service;
      try {
        service = await server.getPrimaryService('heart_rate');
      } catch (e) {
        device.gatt.disconnect();
        const err = new Error('no-hr-service');
        err.deviceName = device.name;
        throw err;
      }
      this.char = await service.getCharacteristic('heart_rate_measurement');
      this.char.addEventListener('characteristicvaluechanged', this._handler);
      await this.char.startNotifications();
      this.last = performance.now();
      this.onState('connected', { name: device.name || 'device' });
    }

    disconnect() {
      try { if (this.device && this.device.gatt.connected) this.device.gatt.disconnect(); } catch (e) { /* already gone */ }
      this._cleanup();
      this.onState('disconnected');
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
