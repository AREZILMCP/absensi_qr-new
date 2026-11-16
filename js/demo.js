/* ------------------------------------------------------------
   MODE DEMO — untuk GitHub Pages / presentasi, tanpa server.
   Toggle di layar login: AKTIF = login + data jalan sepenuhnya
   di browser (localStorage), tanpa api.php / MySQL. NONAKTIF =
   perilaku normal: login & data lewat api.php + MySQL.
   Login tetap ada di kedua mode; di Mode Demo pakai akun demo.
   JANGAN dipakai operasional sungguhan: data demo hanya ada
   di browser ini dan tidak masuk database.
   ------------------------------------------------------------ */
const Demo = (() => {
  const FLAG_KEY = 'absensi_demo_mode';
  const DATA_KEY = 'absensi_demo_data_v2';

  const DEMO_USERNAME = 'demo';
  const DEMO_PASSWORD = 'demo123';

  function isEnabled() {
    try { return localStorage.getItem(FLAG_KEY) === '1'; } catch { return false; }
  }

  function setEnabled(on) {
    try { localStorage.setItem(FLAG_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  }

  // Akun demo (role admin → semua menu & aksi terbuka, lihat Akses.can).
  function demoUser() {
    return {
      id: 'demo',
      username: DEMO_USERNAME,
      name: 'Demo Admin',
      role: 'admin',
      permissions: {},
    };
  }

  function checkLogin(username, password) {
    if (String(username || '').trim() !== DEMO_USERNAME) return null;
    if (String(password || '') !== DEMO_PASSWORD) return null;
    return demoUser();
  }

  // Data awal demo: 4 karyawan non-shift Kelompok 1 (K0001 = Reza
  // Kurnia, sesuai PPT) + 2 jenis kartu dari database.sql.
  function seedSnapshot() {
    return {
      karyawan: [
        { id: 'K0001', nama: 'Reza Kurnia', kategori: 'Karyawan', posisi: 'Staff', bagian: 'Information Technology', status: 'Aktif', absen: false, makan: false },
        { id: 'K0002', nama: 'Muhammad Syechan Al Fariz', kategori: 'Karyawan', posisi: 'Staff', bagian: 'Non-Shift', status: 'Aktif', absen: false, makan: false },
        { id: 'K0003', nama: 'Rio Andika', kategori: 'Karyawan', posisi: 'Staff', bagian: 'Non-Shift', status: 'Aktif', absen: false, makan: false },
        { id: 'K0004', nama: 'Orta Dinanti', kategori: 'Karyawan', posisi: 'Staff', bagian: 'Non-Shift', status: 'Aktif', absen: false, makan: false },
      ],
      riwayat: [],
      jenisKartu: [
        { id: 'JK-01', nama: 'Kartu Karyawan', keterangan: 'Kartu untuk karyawan' },
        { id: 'JK-02', nama: 'Kartu Tamu', keterangan: 'Kartu untuk tamu' },
      ],
      reservasiManual: [],
      reservasiArchive: [],
      overtime: [],
      presensi: [],
    };
  }

  function loadSnapshot() {
    try {
      const raw = localStorage.getItem(DATA_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.karyawan)) return null;
      return data;
    } catch { return null; }
  }

  function saveSnapshot(snap) {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(snap)); } catch { /* ignore */ }
  }

  function ensureSeed() {
    const snap = loadSnapshot();
    if (snap) return snap;
    const seed = seedSnapshot();
    saveSnapshot(seed);
    return seed;
  }

  function clearData() {
    try { localStorage.removeItem(DATA_KEY); } catch { /* ignore */ }
  }

  /* ------------------------------------------------------------
     UI — toggle di layar login + badge di dalam aplikasi.
     ------------------------------------------------------------ */
  function syncUI() {
    const on = isEnabled();
    const toggle = document.getElementById('demoToggle');
    if (toggle) toggle.checked = on;
    const info = document.getElementById('demoInfo');
    if (info) info.hidden = !on;
    const badge = document.getElementById('demoBadge');
    if (badge) badge.hidden = !on;
    const modalToggle = document.getElementById('demoModalToggle');
    if (modalToggle) modalToggle.checked = on;
    const status = document.getElementById('demoModalStatus');
    if (status) {
      status.textContent = on
        ? 'AKTIF — login pakai demo / demo123, data tersimpan di browser ini saja (localStorage), tidak masuk database.'
        : 'NONAKTIF — login & data lewat server (api.php + MySQL).';
    }
  }

  function turnOnAndReload() {
    if (typeof Auth !== 'undefined') Auth.logout();
    if (typeof Storage !== 'undefined') Storage.invalidate();
    setEnabled(true);
    location.reload();
  }

  function turnOffAndReload() {
    if (typeof Auth !== 'undefined') Auth.logout();
    if (typeof Storage !== 'undefined') Storage.invalidate();
    setEnabled(false);
    clearData();
    location.reload();
  }

  function bindUI() {
    const toggle = document.getElementById('demoToggle');
    if (toggle) {
      toggle.addEventListener('change', async () => {
        const on = toggle.checked;
        if (!on && typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
          if (!(await Utils.confirmDialog('Matikan Mode Demo? Sesi demo ditutup dan kamu kembali ke login server.'))) {
            toggle.checked = true;
            syncUI();
            return;
          }
          turnOffAndReload();
          return;
        }
        setEnabled(on);
        syncUI();
      });
    }

    const badge = document.getElementById('demoBadge');
    if (badge) {
      badge.addEventListener('click', async () => {
        if (!(await Utils.confirmDialog('Matikan Mode Demo dan kembali ke login server?'))) return;
        turnOffAndReload();
      });
    }

    // Toggle Mode Demo di dalam modal Pengaturan Demo.
    const modalToggle = document.getElementById('demoModalToggle');
    if (modalToggle) {
      modalToggle.addEventListener('change', async () => {
        const on = modalToggle.checked;
        if (on) {
          if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
            if (!(await Utils.confirmDialog('Aktifkan Mode Demo? Sesi sekarang ditutup dan kamu kembali ke layar login untuk masuk sebagai demo / demo123.'))) {
              modalToggle.checked = false;
              syncUI();
              return;
            }
            turnOnAndReload();
            return;
          }
          setEnabled(true);
          syncUI();
          return;
        }
        if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
          if (!(await Utils.confirmDialog('Matikan Mode Demo? Sesi demo ditutup dan kamu kembali ke login server.'))) {
            modalToggle.checked = true;
            syncUI();
            return;
          }
          turnOffAndReload();
          return;
        }
        setEnabled(false);
        syncUI();
      });
    }

    syncUI();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', bindUI);
  }

  return {
    isEnabled,
    setEnabled,
    demoUser,
    checkLogin,
    seedSnapshot,
    loadSnapshot,
    saveSnapshot,
    ensureSeed,
    clearData,
    syncUI,
    turnOnAndReload,
    turnOffAndReload,
  };
})();
