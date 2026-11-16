/* Halaman scan khusus (17 Nov 2026) — PC standby di pintu masuk /
   kantin, alur walk-past, NOL interaksi.
   - Mode dari URL ?mode=presensi (default) | ?mode=kantin, dikunci
     per device (bookmark sekali). Tanpa mode switch / tombol Start-Stop.
   - Kamera auto-start saat load (cek login dulu; bila belum login dan
     bukan Mode Demo -> kembali ke index.html). Scan jalan terus.
   - Overlay gate memakai #resultScan yang sama dengan dashboard
     (Scanner.showEmployee/showSimple), hanya CSS-nya yang memenuhi
     layar di halaman ini. Auto-hilang 1 detik, scan baru langsung
     menggantikan (tanpa antrean).
   - Baris "Terakhir" menetap lewat Scanner.setResultHook.
   - Jam realtime besar HH:MM:SS + tanggal Indonesia, berdetak 1 detik.
   - Kiosk-lite aktif by default (CSS); fullscreen diminta pada gesture
     pertama (pointerdown/keydown, sekali) SETELAH kamera jalan —
     jangan pernah minta izin kamera saat fullscreen. */
const ScanPage = (() => {
  let mode = 'presensi';
  let clockTimer = null;
  let fullscreenArmed = false;

  function parseMode() {
    try {
      const m = new URLSearchParams(window.location.search).get('mode');
      return m === 'kantin' ? 'kantin' : 'presensi';
    } catch { return 'presensi'; }
  }

  function formatClock(d) {
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function formatDate(d) {
    try {
      return d.toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
    } catch { return d.toDateString(); }
  }

  function tickClock() {
    const t = document.getElementById('scanClockTime');
    const dt = document.getElementById('scanClockDate');
    const now = Utils.now();
    if (t) t.textContent = formatClock(now);
    if (dt) dt.textContent = formatDate(now);
  }

  function setLast(item) {
    const el = document.getElementById('scanLast');
    if (!el) return;
    const when = formatClock(Utils.now());
    if (item && item.headline) {
      el.textContent = 'Terakhir ' + when + ' · ' + item.headline +
        (item.name ? ' — ' + item.name : '');
    } else if (item && item.message) {
      el.textContent = 'Terakhir ' + when + ' · ' + item.message;
    }
  }

  // Fullscreen hanya pada gesture pertama, dan hanya bila kamera sudah
  // jalan (izin kamera sudah diberikan di luar fullscreen).
  function armFullscreenOnFirstGesture() {
    if (fullscreenArmed) return;
    fullscreenArmed = true;
    const once = async () => {
      document.removeEventListener('pointerdown', once);
      document.removeEventListener('keydown', once);
      try {
        if (typeof Scanner !== 'undefined' && Scanner.isActive &&
            Scanner.isActive() && !document.fullscreenElement &&
            document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch { /* abaikan: fullscreen opsional */ }
    };
    document.addEventListener('pointerdown', once);
    document.addEventListener('keydown', once);
  }

  async function init() {
    mode = parseMode();

    const label = document.getElementById('scanModeLabel');
    if (label) label.textContent = mode === 'kantin' ? 'KANTIN' : 'PRESENSI';
    document.title = (mode === 'kantin' ? 'Scan Kantin' : 'Scan Presensi') +
      ' — Absensi & Kupon Makan';

    // Cek login dulu; Mode Demo (demo/demo123) juga lolos lewat
    // Auth.isLoggedIn().
    try {
      if (typeof Auth !== 'undefined' && !Auth.isLoggedIn() &&
          !(typeof Demo !== 'undefined' && Demo.isEnabled())) {
        window.location.href = 'index.html';
        return;
      }
    } catch { /* lanjut: halaman scan tetap mencoba jalan */ }

    try { Storage.init(); } catch { /* abaikan */ }
    try { if (typeof Kiosk !== 'undefined') { Kiosk.init(); Kiosk.apply(true); } } catch { /* abaikan */ }

    Scanner.setMode(mode);
    Scanner.setResultHook(setLast);

    tickClock();
    clockTimer = setInterval(tickClock, 1000);

    // Kamera auto-start; fullscreen menyusul pada gesture pertama.
    try { await Scanner.start(); } catch { /* banner error ditangani Scanner */ }
    armFullscreenOnFirstGesture();
  }

  return { init, getMode: () => mode };
})();

document.addEventListener('DOMContentLoaded', () => { ScanPage.init(); });
