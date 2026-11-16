/* Tes Node untuk UX highlight scan + model dinamis (plan UX §3-4).
   Menguji KODE ASLI js/scanner.js, js/dashboard.js, js/kiosk.js lewat
   vm dengan stub DOM/Utils/Storage — tanpa browser dan tanpa kamera.
   Model scan DINAMIS berbasis jam (17 Nov 2026): jam yang menentukan
   arti scan, bukan hitungan scan ke berapa (alur 1-2-3-4 dihapus).
   Semua overlay auto-hilang 1 detik; scan baru langsung menggantikan
   (tanpa antrean). Kupon makan otomatis terbit + ditebus satu scan.
   Kamera persegi 1:1 (aspect-ratio + video 100% + ResizeObserver);
   baris "Terakhir" di panel kanan hero; kunci data demo v2.
   Tombol nyala/mati kamera (#btnToggleCamera, manual-off dihormati
   auto-start dan kiosk; label mengikuti status via hook).
   Yang TIDAK diuji di sini (butuh browser + kamera asli): alur scan
   end-to-end lewat kamera sungguhan.
   Jalankan: node tests/scan-highlight.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed += 1; console.log('  ok  ' + name); })
    .catch((err) => {
      failed += 1;
      failures.push(name + ': ' + (err && err.message));
      console.log('  FAIL ' + name + ' — ' + (err && err.message));
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert gagal');
}
function assertHas(hay, needle, msg) {
  assert(typeof hay === 'string' && hay.includes(needle),
    (msg || 'harusnya mengandung') + ' "' + needle + '" — dapat: ' + JSON.stringify(hay));
}

/* ---------- Stub DOM minimal ---------- */
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(c) { this.set.add(c); this.el._syncClass(); }
  remove(c) { this.set.delete(c); this.el._syncClass(); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    this.el._syncClass();
    return on;
  }
  contains(c) { return this.set.has(c); }
}

class El {
  constructor(id) {
    this.id = id || '';
    this._innerHTML = '';
    this._className = '';
    this.classList = new ClassList(this);
    this.textContent = '';
    this.hidden = false;
    this.style = {};
    this.offsetParent = {}; // dianggap terlihat (untuk scannerVisible)
    this._listeners = {};
    this._badge = null;
    this._row = null;
  }
  _syncClass() { this._className = [...this.classList.set].join(' '); }
  get className() { return this._className; }
  set className(v) {
    this._className = String(v || '');
    this.classList.set = new Set(this._className.split(/\s+/).filter(Boolean));
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = String(v || '');
    this._badge = null;
    this._row = null;
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  querySelector(sel) {
    if (sel === 'video') {
      if (!this._video) this._video = new El('video');
      return this._video;
    }
    if (sel === '.scan-overlay-waiting') {
      if (!this._innerHTML.includes('scan-overlay-waiting')) return null;
      if (!this._badge) this._badge = { hidden: true, textContent: '' };
      return this._badge;
    }
    if (sel === 'tr') {
      if (!this._innerHTML.includes('<tr')) return null;
      if (!this._row) {
        const rowEl = new El('');
        this._row = rowEl;
      }
      return this._row;
    }
    return null;
  }
  querySelectorAll() { return []; }
  setAttribute() {}
  getAttribute() { return null; }
}

function makeDocument() {
  const els = {};
  const get = (id) => {
    if (!els[id]) els[id] = new El(id);
    return els[id];
  };
  const body = new El('body');
  const doc = {
    _els: els,
    body,
    documentElement: { requestFullscreenCalls: 0 },
    fullscreenElement: null,
    exitFullscreenCalls: 0,
    _listeners: {},
    getElementById: (id) => get(id),
    querySelectorAll: () => [],
    addEventListener: (type, fn) => {
      (doc._listeners[type] = doc._listeners[type] || []).push(fn);
    },
    removeEventListener: (type, fn) => {
      doc._listeners[type] = (doc._listeners[type] || []).filter((f) => f !== fn);
    },
    // Picu event untuk tes (mis. fullscreenchange).
    _fire: (type) => { (doc._listeners[type] || []).forEach((fn) => fn()); },
  };
  // Closure di atas objek doc (bukan `document` global Node).
  doc.documentElement.requestFullscreen = () => {
    doc.documentElement.requestFullscreenCalls += 1;
    doc.fullscreenElement = doc.documentElement;
    doc._fire('fullscreenchange');
    return Promise.resolve();
  };
  doc.exitFullscreen = () => {
    doc.exitFullscreenCalls += 1;
    doc.fullscreenElement = null;
    doc._fire('fullscreenchange');
    return Promise.resolve();
  };
  return doc;
}

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _map: m,
  };
}

