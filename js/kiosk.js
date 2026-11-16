/* Mode Kiosk-lite (plan UX §4, versi prototipe — disederhanakan).
   Satu toggle di topbar: sembunyikan sidebar/menu + FAB Pengaturan Demo
   via CSS, dan minta fullscreen browser (setara F11).
   SENGAJA TIDAK ADA di prototipe ini: PIN keluar, Wake Lock, screensaver
   idle — keluar kiosk cukup lewat tombol yang sama di topbar (atau Esc
   untuk keluar fullscreen; CSS kiosk tetap aktif sampai tombol ditekan).
   Status tersimpan di localStorage 'kiosk_lite'; saat load, hanya CSS-nya
   yang diterapkan kembali — fullscreen tidak bisa diminta tanpa gesture. */
const Kiosk = (() => {
  const KEY = 'kiosk_lite';

  function isEnabled() {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  }

  function apply(on) {
    document.body.classList.toggle('kiosk-lite', on);
    const btn = document.getElementById('btnKioskToggle');
    if (btn) {
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? '⛶ Keluar Kiosk' : '⛶ Mode Kiosk';
    }
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* abaikan */ }
  }

  async function enable() {
    apply(true);
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch { /* fullscreen gagal (mis. izin): CSS kiosk tetap jalan */ }
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

  function init() {
    // Terapkan kembali CSS kiosk dari sesi sebelumnya; fullscreen tidak
    // diminta di sini karena butuh gesture pengguna.
    if (isEnabled()) apply(true);
  }

  return { toggle, enable, disable, isEnabled, init };
})();
