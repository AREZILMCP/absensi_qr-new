/* Tes Node untuk UX highlight scan (plan UX §3-4, cakupan prototipe).
   Menguji KODE ASLI js/scanner.js, js/dashboard.js, js/kiosk.js lewat
   vm dengan stub DOM/Utils/Storage — tanpa browser dan tanpa kamera.
   Yang TIDAK diuji di sini (butuh browser + kamera asli): alur scan
   1-4 end-to-end lewat kamera sungguhan.
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
    getElementById: (id) => get(id),
    querySelectorAll: () => [],
  };
  // Closure di atas objek doc (bukan `document` global Node).
  doc.documentElement.requestFullscreen = () => {
    doc.documentElement.requestFullscreenCalls += 1;
    doc.fullscreenElement = doc.documentElement;
    return Promise.resolve();
  };
  doc.exitFullscreen = () => {
    doc.exitFullscreenCalls += 1;
    doc.fullscreenElement = null;
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
    Html5Qrcode: class {
      constructor() {}
      start(_opts, _cfg, onDecode) {
        sandbox.__decode = onDecode;
        return Promise.resolve();
      }
      stop() { return Promise.resolve(); }
      clear() {}
    },
    Utils: {
      escapeHtml: (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'),
      now: () => new Date(state.now),
      nowIso: () => todayStr() + 'T' + fmtTime(state.now),
      todayLocalISO: () => todayStr(),
      toLocalISODate: (v) => (v ? String(v).slice(0, 10) : ''),
      isToday: (v) => !!v && String(v).slice(0, 10) === todayStr(),
      isSudahJamPulang: () => state.now.getHours() * 60 + state.now.getMinutes() >= 16 * 60,
      isLembur: () => state.now.getHours() * 60 + state.now.getMinutes() > 18 * 60,
      formatJamPulang: () => '16:00',
      nextKodeTransaksi: () => 'TR-2611-' + String(++state.kodeSeq).padStart(3, '0'),
      isSimulated: () => false,
      isKaryawanNonAktif: (k) => String(k.status || '').toLowerCase() === 'non-aktif',
    },
    Storage: {
      getKaryawan: () => state.karyawan,
      getReservasiManual: () => [],
      getReservasiArchive: () => [],
      getPresensi: () => state.presensi,
      getRiwayat: () => state.riwayat,
      todayLocalISO: () => todayStr(),
      archiveStaleMeal: () => false,
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
  console.log('== scanner.js — overlay highlight ==');

  await test('scan 1 masuk: overlay ok, nama besar, Tepat waktu', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    ctx.__setNow(8, 0); // tepat waktu = masuk 08:00 (aturan: >08:00 terlambat)
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-ok');
    assertHas(el.innerHTML, 'ABSENSI MASUK');
    assertHas(el.innerHTML, 'Reza Kurnia');
    assertHas(el.innerHTML, 'scan-overlay-name');
    assertHas(el.innerHTML, 'Tepat waktu');
    assertHas(el.innerHTML, 'K0001');
    assert(ctx.__pendingTimerMs()[0] === 3000, 'timer sukses harus 3000ms, dapat ' + ctx.__pendingTimerMs()[0]);
    assert(ctx.__state.audioOsc.length === 1 && ctx.__state.audioOsc[0].frequency.value === 880,
      'beep sukses harus 1 osilator 880Hz');
    assert(ctx.__state.dashboardRender === 1, 'Dashboard.render harus terpanggil 1x');
  });

  await test('scan 1 masuk terlambat: "Terlambat 10 menit"', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    ctx.__setNow(8, 10);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'Terlambat 10 menit');
  });

  await test('scan 2: KUPON MAKAN TERBIT + kode kupon besar', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', { absen: true, absenAt: '2026-11-16T08:05:00' })],
    });
    ctx.__setNow(12, 0);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-ok');
    assertHas(el.innerHTML, 'KUPON MAKAN TERBIT');
    assertHas(el.innerHTML, 'TR-2611-001');
    assertHas(el.innerHTML, 'scan-overlay-kupon-kode');
    assertHas(el.innerHTML, 'Tebus di kantin');
  });

  await test('scan 3 pulang 16:05: ABSENSI PULANG tanpa lembur', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00', kuponKode: 'TR-2611-001', kuponStatus: 'terbit',
      })],
    });
    ctx.__setNow(16, 5);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'ABSENSI PULANG');
    assert(!el.innerHTML.includes('LEMBUR'), 'pulang 16:05 bukan lembur');
  });

  await test('scan 3 pulang 18:05: lembur + kupon direset', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00', kuponKode: 'TR-2611-001', kuponStatus: 'terbit',
      })],
    });
    ctx.__setNow(18, 5);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'ABSENSI PULANG');
    assertHas(el.innerHTML, 'Lembur');
    assertHas(el.innerHTML, 'kupon reguler direset');
  });

  await test('scan 4: KUPON LEMBUR TERBIT + kode baru', async () => {
    const ctx = freshScannerCtx({
      // Seperti sesudah scan 3 lembur: kupon reguler sudah direset
      // (makan=false) sehingga scan 4 menerbitkan kupon lembur.
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: false, makanAt: null, kuponKode: null, kuponStatus: null,
        pulangAt: '2026-11-16T18:05:00',
      })],
    });
    ctx.__setNow(18, 10);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'KUPON LEMBUR TERBIT');
    assertHas(el.innerHTML, 'TR-2611-001');
  });

  await test('kantin tebus ok: KUPON DITEBUS + kode', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00', kuponKode: 'TR-2611-001', kuponStatus: 'terbit',
      })],
    });
    ctx.__setNow(12, 3);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'KUPON DITEBUS');
    assertHas(el.innerHTML, 'TR-2611-001');
  });

  await test('kantin tebus ganda: warn SUDAH DITEBUS, timer 4000', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00',
        kuponKode: 'TR-2611-001', kuponStatus: 'ditebus', kuponDitebusAt: '2026-11-16T12:03:00',
      })],
    });
    ctx.__setNow(12, 30);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-warn');
    assertHas(el.innerHTML, 'SUDAH DITEBUS');
    assert(ctx.__pendingTimerMs()[0] === 4000, 'timer warn harus 4000ms');
    assert(ctx.__state.audioOsc.length === 2, 'beep warn harus 2 nada');
  });

  await test('kantin tanpa kupon: warn TIDAK ADA KUPON', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', { absen: true, absenAt: '2026-11-16T08:05:00' })],
    });
    ctx.__setNow(12, 0);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-warn');
    assertHas(el.innerHTML, 'TIDAK ADA KUPON');
  });

  await test('QR tidak dikenal: err QR TIDAK DIKENALI, timer 5000', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    const el = await startAndScan(ctx, 'K9999');
    assertHas(el.className, 'scan-overlay-err');
    assertHas(el.innerHTML, 'QR TIDAK DIKENALI');
    assert(ctx.__pendingTimerMs()[0] === 5000, 'timer err harus 5000ms');
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

  await test('pulang sebelum 16:00: warn SUDAH TERCATAT', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia', {
        absen: true, absenAt: '2026-11-16T08:05:00',
        makan: true, makanAt: '2026-11-16T12:00:00', kuponKode: 'TR-2611-001', kuponStatus: 'terbit',
      })],
    });
    ctx.__setNow(15, 55);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.className, 'scan-overlay-warn');
    assertHas(el.innerHTML, 'SUDAH TERCATAT');
  });

  await test('duplikat QR sama dalam 2 detik diabaikan', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    await ctx.__Scanner.start();
    await ctx.__decode('K0001');
    const riwayat1 = ctx.__state.riwayat.length;
    await ctx.__decode('K0001'); // <2 detik (waktu nyata) -> diabaikan
    assert(ctx.__state.riwayat.length === riwayat1, 'scan duplikat harus diabaikan');
    assert(ctx.__Scanner.getWaitingCount() === 0, 'duplikat tidak masuk antrean');
  });

  await test('antrean: scan B menunggu saat overlay A tampil, lalu tampil', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia'), emp('K0002', 'Rio Andika')],
    });
    await ctx.__Scanner.start();
    await ctx.__decode('K0001');
    const el = ctx.document.getElementById('resultScan');
    assertHas(el.innerHTML, 'Reza Kurnia');
    await ctx.__decode('K0002');
    assertHas(el.innerHTML, 'Reza Kurnia', 'hasil A tidak boleh tertimpa B');
    assert(ctx.__Scanner.getWaitingCount() === 1, 'waiting harus 1');
    const badge = el.querySelector('.scan-overlay-waiting');
    assert(badge && !badge.hidden && badge.textContent === '+1 scan menunggu',
      'badge menunggu harus "+1 scan menunggu"');
    ctx.__runOneTimer(); // timer A habis -> B tampil
    assertHas(el.innerHTML, 'Rio Andika');
    assert(ctx.__Scanner.getWaitingCount() === 0, 'antrean habis setelah B tampil');
  });

  await test('antrean maks 1: B lalu C, yang tampil C (terbaru)', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia'), emp('K0002', 'Rio Andika'), emp('K0003', 'Orta Dinanti')],
    });
    await ctx.__Scanner.start();
    await ctx.__decode('K0001');
    const el = ctx.document.getElementById('resultScan');
    await ctx.__decode('K0002');
    await ctx.__decode('K0003');
    assert(ctx.__Scanner.getWaitingCount() === 2, 'dua scan masuk saat overlay tampil');
    const badge = el.querySelector('.scan-overlay-waiting');
    assert(badge && badge.textContent === '+2 scan menunggu', 'badge harus "+2 scan menunggu"');
    ctx.__runOneTimer(); // timer A habis -> C (terbaru) tampil, B dilewat
    assertHas(el.innerHTML, 'Orta Dinanti');
    assert(!el.innerHTML.includes('Rio Andika'), 'B yang tertimpa tidak tampil');
    assert(ctx.__Scanner.getWaitingCount() === 0, 'hitungan menunggu reset setelah antrean tampil');
  });

  await test('tombol Tutup: dismiss menampilkan antrean berikutnya', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia'), emp('K0002', 'Rio Andika')],
    });
    await ctx.__Scanner.start();
    await ctx.__decode('K0001');
    await ctx.__decode('K0002');
    ctx.__Scanner.dismissResult();
    const el = ctx.document.getElementById('resultScan');
    assertHas(el.innerHTML, 'Rio Andika', 'dismiss harus memunculkan antrean');
    ctx.__Scanner.dismissResult();
    assert(el.innerHTML === '' && !el.className.includes('show'), 'overlay harus hilang setelah dismiss terakhir');
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

  console.log('== kiosk.js — Mode Kiosk-lite ==');

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

  console.log('\n' + passed + ' lulus, ' + failed + ' gagal');
  if (failures.length) console.log('Gagal:\n- ' + failures.join('\n- '));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