/* ---------- Konteks scanner ---------- */
function freshScannerCtx(opts) {
  const o = opts || {};
  const state = {
    now: new Date(2026, 10, 16, 8, 5, 0), // default 08:05
    kodeSeq: 0,
    karyawan: o.karyawan || [],
    riwayat: [],
    archive: [],
    presensi: [],
    dashboardRender: 0,
    karyawanRender: 0,
    timers: [],
    audioOsc: [],
  };
  const todayStr = () => {
    const d = state.now;
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  const fmtTime = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };

  const document = makeDocument();
  const localStorage = makeLocalStorage();

  const sandbox = {
    console,
    localStorage,
    document,
    setTimeout: (fn, ms) => {
      const id = state.timers.length + 1;
      state.timers.push({ id, fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      state.timers = state.timers.filter((t) => t.id !== id);
    },
    AudioContext: class {
      constructor() {
        this.currentTime = 0;
        this.state = 'running';
        this.destination = {};
      }
      resume() { return Promise.resolve(); }
      createOscillator() {
        const osc = {
          type: '',
          frequency: { value: 0 },
          connect() {}, start() {}, stop() {},
        };
        state.audioOsc.push(osc);
        return osc;
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
        };
      }
    },
    ResizeObserver: class {
      constructor(cb) {
        this.cb = cb;
        this.observed = null;
        this.disconnected = false;
        sandbox.__roInstances.push(this);
      }
      observe(el) { this.observed = el; }
      disconnect() { this.disconnected = true; }
    },
    Html5Qrcode: class {
      constructor() {}
      start(_opts, _cfg, onDecode) {
        sandbox.__decode = onDecode;
        state.qrStartCalls = (state.qrStartCalls || 0) + 1;
        // Simulasi library: bekukan lebar inline <video> dari ukuran
        // #reader saat start (tanpa ResizeObserver).
        const video = document.getElementById('reader').querySelector('video');
        if (video) { video.style.width = '250px'; video.style.height = '250px'; }
        return Promise.resolve();
      }
      stop() { return Promise.resolve(); }
      clear() {}
    },
    Utils: {
      WORK: {
        MASUK: '08:00', TOLERANSI_TERLAMBAT_MENIT: 15,
        MAKAN_MULAI: '12:00', MAKAN_AKHIR: '13:00',
        PULANG: '16:00', LEMBUR_SETELAH_MENIT: 120,
      },
      escapeHtml: (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'),
      now: () => new Date(state.now),
      nowIso: () => todayStr() + 'T' + fmtTime(state.now),
      todayLocalISO: () => todayStr(),
      toLocalISODate: (v) => (v ? String(v).slice(0, 10) : ''),
      isToday: (v) => !!v && String(v).slice(0, 10) === todayStr(),
      menitHariIni: () => state.now.getHours() * 60 + state.now.getMinutes(),
      formatDurasi: (menit) => {
        if (menit < 60) return menit + ' menit';
        const j = Math.floor(menit / 60);
        const s = menit % 60;
        return s === 0 ? j + ' jam' : j + ' jam ' + s + ' menit';
      },
      isSudahJamPulang: () => state.now.getHours() * 60 + state.now.getMinutes() >= 16 * 60,
      isLembur: () => state.now.getHours() * 60 + state.now.getMinutes() > 16 * 60,
      formatJamPulang: () => '16:00',
      nextKodeTransaksi: () => 'TR-2611-' + String(++state.kodeSeq).padStart(3, '0'),
      isSimulated: () => false,
      isKaryawanNonAktif: (k) => String(k.status || '').toLowerCase() === 'non-aktif',
    },
    Storage: {
      getKaryawan: () => state.karyawan,
      getReservasiManual: () => [],
      getReservasiArchive: () => state.archive,
      getPresensi: () => state.presensi,
      getRiwayat: () => state.riwayat,
      todayLocalISO: () => todayStr(),
      archiveStaleMeal: () => false,
      archiveKupon: (k, ket) => {
        state.archive.push({ karyawanId: k.id, keterangan: ket, kode: k.kuponKode });
      },
      autoResetLembur: (k) => {
        k.makan = false; k.makanAt = null; k.kuponKode = null; k.kuponStatus = null;
        return true;
      },
      autoReleaseStaleOvertime: () => {},
      cleanupStaleMeals: () => {},
      cleanupStaleReservasiManual: () => {},
      addRiwayat: (nama, jenis) => state.riwayat.unshift({ nama, jenis, waktu: fmtTime(state.now) }),
      catatPresensiMasuk: (k) => state.presensi.push({ karyawanId: k.id, masuk: true }),
      catatPresensiPulang: (k, _iso, lembur) => state.presensi.push({ karyawanId: k.id, lembur: !!lembur }),
      save: () => {},
    },
    Karyawan: {
      cari: (id) => state.karyawan.find((k) => k.id === id) || null,
      render: () => { state.karyawanRender += 1; },
    },
    Dashboard: { render: () => { state.dashboardRender += 1; } },
    Demo: { isEnabled: () => false },
  };
  sandbox.window = sandbox;
  sandbox.__roInstances = [];
  vm.createContext(sandbox);
  vm.runInContext(read('js/scanner.js'), sandbox, { filename: 'scanner.js' });
  vm.runInContext('globalThis.__Scanner = Scanner;', sandbox);
  // Helper test: jalankan SATU timer tertunda (yang paling awal).
  sandbox.__runOneTimer = () => {
    const t = state.timers.shift();
    if (!t) return null;
    t.fn();
    return t.ms;
  };
  sandbox.__pendingTimerMs = () => state.timers.map((t) => t.ms);
  sandbox.__state = state;
  sandbox.__setNow = (h, m) => { state.now = new Date(2026, 10, 16, h, m, 0); };
  return sandbox;
}

function emp(id, nama, patch) {
  return Object.assign({
    id, nama,
    kategori: 'Information Technology',
    foto: null,
    status: 'Aktif',
    absen: false, absenAt: null,
    makan: false, makanAt: null,
    pulangAt: null,
    kuponKode: null, kuponReleased: false, kuponReleasedAt: null,
    kuponStatus: null, kuponDitebusAt: null, kuponJenis: null,
  }, patch || {});
}

async function startAndScan(ctx, kode) {
  await ctx.__Scanner.start();
  assert(typeof ctx.__decode === 'function', 'callback decode tidak terpasang');
  await ctx.__decode(kode);
  return ctx.document.getElementById('resultScan');
}

async function main() {
  console.log('== scanner.js — model dinamis + overlay highlight ==');

  await test('check-in 08:00: overlay ok, ABSENSI MASUK, Tepat waktu, timer 1 detik', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    ctx.__setNow(8, 0);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-ok');
    assertHas(el.innerHTML, 'ABSENSI MASUK');
    assertHas(el.innerHTML, 'Reza Kurnia');
    assertHas(el.innerHTML, 'scan-overlay-name');
    assertHas(el.innerHTML, 'Tepat waktu');
    assertHas(el.innerHTML, 'K0001');
    assert(ctx.__pendingTimerMs()[0] === 1000, 'timer sukses harus 1000ms, dapat ' + ctx.__pendingTimerMs()[0]);
    assert(ctx.__state.audioOsc.length === 1 && ctx.__state.audioOsc[0].frequency.value === 880,
      'beep sukses harus 1 osilator 880Hz');
    assert(ctx.__state.dashboardRender === 1, 'Dashboard.render harus terpanggil 1x');
  });

  await test('check-in 08:05: "Terlambat 5 menit", tetap tercatat', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    ctx.__setNow(8, 5);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'Terlambat 5 menit');
    assert(ctx.__state.karyawan[0].absen === true, '08:05 masih tercatat');
    assert(ctx.__state.riwayat.length === 1, 'riwayat harus tercatat');
  });

  await test('check-in 08:15 (batas toleransi): tercatat, "Terlambat 15 menit"', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    ctx.__setNow(8, 15);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'Terlambat 15 menit');
    assert(ctx.__state.karyawan[0].absen === true, '08:15 masih tercatat');
  });

  await test('check-in 08:16: DITOLAK, tidak tercatat', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    ctx.__setNow(8, 16);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-err');
    assertHas(el.innerHTML, 'DITOLAK');
    assert(ctx.__state.karyawan[0].absen === false, '08:16 tidak boleh tercatat');
    assert(ctx.__state.riwayat.length === 0, 'riwayat tidak boleh bertambah');
    assert(ctx.__pendingTimerMs()[0] === 1000, 'timer err juga 1000ms');
  });

  await test('sudah check-in, scan 15:55: warn BELUM JAM PULANG', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00', kuponKode: 'TR-2611-001', kuponStatus: 'ditebus',
      })],
    });
    ctx.__setNow(15, 55);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-warn');
    assertHas(el.innerHTML, 'BELUM JAM PULANG');
    assert(ctx.__pendingTimerMs()[0] === 1000, 'timer warn juga 1000ms');
  });

  await test('check-out 16:00: ABSENSI PULANG, 0 lembur', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00', kuponKode: 'TR-2611-001', kuponStatus: 'ditebus',
      })],
    });
    ctx.__setNow(16, 0);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'ABSENSI PULANG');
    assert(!el.innerHTML.includes('Lembur'), 'pulang 16:00 = 0 lembur');
    assert(ctx.__state.presensi.some((p) => p.lembur === false), 'presensi pulang tercatat tanpa lembur');
  });

  await test('check-out 17:00: ABSENSI PULANG + "Lembur 1 jam"', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00', kuponKode: 'TR-2611-001', kuponStatus: 'ditebus',
      })],
    });
    ctx.__setNow(17, 0);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'ABSENSI PULANG');
    assertHas(el.innerHTML, 'Lembur 1 jam');
    assert(ctx.__state.presensi.some((p) => p.lembur === true), 'lembur harus tercatat di presensi');
  });

  await test('check-out 18:05: "Lembur 2 jam 5 menit", kupon siang TIDAK direset', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00', kuponKode: 'TR-2611-001', kuponStatus: 'ditebus',
      })],
    });
    ctx.__setNow(18, 5);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'ABSENSI PULANG');
    assertHas(el.innerHTML, 'Lembur 2 jam 5 menit');
    // Model dinamis: kupon lembur diterbitkan terpisah di kantin
    // (ekstra makan), jadi pulang lembur tidak lagi mereset kupon.
    assert(ctx.__state.karyawan[0].makan === true, 'kupon siang tidak direset saat pulang');
    assert(ctx.__state.karyawan[0].kuponKode === 'TR-2611-001', 'kode kupon siang tetap');
  });

  await test('sudah pulang, scan lagi: warn SUDAH PULANG', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00', kuponKode: 'TR-2611-001', kuponStatus: 'ditebus',
        pulangAt: '2026-11-16T17:00:00',
      })],
    });
    ctx.__setNow(18, 5);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-warn');
    assertHas(el.innerHTML, 'SUDAH PULANG');
  });

  await test('kantin 12:00 makan siang: MAKAN SIANG + kode kupon besar, otomatis terbit+ditebus', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', { absen: true, absenAt: '2026-11-16T08:05:00' })],
    });
    ctx.__setNow(12, 0);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-ok');
    assertHas(el.innerHTML, 'MAKAN SIANG');
    assertHas(el.innerHTML, 'TR-2611-001');
    assertHas(el.innerHTML, 'scan-overlay-kupon-kode');
    const k = ctx.__state.karyawan[0];
    assert(k.makan === true && k.kuponStatus === 'ditebus' && k.kuponJenis === 'reguler',
      'kupon harus terbit + ditebus sekaligus, jenis reguler');
    assert(ctx.__state.riwayat[0].jenis === 'Makan Siang', 'riwayat Makan Siang tercatat');
  });

  await test('kantin sudah makan: warn SUDAH AMBIL MAKAN', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00',
        kuponKode: 'TR-2611-001', kuponStatus: 'ditebus', kuponJenis: 'reguler',
      })],
    });
    ctx.__setNow(12, 30);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-warn');
    assertHas(el.innerHTML, 'SUDAH AMBIL MAKAN');
    assert(ctx.__state.audioOsc.length === 2, 'beep warn harus 2 nada');
  });

  await test('kantin 11:59 (di luar jendela): warn DI LUAR JAM MAKAN', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', { absen: true, absenAt: '2026-11-16T08:05:00' })],
    });
    ctx.__setNow(11, 59);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-warn');
    assertHas(el.innerHTML, 'DI LUAR JAM MAKAN');
  });

  await test('kantin 18:05 ekstra makan (lembur 2 jam 5 mnt): EKSTRA MAKAN + kupon lembur', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00',
        kuponKode: 'TR-2611-000', kuponStatus: 'ditebus', kuponJenis: 'reguler',
        pulangAt: '2026-11-16T18:05:00',
      })],
    });
    ctx.__setNow(18, 5);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-ok');
    assertHas(el.innerHTML, 'EKSTRA MAKAN');
    assertHas(el.innerHTML, 'TR-2611-001');
    const k = ctx.__state.karyawan[0];
    assert(k.kuponJenis === 'lembur' && k.kuponStatus === 'ditebus',
      'kupon lembur harus terbit + ditebus');
    assert(ctx.__state.archive.length === 1 &&
      ctx.__state.archive[0].keterangan === 'Makan siang (diganti kupon lembur)',
      'kupon siang lama harus diarsipkan dulu');
    assert(ctx.__state.riwayat[0].jenis === 'Ekstra Makan', 'riwayat Ekstra Makan tercatat');
  });

  await test('kantin 18:00 lembur < 2 jam (pulang 16:05): warn BELUM 2 JAM LEMBUR', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00',
        kuponKode: 'TR-2611-001', kuponStatus: 'ditebus', kuponJenis: 'reguler',
        pulangAt: '2026-11-16T16:05:00',
      })],
    });
    ctx.__setNow(18, 0);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-warn');
    assertHas(el.innerHTML, 'BELUM 2 JAM LEMBUR');
  });

  await test('QR tidak dikenal: err QR TIDAK DIKENALI, timer 1 detik, beep 220Hz', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    const el = await startAndScan(ctx, 'K9999');
    assertHas(el.className, 'scan-overlay-err');
    assertHas(el.innerHTML, 'QR TIDAK DIKENALI');
    assert(ctx.__pendingTimerMs()[0] === 1000, 'timer err harus 1000ms');
    assert(ctx.__state.audioOsc.length === 1 && ctx.__state.audioOsc[0].frequency.value === 220,
      'beep err harus 1 osilator 220Hz');
  });

  await test('karyawan non-aktif: err DITOLAK', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', { status: 'Non-Aktif' })],
    });
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-err');
    assertHas(el.innerHTML, 'DITOLAK');
  });

  await test('duplikat QR sama dalam 2 detik diabaikan', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    await ctx.__Scanner.start();
    await ctx.__decode('K0001');
    const riwayat1 = ctx.__state.riwayat.length;
    await ctx.__decode('K0001'); // <2 detik (waktu nyata) -> diabaikan
    assert(ctx.__state.riwayat.length === riwayat1, 'scan duplikat harus diabaikan');
  });

  await test('tanpa antrean: scan B langsung menggantikan A (tanpa badge menunggu)', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia'), emp('K0002', 'Rio Andika')],
    });
    await ctx.__Scanner.start();
    await ctx.__decode('K0001');
    const el = ctx.document.getElementById('resultScan');
    assertHas(el.innerHTML, 'Reza Kurnia');
    await ctx.__decode('K0002');
    assertHas(el.innerHTML, 'Rio Andika', 'hasil B harus langsung menggantikan A');
    assert(!el.innerHTML.includes('Reza Kurnia'), 'A tidak boleh menetap');
    assert(!el.innerHTML.includes('scan-overlay-waiting'), 'tidak boleh ada badge menunggu');
    assert(typeof ctx.__Scanner.getWaitingCount === 'undefined', 'getWaitingCount sudah dihapus');
    assert(ctx.__pendingTimerMs().length === 1 && ctx.__pendingTimerMs()[0] === 1000,
      'hanya satu timer 1000ms yang berjalan');
  });

  await test('timer 1 detik: overlay hilang sendiri setelah timer jalan', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'show');
    const ms = ctx.__runOneTimer();
    assert(ms === 1000, 'timer harus 1000ms, dapat ' + ms);
    assert(el.innerHTML === '' && !el.className.includes('show'), 'overlay harus hilang setelah 1 detik');
  });

  await test('tombol Tutup: dismissResult membersihkan overlay', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'Reza Kurnia');
    ctx.__Scanner.dismissResult();
    assert(el.innerHTML === '' && !el.className.includes('show'), 'overlay harus hilang setelah dismiss');
  });

  await test('resultHook: setResultHook menerima headline + nama (baris "Terakhir")', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    const seen = [];
    ctx.__Scanner.setResultHook((item) => seen.push(item));
    await startAndScan(ctx, 'K0001');
    assert(seen.length === 1, 'hook harus dipanggil 1x');
    assert(seen[0].headline === 'ABSENSI MASUK', 'headline hook harus ABSENSI MASUK');
    assert(seen[0].name === 'Reza Kurnia', 'nama hook harus Reza Kurnia');
  });

  console.log('== gate layer dashboard (lampu memenuhi layar) ==');

  await test('gate: overlay ok -> gateLayer tampil gate-ok; hilang setelah timer 1 detik', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    const gate = ctx.document.getElementById('gateLayer');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(gate.className, 'gate-layer show gate-ok');
    const ms = ctx.__runOneTimer();
    assert(ms === 1000, 'timer gate harus 1000ms');
    assert(gate.className === 'gate-layer', 'gate harus hilang setelah 1 detik, dapat "' + gate.className + '"');
    assert(el.innerHTML === '', 'overlay hero juga harus hilang');
  });

  await test('gate: overlay err -> gate-err; warn -> gate-warn', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    const gate = ctx.document.getElementById('gateLayer');
    ctx.__setNow(8, 16);
    await startAndScan(ctx, 'K0001');
    assertHas(gate.className, 'gate-err');
    const ctx2 = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', { absen: true, absenAt: '2026-11-16T08:05:00' })],
    });
    const gate2 = ctx2.document.getElementById('gateLayer');
    ctx2.__setNow(15, 55);
    await startAndScan(ctx2, 'K0001');
    assertHas(gate2.className, 'gate-warn');
  });

  await test('gate: dismissResult menyembunyikan gate lebih awal', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    const gate = ctx.document.getElementById('gateLayer');
    await startAndScan(ctx, 'K0001');
    assertHas(gate.className, 'show');
    ctx.__Scanner.dismissResult();
    assert(gate.className === 'gate-layer', 'gate harus hilang setelah dismiss');
  });

  await test('gate: scan baru menggantikan gate (ok -> err), tetap satu timer', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    const gate = ctx.document.getElementById('gateLayer');
    await ctx.__Scanner.start();
    await ctx.__decode('K0001');
    assertHas(gate.className, 'gate-ok');
    await ctx.__decode('K9999');
    assertHas(gate.className, 'gate-err');
    assert(ctx.__pendingTimerMs().length === 1 && ctx.__pendingTimerMs()[0] === 1000,
      'hanya satu timer 1000ms yang berjalan');
  });

  await test('bunyi: default ON, bisa dimatikan + tersimpan', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    assert(ctx.__Scanner.isSoundEnabled() === true, 'default bunyi harus ON');
    ctx.__Scanner.setSoundEnabled(false);
    assert(ctx.__Scanner.isSoundEnabled() === false, 'setSoundEnabled(false) harus mematikan');
    assert(ctx.localStorage.getItem('scan_sound') === '0', 'harus tersimpan di localStorage');
    await startAndScan(ctx, 'K0001');
    assert(ctx.__state.audioOsc.length === 0, 'bunyi mati = tidak ada osilator');
  });

  console.log('== dashboard.js — flash statistik & riwayat ==');

  await test('dashboard: render pertama tidak flash; perubahan angka flash 1 detik', async () => {
    const doc = makeDocument();
    const state = {
      karyawan: [emp('K0001', 'Reza Kurnia')],
      riwayat: [],
      timers: [],
    };
    const sandbox = {
      console,
      document: doc,
      setTimeout: (fn, ms) => { const id = state.timers.length + 1; state.timers.push({ id, fn, ms }); return id; },
      clearTimeout: (id) => { state.timers = state.timers.filter((t) => t.id !== id); },
      Utils: {
        escapeHtml: (v) => String(v == null ? '' : v),
        isToday: (v) => !!v && String(v).slice(0, 10) === '2026-11-16',
        toLocalISODate: (v) => (v ? String(v).slice(0, 10) : ''),
      },
      Storage: {
        getKaryawan: () => state.karyawan,
        getReservasiManual: () => [],
        getReservasiArchive: () => [],
        getPresensi: () => [],
        getRiwayat: () => state.riwayat,
        todayLocalISO: () => '2026-11-16',
        autoReleaseStaleOvertime: () => {},
        cleanupStaleMeals: () => {},
        cleanupStaleReservasiManual: () => {},
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(read('js/dashboard.js'), sandbox, { filename: 'dashboard.js' });
    vm.runInContext('globalThis.__Dashboard = Dashboard;', sandbox);
    const D = sandbox.__Dashboard;
    D.render();
    const hadirEl = doc.getElementById('statHadir');
    assert(!hadirEl.classList.contains('stat-flash'), 'render pertama tidak boleh flash');
    // Karyawan absen -> statHadir 0->1, statBelum 1->0
    state.karyawan[0].absen = true;
    state.karyawan[0].absenAt = '2026-11-16T08:05:00';
    D.render();
    assert(hadirEl.classList.contains('stat-flash'), 'statHadir harus flash saat berubah');
    assert(doc.getElementById('statBelum').classList.contains('stat-flash'), 'statBelum harus flash saat berubah');
    assert(!doc.getElementById('statTotal').classList.contains('stat-flash'), 'statTotal tidak berubah -> tidak flash');
    // Jalankan timer 1000ms -> flash dilepas
    const t = state.timers.shift();
    assert(t && t.ms === 1000, 'timer lepas flash harus 1000ms');
    t.fn();
    assert(!hadirEl.classList.contains('stat-flash'), 'flash harus lepas setelah 1 detik');
  });

  await test('dashboard: baris riwayat baru disorot, render tanpa tambahan tidak', async () => {
    const doc = makeDocument();
    const state = {
      karyawan: [emp('K0001', 'Reza Kurnia')],
      riwayat: [],
      timers: [],
    };
    const sandbox = {
      console,
      document: doc,
      setTimeout: (fn, ms) => { const id = state.timers.length + 1; state.timers.push({ id, fn, ms }); return id; },
      clearTimeout: (id) => { state.timers = state.timers.filter((t) => t.id !== id); },
      Utils: {
        escapeHtml: (v) => String(v == null ? '' : v),
        isToday: (v) => !!v && String(v).slice(0, 10) === '2026-11-16',
        toLocalISODate: (v) => (v ? String(v).slice(0, 10) : ''),
      },
      Storage: {
        getKaryawan: () => state.karyawan,
        getReservasiManual: () => [],
        getReservasiArchive: () => [],
        getPresensi: () => [],
        getRiwayat: () => state.riwayat,
        todayLocalISO: () => '2026-11-16',
        autoReleaseStaleOvertime: () => {},
        cleanupStaleMeals: () => {},
        cleanupStaleReservasiManual: () => {},
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(read('js/dashboard.js'), sandbox, { filename: 'dashboard.js' });
    vm.runInContext('globalThis.__Dashboard = Dashboard;', sandbox);
    const D = sandbox.__Dashboard;
    const tbody = doc.getElementById('riwayat');
    state.riwayat.unshift({ nama: 'Reza Kurnia', jenis: 'Absensi', waktu: '08:05' });
    D.render(); // render pertama dengan riwayat -> belum ada pembanding, tidak sorot
    let row = tbody.querySelector('tr');
    assert(row && !row.classList.contains('riwayat-new'), 'render pertama tidak boleh sorot');
    state.riwayat.unshift({ nama: 'Rio Andika', jenis: 'Absensi', waktu: '08:06' });
    D.render(); // riwayat bertambah -> sorot baris terbaru
    row = tbody.querySelector('tr');
    assert(row && row.classList.contains('riwayat-new'), 'baris riwayat baru harus disorot');
    D.render(); // tidak ada tambahan -> tidak sorot lagi
    row = tbody.querySelector('tr');
    assert(row && !row.classList.contains('riwayat-new'), 'tanpa tambahan tidak boleh sorot');
  });

  console.log('== kiosk.js — Mode Kiosk-lite (kamera dulu, baru fullscreen) ==');

  await test('kiosk: toggle sembunyikan menu + fullscreen, tersimpan', async () => {
    const doc = makeDocument();
    const localStorage = makeLocalStorage();
    const sandbox = {
      console, document: doc, localStorage,
    };
    vm.createContext(sandbox);
    vm.runInContext(read('js/kiosk.js'), sandbox, { filename: 'kiosk.js' });
    vm.runInContext('globalThis.__Kiosk = Kiosk;', sandbox);
    const K = sandbox.__Kiosk;
    const btn = doc.getElementById('btnKioskToggle');
    assert(K.isEnabled() === false, 'default kiosk mati');
    await K.toggle();
    assert(doc.body.classList.contains('kiosk-lite'), 'body harus punya class kiosk-lite');
    assert(localStorage.getItem('kiosk_lite') === '1', 'harus tersimpan');
    assert(doc.documentElement.requestFullscreenCalls === 1, 'harus minta fullscreen');
    assert(btn.textContent === '⛶ Keluar Kiosk', 'label tombol harus berubah');
    await K.toggle();
    assert(!doc.body.classList.contains('kiosk-lite'), 'toggle kedua harus keluar kiosk');
    assert(doc.exitFullscreenCalls === 1, 'harus keluar fullscreen');
    assert(btn.textContent === '⛶ Mode Kiosk', 'label kembali');
  });

  await test('kiosk: init terapkan status tersimpan tanpa fullscreen', async () => {
    const doc = makeDocument();
    const localStorage = makeLocalStorage();
    localStorage.setItem('kiosk_lite', '1');
    const sandbox = { console, document: doc, localStorage };
    vm.createContext(sandbox);
    vm.runInContext(read('js/kiosk.js'), sandbox, { filename: 'kiosk.js' });
    vm.runInContext('globalThis.__Kiosk = Kiosk;', sandbox);
    sandbox.__Kiosk.init();
    assert(doc.body.classList.contains('kiosk-lite'), 'init harus terapkan CSS tersimpan');
    assert(doc.documentElement.requestFullscreenCalls === 0, 'init tidak boleh minta fullscreen (butuh gesture)');
  });

  await test('kiosk: enable() jalankan kamera DULU baru fullscreen', async () => {
    const doc = makeDocument();
    const localStorage = makeLocalStorage();
    const order = [];
    const scannerStub = {
      active: false,
      startCalls: 0, stopCalls: 0,
      isActive() { return this.active; },
      async start() { this.startCalls += 1; order.push('camera'); this.active = true; },
      async stop() { this.stopCalls += 1; this.active = false; },
    };
    const origRequest = doc.documentElement.requestFullscreen;
    doc.documentElement.requestFullscreen = () => {
      order.push('fullscreen');
      return origRequest();
    };
    const sandbox = { console, document: doc, localStorage, Scanner: scannerStub };
    vm.createContext(sandbox);
    vm.runInContext(read('js/kiosk.js'), sandbox, { filename: 'kiosk.js' });
    vm.runInContext('globalThis.__Kiosk = Kiosk;', sandbox);
    await sandbox.__Kiosk.enable();
    assert(scannerStub.startCalls === 1, 'kamera harus dijalankan dulu');
    assert(doc.documentElement.requestFullscreenCalls === 1, 'fullscreen harus diminta setelah kamera');
    assert(order[0] === 'camera' && order[1] === 'fullscreen',
      'urutan harus kamera -> fullscreen, dapat ' + order.join(' -> '));
  });

  await test('kiosk: enable() tidak restart kamera bila sudah jalan', async () => {
    const doc = makeDocument();
    const localStorage = makeLocalStorage();
    const scannerStub = {
      active: true,
      startCalls: 0, stopCalls: 0,
      isActive() { return this.active; },
      async start() { this.startCalls += 1; this.active = true; },
      async stop() { this.stopCalls += 1; this.active = false; },
    };
    const sandbox = { console, document: doc, localStorage, Scanner: scannerStub };
    vm.createContext(sandbox);
    vm.runInContext(read('js/kiosk.js'), sandbox, { filename: 'kiosk.js' });
    vm.runInContext('globalThis.__Kiosk = Kiosk;', sandbox);
    await sandbox.__Kiosk.enable();
    assert(scannerStub.startCalls === 0, 'kamera yang sudah jalan tidak boleh di-start ulang');
    assert(doc.documentElement.requestFullscreenCalls === 1, 'fullscreen tetap diminta');
  });

  await test('kiosk: enable() tidak menyalakan kamera bila manual-off (tombol mati)', async () => {
    const doc = makeDocument();
    const localStorage = makeLocalStorage();
    // Flag manual-off dari main.js (dicerminkan ke body dataset).
    doc.body.dataset = { cameraManualOff: '1' };
    const scannerStub = {
      active: false,
      startCalls: 0, stopCalls: 0,
      isActive() { return this.active; },
      async start() { this.startCalls += 1; this.active = true; },
      async stop() { this.stopCalls += 1; this.active = false; },
    };
    const sandbox = { console, document: doc, localStorage, Scanner: scannerStub };
    vm.createContext(sandbox);
    vm.runInContext(read('js/kiosk.js'), sandbox, { filename: 'kiosk.js' });
    vm.runInContext('globalThis.__Kiosk = Kiosk;', sandbox);
    await sandbox.__Kiosk.enable();
    assert(scannerStub.startCalls === 0, 'kamera manual-off tidak boleh dinyalakan kiosk');
    assert(doc.documentElement.requestFullscreenCalls === 1, 'fullscreen tetap diminta');
  });

  await test('kiosk: fullscreenchange restart scanner (video/qrbox dihitung ulang)', async () => {
    const doc = makeDocument();
    const localStorage = makeLocalStorage();
    const scannerStub = {
      active: true,
      startCalls: 0, stopCalls: 0,
      isActive() { return this.active; },
      async start() { this.startCalls += 1; this.active = true; },
      async stop() { this.stopCalls += 1; this.active = false; },
    };
    const sandbox = { console, document: doc, localStorage, Scanner: scannerStub };
    vm.createContext(sandbox);
    vm.runInContext(read('js/kiosk.js'), sandbox, { filename: 'kiosk.js' });
    vm.runInContext('globalThis.__Kiosk = Kiosk;', sandbox);
    sandbox.__Kiosk.init();
    doc._fire('fullscreenchange');
    await new Promise((r) => setTimeout(r, 10));
    assert(scannerStub.stopCalls === 1, 'scanner harus di-stop saat fullscreenchange');
    assert(scannerStub.startCalls === 1, 'scanner harus di-start lagi setelah stop');
    assert(scannerStub.active === true, 'scanner harus aktif lagi setelah restart');
  });

  await test('kiosk: fullscreenchange tidak restart bila scanner mati', async () => {
    const doc = makeDocument();
    const localStorage = makeLocalStorage();
    const scannerStub = {
      active: false,
      startCalls: 0, stopCalls: 0,
      isActive() { return this.active; },
      async start() { this.startCalls += 1; this.active = true; },
      async stop() { this.stopCalls += 1; this.active = false; },
    };
    const sandbox = { console, document: doc, localStorage, Scanner: scannerStub };
    vm.createContext(sandbox);
    vm.runInContext(read('js/kiosk.js'), sandbox, { filename: 'kiosk.js' });
    vm.runInContext('globalThis.__Kiosk = Kiosk;', sandbox);
    sandbox.__Kiosk.init();
    doc._fire('fullscreenchange');
    await new Promise((r) => setTimeout(r, 10));
    assert(scannerStub.stopCalls === 0 && scannerStub.startCalls === 0,
      'scanner mati tidak boleh di-restart');
  });

  console.log('== pivot dashboard = layar scan (file statis + utils asli) ==');

  await test('index.html: ada jam topbar + gate layer + tombol nyala/mati kamera; tanpa tombol Mulai/Stop/Buka Halaman Scan', async () => {
    const html = read('index.html');
    assertHas(html, 'id="dashClockTime"');
    assertHas(html, 'id="dashClockDate"');
    assertHas(html, 'id="gateLayer"');
    assertHas(html, 'id="btnToggleCamera"');
    assertHas(html, 'Nyalakan Kamera');
    assertHas(html, 'css/style.css?v=camtoggle1');
    assert(!html.includes('data-scan-start'), 'tidak boleh ada tombol Mulai Scan');
    assert(!html.includes('data-scan-stop'), 'tidak boleh ada tombol Stop');
    assert(!html.includes('btnOpenScanPage'), 'tidak boleh ada tombol Buka Halaman Scan');
    assert(!html.includes('Mulai Scan'), 'teks "Mulai Scan" tidak boleh tersisa');
    assert(!html.includes('scan.html'), 'tidak boleh ada referensi scan.html');
    assert(!html.includes('heroHint'), 'heroHint harus sudah dihapus');
    assertHas(html, 'id="scanLast"');
    assertHas(html, 'id="scanLastText"');
  });

  await test('scan.html + js/scan-page.js sudah dihapus', async () => {
    assert(!fs.existsSync(path.join(ROOT, 'scan.html')), 'scan.html harus sudah dihapus');
    assert(!fs.existsSync(path.join(ROOT, 'js/scan-page.js')), 'js/scan-page.js harus sudah dihapus');
  });

  await test('main.js: auto-start kamera saat dashboard aktif; tanpa binding Start/Stop/Buka Halaman Scan', async () => {
    const src = read('js/main.js');
    assertHas(src, "if (tab === 'dashboard')");
    assertHas(src, 'Scanner.start()');
    assertHas(src, 'initDashClock');
    assertHas(src, 'tickDashClock');
    assert(!src.includes('data-scan-start'), 'binding Mulai Scan harus dihapus');
    assert(!src.includes('data-scan-stop'), 'binding Stop harus dihapus');
    assert(!src.includes('btnOpenScanPage'), 'handler Buka Halaman Scan harus dihapus');
    assert(!src.includes('scan.html'), 'tidak boleh ada referensi scan.html');
  });

  await test('css: aturan gate + jam topbar ada; tidak ada sisa CSS scan-page', async () => {
    const css = read('css/style.css');
    assertHas(css, '.gate-layer');
    assertHas(css, '.gate-layer.gate-ok');
    assertHas(css, '.gate-layer.gate-err');
    assertHas(css, '.topbar-clock-time');
    assert(!css.includes('body.scan-page'), 'CSS scan-page harus sudah dihapus');
    assert(!css.includes('scan-page-clock'), 'CSS jam scan-page harus sudah dihapus');
    assertHas(css, 'aspect-ratio: 1 / 1');
    assertHas(css, 'grid-template-columns: auto 1fr');
    assertHas(css, 'max-width: 560px');
    assertHas(css, 'clamp(230px, 34vh, 360px)');
    assertHas(css, '.scan-last');
    assertHas(css, '.camera-toggle');
    assert(!css.includes('.hero-hint {'), 'aturan .hero-hint harus sudah dihapus');
  });

  await test('scanner.js: MODE_TEXT hanya title+desc; desc presensi satu baris aturan lengkap', async () => {
    const src = read('js/scanner.js');
    assert(!src.includes('heroHint'), 'scanner.js tidak boleh lagi menyentuh heroHint');
    assert(!src.includes('hint:'), 'MODE_TEXT tidak boleh lagi punya field hint');
    assertHas(src, "desc: 'Pagi check-in (maks 08:15) &middot; 12:00 makan siang &middot; 16:00 check-out &middot; &gt;16:00 lembur.'");
    assertHas(src, "desc: '12:00&ndash;13:00 makan siang &middot; &ge;18:00 ekstra makan (lembur &ge; 2 jam). Kupon otomatis terbit.'");
  });

  await test('setMode: judul + desc satu baris per mode', async () => {
    const ctx = freshScannerCtx({ karyawan: [] });
    ctx.__Scanner.setMode('presensi');
    assert(ctx.document.getElementById('scanTitle').textContent === 'Scan QR Karyawan — Presensi', 'judul presensi');
    assert(ctx.document.getElementById('scanDesc').innerHTML === 'Pagi check-in (maks 08:15) &middot; 12:00 makan siang &middot; 16:00 check-out &middot; &gt;16:00 lembur.', 'desc presensi satu baris');
    ctx.__Scanner.setMode('kantin');
    assert(ctx.document.getElementById('scanTitle').textContent === 'Scan Kantin — Makan', 'judul kantin');
    assert(ctx.document.getElementById('scanDesc').innerHTML === '12:00&ndash;13:00 makan siang &middot; &ge;18:00 ekstra makan (lembur &ge; 2 jam). Kupon otomatis terbit.', 'desc kantin');
  });

  await test('main.js: auto-start kamera ditunda (double rAF + 300ms) dengan guard dashboard', async () => {
    const src = read('js/main.js');
    assertHas(src, 'scheduleDashboardScanStart');
    assertHas(src, 'requestAnimationFrame');
    assertHas(src, 'startDashboardScanner');
    assertHas(src, 'setTimeout(startDashboardScanner, 300)');
    assertHas(src, "panel-dashboard");
    assertHas(src, "if (tab === 'dashboard')");
  });

  await test('main.js: tombol nyala/mati kamera — manual-off menghalangi auto-start, nyala lewat jalur auto-start', async () => {
    const src = read('js/main.js');
    assertHas(src, 'btnToggleCamera');
    assertHas(src, 'initCameraToggle');
    assertHas(src, 'initCameraToggle();');
    assertHas(src, 'onCameraToggleClick');
    assertHas(src, 'cameraManualOff');
    assertHas(src, 'setCameraManualOff');
    assertHas(src, 'if (cameraManualOff) return;');
    assertHas(src, 'syncCameraToggleLabel');
    assertHas(src, 'setCameraStatusHook');
    assertHas(src, "btn.textContent = on ? 'Matikan Kamera' : 'Nyalakan Kamera'");
    assertHas(src, "document.body.dataset.cameraManualOff = '1'");
    // Nyalakan memakai jalur auto-start yang sama (deferred + fitVideo).
    assertHas(src, 'scheduleDashboardScanStart();');
    // Matikan membatalkan auto-start yang masih tertunda + stop kamera.
    assertHas(src, 'cancelPendingDashboardStart();');
    assertHas(src, 'Scanner.stop()');
  });

  await test('main.js: baris Terakhir dihubungkan lewat Scanner.setResultHook', async () => {
    const src = read('js/main.js');
    assertHas(src, 'setResultHook');
    assertHas(src, 'renderScanLast');
    assertHas(src, 'initScanLast');
    assertHas(src, 'scanLastText');
    assertHas(src, 'initScanLast();');
  });

  await test('demo.js: kunci data demo v2; data v1 lama diabaikan, seed baru 4 karyawan + 2 kartu', async () => {
    const src = read('js/demo.js');
    assertHas(src, 'absensi_demo_data_v2');
    assert(!src.includes('absensi_demo_data_v1'), 'kunci v1 tidak boleh tersisa');
    const doc = makeDocument();
    const localStorage = makeLocalStorage();
    // Data demo LAMA model hitung-scan ("Kupon Makan" 07:55) di kunci v1.
    localStorage.setItem('absensi_demo_data_v1', JSON.stringify({
      karyawan: [{ id: 'K0001', nama: 'Reza Kurnia' }],
      riwayat: [{ nama: 'Reza Kurnia', jenis: 'Kupon Makan', waktu: '07:55' }],
    }));
    const sandbox = { console, document: doc, localStorage };
    vm.createContext(sandbox);
    vm.runInContext(read('js/demo.js'), sandbox, { filename: 'demo.js' });
    vm.runInContext('globalThis.__Demo = Demo;', sandbox);
    const snap = sandbox.__Demo.ensureSeed();
    assert(snap.karyawan.length === 4, 'seed baru harus 4 karyawan');
    assert(snap.karyawan[0].id === 'K0001' && snap.karyawan[0].nama === 'Reza Kurnia', 'seed K0001 Reza Kurnia');
    assert(snap.jenisKartu.length === 2, 'seed harus 2 jenis kartu');
    assert(snap.riwayat.length === 0, 'riwayat seed baru harus kosong (tanpa "Kupon Makan" 07:55)');
    assert(localStorage.getItem('absensi_demo_data_v2') !== null, 'seed baru harus tersimpan di kunci v2');
  });

  console.log('== video persegi 1:1 — fitVideoToHero + ResizeObserver ==');

  await test('video: setelah start, video #reader dipaksa 100% x 100% (menimpa inline bekuan library)', async () => {
    const ctx = freshScannerCtx({ karyawan: [] });
    await ctx.__Scanner.start();
    const video = ctx.document.getElementById('reader').querySelector('video');
    assert(video.style.width === '100%', 'lebar video harus 100%, dapat ' + video.style.width);
    assert(video.style.height === '100%', 'tinggi video harus 100%, dapat ' + video.style.height);
  });

  await test('video: fitVideoToHero diekspor dan bisa dipanggil langsung', async () => {
    const ctx = freshScannerCtx({ karyawan: [] });
    assert(typeof ctx.__Scanner.fitVideoToHero === 'function', 'fitVideoToHero harus diekspor');
    const video = ctx.document.getElementById('reader').querySelector('video');
    video.style.width = '250px';
    video.style.height = '250px';
    ctx.__Scanner.fitVideoToHero();
    assert(video.style.width === '100%' && video.style.height === '100%', 'fitVideoToHero harus memaksa 100%');
  });

  await test('video: ResizeObserver terpasang saat start; resize menerapkan ulang 100% tanpa restart scanner', async () => {
    const ctx = freshScannerCtx({ karyawan: [] });
    await ctx.__Scanner.start();
    assert(ctx.__roInstances.length === 1, 'satu ResizeObserver harus terpasang');
    const ro = ctx.__roInstances[0];
    assert(ro.observed === ctx.document.getElementById('reader'), 'observer harus mengamati #reader');
    const video = ctx.document.getElementById('reader').querySelector('video');
    video.style.width = '250px'; // simulasi ukuran meleset setelah resize/kiosk
    ro.cb();
    assert(ctx.__pendingTimerMs().includes(300), 'debounce 300ms harus terjadwal, dapat ' + ctx.__pendingTimerMs());
    ctx.__runOneTimer();
    assert(video.style.width === '100%' && video.style.height === '100%', 'video harus kembali 100% setelah debounce');
    assert(ctx.__state.qrStartCalls === 1, 'scanner tidak boleh restart saat resize, start=' + ctx.__state.qrStartCalls);
  });

  await test('video: stop() melepas observer (disconnect)', async () => {
    const ctx = freshScannerCtx({ karyawan: [] });
    await ctx.__Scanner.start();
    await ctx.__Scanner.stop();
    assert(ctx.__roInstances[0].disconnected === true, 'observer harus disconnect saat stop');
  });

  await test('video: tanpa ResizeObserver (browser lama) start tetap jalan, video tetap 100%', async () => {
    const ctx = freshScannerCtx({ karyawan: [] });
    delete ctx.ResizeObserver;
    await ctx.__Scanner.start();
    const video = ctx.document.getElementById('reader').querySelector('video');
    assert(video.style.width === '100%', 'tanpa ResizeObserver pun video harus 100%');
  });

  await test('kamera: hook status dipanggil true saat start sukses, false saat stop', async () => {
    const ctx = freshScannerCtx({ karyawan: [] });
    const calls = [];
    ctx.__Scanner.setCameraStatusHook((on) => calls.push(on));
    await ctx.__Scanner.start();
    assert(calls.length === 1 && calls[0] === true,
      'start sukses harus memanggil hook(true), dapat ' + JSON.stringify(calls));
    await ctx.__Scanner.stop();
    assert(calls.length === 2 && calls[1] === false,
      'stop harus memanggil hook(false), dapat ' + JSON.stringify(calls));
  });

  await test('kamera: start gagal (izin ditolak) memanggil hook(false) supaya tombol bisa retry', async () => {
    const ctx = freshScannerCtx({ karyawan: [] });
    const calls = [];
    ctx.__Scanner.setCameraStatusHook((on) => calls.push(on));
    ctx.Html5Qrcode = class {
      constructor() {}
      start() { return Promise.reject(new Error('izin ditolak')); }
      stop() { return Promise.resolve(); }
      clear() {}
    };
    await ctx.__Scanner.start();
    assert(ctx.__Scanner.isActive() === false, 'scanner harus tidak aktif setelah gagal start');
    assert(calls.length === 1 && calls[0] === false,
      'gagal start harus memanggil hook(false), dapat ' + JSON.stringify(calls));
  });

  await test('utils: formatJam + formatTanggalID (kode asli)', async () => {
    const sandbox = { console, localStorage: makeLocalStorage() };
    vm.createContext(sandbox);
    vm.runInContext(read('js/utils.js'), sandbox, { filename: 'utils.js' });
    vm.runInContext('globalThis.__Utils = Utils;', sandbox);
    const U = sandbox.__Utils;
    assert(U.formatJam(new Date(2026, 10, 16, 9, 1, 49)) === '09:01:49', 'formatJam harus 09:01:49');
    assert(U.formatJam(new Date(2026, 10, 16, 0, 0, 5)) === '00:00:05', 'formatJam harus 00:00:05');
    assert(U.formatTanggalID(new Date(2026, 10, 16)) === 'Senin, 16 November 2026',
      'formatTanggalID harus "Senin, 16 November 2026"');
    assert(U.formatTanggalID(new Date(2026, 0, 1)) === 'Kamis, 1 Januari 2026',
      'formatTanggalID harus "Kamis, 1 Januari 2026"');
  });

  console.log('\n' + passed + ' lulus, ' + failed + ' gagal');
  if (failures.length) console.log('Gagal:\n- ' + failures.join('\n- '));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
