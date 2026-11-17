/* Mode Kiosk-lite (plan UX §4, versi prototipe — disederhanakan).
   Satu toggle di topbar: sembunyikan sidebar/menu + FAB Pengaturan Demo
   via CSS, dan minta fullscreen browser (setara F11).
   SENGAJA TIDAK ADA di prototipe ini: PIN keluar, Wake Lock, screensaver
   idle — keluar kiosk cukup lewat tombol yang sama di topbar (atau Esc
   untuk keluar fullscreen; CSS kiosk tetap aktif sampai tombol ditekan).
   Status tersimpan di localStorage 'kiosk_lite'; saat load, hanya CSS-nya
   yang diterapkan kembali — fullscreen tidak bisa diminta tanpa gesture.
   PERBAIKAN 17 Nov 2026 (bug scan gagal saat kiosk aktif): prompt izin
   kamera TIDAK BISA muncul saat halaman fullscreen (getUserMedia
   ditolak) — jadi enable() menjalankan kamera DULU baru fullscreen.
   Selain itu, saat layout berubah (masuk/keluar fullscreen) scanner
   di-restart supaya lebar video inline + qrbox 250x250 dihitung ulang
   (html5-qrcode membekukannya saat start, tanpa ResizeObserver). */
const Kiosk = (() => {
  const KEY = 'kiosk_lite';

  let fullscreenArmed = false;
  let fullscreenListenerBound = false;
  let restartingScanner = false;

  function isEnabled() {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  }

  function apply(on) {
    document.body.classList.toggle('kiosk-lite', on);
    const btn = document.getElementById('btnKioskToggle');
    if (btn) {
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
      const label = btn.querySelector ? btn.querySelector('.btn-label') : null;
      const text = on ? 'Keluar Kiosk' : 'Mode Kiosk';
      if (label) label.textContent = text;
      else btn.textContent = text;
    }
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* abaikan */ }
  }

  // Apakah elemen kamera terlihat (panel dashboard aktif / halaman scan).
  function scannerVisible() {
    const r = document.getElementById('reader');
    return !!r && r.offsetParent !== null;
  }

  // Kamera DULU, fullscreen belakangan. Bila kamera sudah jalan atau
  // tidak terlihat, langsung lanjut ke fullscreen.
  async function ensureCameraBeforeFullscreen() {
    try {
      if (typeof Scanner === 'undefined' || !Scanner) return false;
      // Kamera sengaja dimatikan user lewat tombol (flag manual-off di
      // main.js, dicerminkan ke body dataset) — jangan nyalakan lagi.
      const ds = document.body && document.body.dataset;
      if (ds && ds.cameraManualOff === '1') return false;
      if (typeof Scanner.isActive !== 'function' || Scanner.isActive()) return true;
      if (typeof Scanner.start !== 'function' || !scannerVisible()) return false;
      await Scanner.start();
      return Scanner.isActive();
    } catch { return false; }
  }

  async function requestFullscreenNow() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        return true;
      }
      return !!document.fullscreenElement;
    } catch { return false; }
  }

  // Bila fullscreen gagal (mis. gesture habis karena prompt izin
  // kamera), coba lagi pada gesture berikutnya (sekali saja).
  function armFullscreenOnNextGesture() {
    if (fullscreenArmed) return;
    fullscreenArmed = true;
    const once = async () => {
      fullscreenArmed = false;
      document.removeEventListener('pointerdown', once);
      document.removeEventListener('keydown', once);
      await requestFullscreenNow();
    };
    document.addEventListener('pointerdown', once);
    document.addEventListener('keydown', once);
  }

  async function enable() {
    apply(true);
    await ensureCameraBeforeFullscreen();
    const ok = await requestFullscreenNow();
    if (!ok) armFullscreenOnNextGesture();
  }

  async function disable() {
    apply(false);
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch { /* abaikan */ }
  }

  function toggle() {
    return isEnabled() ? disable() : enable();
  }

  // Restart scanner saat layout berubah (masuk/keluar fullscreen)
  // supaya video + qrbox dihitung ulang pada ukuran hero yang baru.
  async function restartScannerOnFullscreenChange() {
    if (restartingScanner) return;
    try {
      if (typeof Scanner === 'undefined' || !Scanner) return;
      if (typeof Scanner.isActive !== 'function' || !Scanner.isActive()) return;
      if (typeof Scanner.stop !== 'function' || typeof Scanner.start !== 'function') return;
      if (!scannerVisible()) return;
      restartingScanner = true;
      await Scanner.stop();
      await Scanner.start();
      // Terapkan lagi ukuran video 100% setelah restart (video baru
      // dari library kembali membeku pada lebar inline).
      if (typeof Scanner.fitVideoToHero === 'function') Scanner.fitVideoToHero();
    } catch { /* abaikan: kamera tetap jalan di ukuran lama */ }
    finally { restartingScanner = false; }
  }

  function init() {
    // Terapkan kembali CSS kiosk dari sesi sebelumnya; fullscreen tidak
    // diminta di sini karena butuh gesture pengguna.
    if (isEnabled()) apply(true);
    if (!fullscreenListenerBound && typeof document !== 'undefined' && document.addEventListener) {
      fullscreenListenerBound = true;
      document.addEventListener('fullscreenchange', restartScannerOnFullscreenChange);
    }
  }

  return { toggle, enable, disable, isEnabled, init, apply };
})();
