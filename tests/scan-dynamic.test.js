/* Tes Node untuk aturan DINAMIS berbasis jam (17 Nov 2026) — matriks
   batas + fallback server.
   Menguji KODE ASLI js/scanner.js lewat vm dengan stub DOM/Utils/
   Storage/fetch — tanpa browser dan tanpa kamera.
   Batas yang diuji: check-in 07:55/08:00/08:01/08:15/08:16/08:30,
   checkout 15:59/16:00/16:01/17:00/18:05, jendela kantin
   11:59/12:00/12:30/13:00/13:01/17:30/17:59/18:00/18:05, lembur
   119 vs 120 menit untuk ekstra makan (diukur dari jam saat ini), dan jalur server-first
   (sukses / 401 / offline / respons invalid / Mode Demo / simulasi).
   Jalankan: node tests/scan-dynamic.test.js */
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

/* ---------- Stub DOM minimal (sama dengan scan-highlight.test.js) ---------- */
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
    this.offsetParent = {};
    this._listeners = {};
  }
  _syncClass() { this._className = [...this.classList.set].join(' '); }
  get className() { return this._className; }
  set className(v) {
    this._className = String(v || '');
    this.classList.set = new Set(this._className.split(/\s+/).filter(Boolean));
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = String(v || ''); }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  querySelector() { return null; }
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
  return {
    _els: els,
    body,
    documentElement: {},
    fullscreenElement: null,
    getElementById: (id) => get(id),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _map: m,
  };
}

/* ---------- Konteks scanner (dengan fetch opsional) ---------- */
function freshScannerCtx(opts) {
  const o = opts || {};
  const state = {
    now: new Date(2026, 10, 16, 8, 5, 0),
    kodeSeq: 0,
    karyawan: o.karyawan || [],
    riwayat: [],
    archive: [],
    presensi: [],
    dashboardRender: 0,
    karyawanRender: 0,
    timers: [],
    audioOsc: [],
    fetchCalls: [],
    fetchImpl: o.fetchImpl || null,
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
      constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
      resume() { return Promise.resolve(); }
      createOscillator() {
        const osc = { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
        state.audioOsc.push(osc);
        return osc;
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
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
      isSimulated: () => !!o.simulated,
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
    Demo: { isEnabled: () => !!o.demo },
  };
  // fetch hanya ada bila diuji (tanpa fetch -> jalur lokal).
  if (o.withFetch) {
    sandbox.fetch = async (url, init) => {
      state.fetchCalls.push({ url, init });
      if (state.fetchImpl) return state.fetchImpl(url, init);
      return { ok: false, status: 500, json: async () => ({}) };
    };
  }
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('js/scanner.js'), sandbox, { filename: 'scanner.js' });
  vm.runInContext('globalThis.__Scanner = Scanner;', sandbox);
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

// Karyawan standar: sudah check-in 08:05 (untuk uji pulang/kantin).
function sudahMasuk(patch) {
  return emp('K0001', 'Reza Kurnia', Object.assign({
    absen: true, absenAt: '2026-11-16T08:05:00',
  }, patch || {}));
}
// Karyawan standar: sudah check-in + sudah makan siang (ditebus).
function sudahMakan(patch) {
  return sudahMasuk(Object.assign({
    makan: true, makanAt: '2026-11-16T12:00:00',
    kuponKode: 'TR-2611-001', kuponStatus: 'ditebus', kuponJenis: 'reguler',
  }, patch || {}));
}

async function main() {
  console.log('== presensi — batas check-in ==');

  const batasMasuk = [
    [7, 55, true, 'Tepat waktu'],
    [8, 0, true, 'Tepat waktu'],
    [8, 1, true, 'Terlambat 1 menit'],
    [8, 15, true, 'Terlambat 15 menit'],
    [8, 16, false, 'DITOLAK'],
    [8, 30, false, 'DITOLAK'],
  ];
  for (const [h, m, tercatat, teks] of batasMasuk) {
    await test(`check-in ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} -> ${tercatat ? 'tercatat' : 'block'}`, async () => {
      const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
      ctx.__setNow(h, m);
      const el = await startAndScan(ctx, 'K0001');
      assertHas(el.innerHTML, teks);
      assert(ctx.__state.karyawan[0].absen === tercatat,
        `absen harus ${tercatat}, dapat ${ctx.__state.karyawan[0].absen}`);
      assert(ctx.__state.riwayat.length === (tercatat ? 1 : 0),
        'riwayat harus ' + (tercatat ? 1 : 0));
    });
  }

  console.log('== presensi — batas check-out ==');

  await test('15:59 sudah check-in -> BELUM JAM PULANG', async () => {
    const ctx = freshScannerCtx({ karyawan: [sudahMakan()] });
    ctx.__setNow(15, 59);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'BELUM JAM PULANG');
    assert(ctx.__state.karyawan[0].pulangAt === null, 'pulang tidak boleh tercatat');
  });

  await test('16:00 check-out -> ABSENSI PULANG, 0 lembur', async () => {
    const ctx = freshScannerCtx({ karyawan: [sudahMakan()] });
    ctx.__setNow(16, 0);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'ABSENSI PULANG');
    assert(!el.innerHTML.includes('Lembur'), '16:00 pas = 0 lembur');
  });

  await test('16:01 check-out -> "Lembur 1 menit"', async () => {
    const ctx = freshScannerCtx({ karyawan: [sudahMakan()] });
    ctx.__setNow(16, 1);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'Lembur 1 menit');
  });

  await test('16:00 belum check-in -> BELUM ABSEN MASUK', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    ctx.__setNow(16, 0);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'BELUM ABSEN MASUK');
    assert(ctx.__state.riwayat.length === 0, 'tidak boleh tercatat');
  });

  await test('14:00 belum check-in -> check-in tetap DITOLAK (lewat 08:15)', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    ctx.__setNow(14, 0);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'DITOLAK');
    assert(ctx.__state.karyawan[0].absen === false, 'tidak boleh tercatat');
  });

  console.log('== kantin — jendela makan siang ==');

  const batasMakan = [
    [11, 59, 'DI LUAR JAM MAKAN'],
    [12, 0, 'MAKAN SIANG'],
    [12, 30, 'MAKAN SIANG'],
    [13, 0, 'MAKAN SIANG'],
    [13, 1, 'DI LUAR JAM MAKAN'],
    [17, 30, 'DI LUAR JAM MAKAN'],
    [17, 59, 'DI LUAR JAM MAKAN'],
  ];
  for (const [h, m, teks] of batasMakan) {
    await test(`kantin ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} -> ${teks}`, async () => {
      const ctx = freshScannerCtx({ karyawan: [sudahMasuk()] });
      ctx.__setNow(h, m);
      ctx.__Scanner.setMode('kantin');
      const el = await startAndScan(ctx, 'K0001');
      assertHas(el.innerHTML, teks);
      const ok = teks === 'MAKAN SIANG';
      assert(ctx.__state.karyawan[0].makan === ok, 'makan harus ' + ok);
    });
  }

  await test('kantin 12:00 belum check-in -> BELUM ABSEN MASUK', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    ctx.__setNow(12, 0);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'BELUM ABSEN MASUK');
  });

  console.log('== kantin — ekstra makan (>= 18:00, tanpa syarat pulang) ==');

  await test('kantin 18:10 belum pulang (absen saja, kasus Reza) -> EKSTRA MAKAN', async () => {
    const ctx = freshScannerCtx({ karyawan: [sudahMasuk()] });
    ctx.__setNow(18, 10);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'EKSTRA MAKAN');
    assert(ctx.__state.karyawan[0].kuponJenis === 'lembur', 'kupon harus jenis lembur');
    assert(ctx.__state.riwayat[0].jenis === 'Ekstra Makan', 'riwayat Ekstra Makan tercatat');
  });

  await test('kantin 17:59 lembur 119 menit dari jam saat ini -> DI LUAR JAM MAKAN', async () => {
    const ctx = freshScannerCtx({ karyawan: [sudahMasuk()] });
    ctx.__setNow(17, 59);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'DI LUAR JAM MAKAN');
    assert(ctx.__state.karyawan[0].makan === false, 'makan tidak boleh tercatat');
  });

  await test('kantin 18:00 tepat lembur pas 120 menit, belum pulang -> EKSTRA MAKAN', async () => {
    const ctx = freshScannerCtx({ karyawan: [sudahMasuk()] });
    ctx.__setNow(18, 0);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'EKSTRA MAKAN');
    assert(ctx.__state.karyawan[0].kuponJenis === 'lembur', 'kupon harus jenis lembur');
  });

  await test('kantin 18:30 sudah pulang 17:00 -> EKSTRA MAKAN (jam sudah >= 18:00)', async () => {
    const ctx = freshScannerCtx({
      karyawan: [sudahMakan({ pulangAt: '2026-11-16T17:00:00' })],
    });
    ctx.__setNow(18, 30);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'EKSTRA MAKAN');
    assert(ctx.__state.karyawan[0].kuponJenis === 'lembur', 'kupon harus jenis lembur');
  });

  await test('kantin 18:30 sudah ekstra makan -> SUDAH EKSTRA MAKAN', async () => {
    const ctx = freshScannerCtx({
      karyawan: [sudahMakan({
        makan: true, makanAt: '2026-11-16T18:05:00',
        kuponKode: 'TR-2611-002', kuponStatus: 'ditebus', kuponJenis: 'lembur',
      })],
    });
    ctx.__setNow(18, 30);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'SUDAH EKSTRA MAKAN');
  });

  await test('kantin 18:30 belum check-in -> BELUM ABSEN MASUK', async () => {
    const ctx = freshScannerCtx({ karyawan: [emp('K0001', 'Reza Kurnia')] });
    ctx.__setNow(18, 30);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'BELUM ABSEN MASUK');
  });

  console.log('== server-first + fallback lokal ==');

  await test('server sukses masuk: fetch POST api.php?action=scan, overlay ABSENSI MASUK', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia')],
      withFetch: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            type: 'ok', aksi: 'masuk',
            message: 'Absensi masuk berhasil dicatat',
            karyawan: {
              id: 'K0001', nama: 'Reza Kurnia', absen: true,
              absenAt: '2026-11-16T08:05:00',
            },
            riwayatJenis: 'Absensi', riwayatTambahan: null,
            lembur: false, nowIso: '2026-11-16T08:05:00', waktuServer: '08:05:00',
          },
        }),
      }),
    });
    ctx.__setNow(8, 5);
    const el = await startAndScan(ctx, 'K0001');
    assert(ctx.__state.fetchCalls.length === 1, 'fetch harus dipanggil 1x');
    const call = ctx.__state.fetchCalls[0];
    assert(call.url === 'api.php?action=scan', 'URL harus api.php?action=scan');
    assert(call.init.method === 'POST', 'method harus POST');
    const body = JSON.parse(call.init.body);
    assert(body.kode === 'K0001' && body.mode === 'presensi', 'body harus {kode, mode}');
    assertHas(el.innerHTML, 'ABSENSI MASUK');
    assert(ctx.__state.riwayat.length === 1 && ctx.__state.riwayat[0].jenis === 'Absensi',
      'riwayat server harus tercatat 1x (tidak ganda)');
    assert(ctx.__state.presensi.length === 1, 'presensi server harus tercatat 1x');
    assert(ctx.__state.karyawan[0].absen === true, 'baris server harus digabung ke data lokal');
  });

  await test('server sukses kantin makan siang: overlay MAKAN SIANG + kode server', async () => {
    const ctx = freshScannerCtx({
      karyawan: [sudahMasuk()],
      withFetch: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            type: 'ok', aksi: 'makan-siang',
            message: 'Makan siang berhasil — kupon otomatis terbit, silakan ambil makanan',
            karyawan: {
              id: 'K0001', nama: 'Reza Kurnia',
              makan: true, makanAt: '2026-11-16T12:00:00',
              kuponKode: 'TR-2611-007', kuponStatus: 'ditebus', kuponJenis: 'reguler',
            },
            riwayatJenis: 'Makan Siang', riwayatTambahan: null,
            lembur: false, nowIso: '2026-11-16T12:00:00', waktuServer: '12:00:00',
          },
        }),
      }),
    });
    ctx.__setNow(12, 0);
    ctx.__Scanner.setMode('kantin');
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'MAKAN SIANG');
    assertHas(el.innerHTML, 'TR-2611-007');
  });

  await test('server 401 -> fallback lokal (masuk tetap tercatat)', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia')],
      withFetch: true,
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    });
    ctx.__setNow(8, 5);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'ABSENSI MASUK');
    assert(ctx.__state.karyawan[0].absen === true, 'fallback lokal harus mencatat masuk');
    assert(ctx.__state.riwayat.length === 1, 'riwayat lokal harus tercatat 1x');
  });

  await test('server offline (fetch reject) -> fallback lokal', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia')],
      withFetch: true,
      fetchImpl: async () => { throw new Error('jaringan putus'); },
    });
    ctx.__setNow(8, 5);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'ABSENSI MASUK');
    assert(ctx.__state.karyawan[0].absen === true, 'fallback lokal harus mencatat masuk');
  });

  await test('server respons invalid (ok:false) -> fallback lokal', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia')],
      withFetch: true,
      fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false }) }),
    });
    ctx.__setNow(8, 5);
    const el = await startAndScan(ctx, 'K0001');
    assertHas(el.innerHTML, 'ABSENSI MASUK');
    assert(ctx.__state.karyawan[0].absen === true, 'fallback lokal harus mencatat masuk');
  });

  await test('Mode Demo: fetch TIDAK dipanggil, jalur lokal', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia')],
      withFetch: true,
      demo: true,
      fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: {} }) }),
    });
    ctx.__setNow(8, 5);
    const el = await startAndScan(ctx, 'K0001');
    assert(ctx.__state.fetchCalls.length === 0, 'Mode Demo tidak boleh fetch');
    assertHas(el.innerHTML, 'ABSENSI MASUK');
  });

  await test('Simulasi aktif: fetch TIDAK dipanggil, jalur lokal', async () => {
    const ctx = freshScannerCtx({
      karyawan: [emp('K0001', 'Reza Kurnia')],
      withFetch: true,
      simulated: true,
      fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: {} }) }),
    });
    ctx.__setNow(8, 5);
    const el = await startAndScan(ctx, 'K0001');
    assert(ctx.__state.fetchCalls.length === 0, 'simulasi tidak boleh fetch');
    assertHas(el.innerHTML, 'ABSENSI MASUK');
  });

  console.log('\n' + passed + ' lulus, ' + failed + ' gagal');
  if (failures.length) console.log('Gagal:\n- ' + failures.join('\n- '));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
