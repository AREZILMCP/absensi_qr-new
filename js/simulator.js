/* ============================================================
   SIMULATOR — Mode Simulasi Waktu untuk demo / presentasi.
   Bukan untuk operasional sungguhan: jam sistem digeser lewat
   Utils.setSimulatedTime() (offset, tersimpan di localStorage),
   jadi scan 1-2-3-4 bisa didemokan dalam hitungan menit:
     08:05  scan 1 = absensi masuk
     12:00  scan 2 = kupon makan reguler
     15:55  scan 3 = ditolak, belum jam pulang (16:00)
     16:05  scan 3 = absensi pulang (tanpa lembur)
     18:05  scan 3 = absensi pulang + reset lembur
     18:10  scan 4 = kupon makan lembur (tambahan)
   Matikan simulasi ("Kembali ke realtime") sebelum dipakai
   operasional, dan pakai "Reset demo" untuk mengulang alur.
   ============================================================ */
const Simulator = (() => {
  let bound = false;
  let timer = null;

  const PRESETS = [
    { time: '07:55', label: '07:55 — sebelum masuk' },
    { time: '08:05', label: '08:05 — absen masuk' },
    { time: '12:00', label: '12:00 — kupon makan' },
    { time: '15:55', label: '15:55 — coba pulang (ditolak)' },
    { time: '16:05', label: '16:05 — pulang (tanpa lembur)' },
    { time: '18:05', label: '18:05 — pulang lembur (reset kupon)' },
    { time: '18:10', label: '18:10 — kupon lembur' },
  ];

  function render() {
    const clockEl = document.getElementById('simClock');
    const badgeEl = document.getElementById('simBadge');
    const cardEl = document.getElementById('simCard');
    if (!clockEl) return;
    const d = Utils.now();
    const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const tgl = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    clockEl.textContent = jam + ' • ' + tgl;
    const aktif = Utils.isSimulated();
    if (badgeEl) {
      badgeEl.textContent = aktif ? 'SIMULASI AKTIF' : 'REALTIME';
      badgeEl.className = 'sim-badge ' + (aktif ? 'sim-badge-on' : 'sim-badge-off');
    }
    if (cardEl) cardEl.classList.toggle('sim-active', aktif);
    // Strip ramping di dashboard: hanya tampil saat simulasi aktif.
    const stripEl = document.getElementById('simStrip');
    if (stripEl) stripEl.hidden = !aktif;
    const stripClockEl = document.getElementById('simStripClock');
    if (stripClockEl) stripClockEl.textContent = jam + ' • ' + tgl;
    // Titik merah di FAB saat simulasi atau Mode Demo aktif.
    const fabDot = document.getElementById('fabDot');
    if (fabDot) {
      const demoOn = typeof Demo !== 'undefined' && Demo.isEnabled();
      fabDot.hidden = !(aktif || demoOn);
    }
    const customEl = document.getElementById('simCustomTime');
    if (customEl && !customEl.value && aktif) {
      customEl.value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
  }

  function refreshDashboard() {
    try { if (typeof Dashboard !== 'undefined') Dashboard.render(); } catch { /* ignore */ }
  }

  async function setTime(hhmm) {
    try {
      Utils.setSimulatedTime(hhmm);
    } catch (err) {
      await Utils.alertDialog(err && err.message ? err.message : 'Jam tidak valid.');
      return;
    }
    render();
    refreshDashboard();
  }

  function backToRealtime() {
    Utils.clearSimulation();
    render();
    refreshDashboard();
  }

  async function resetDemo() {
    if (!(await Utils.confirmDialog('Reset demo hari ini?\n\nSemua absen, kupon, pulang, presensi, overtime, dan riwayat scan HARI INI (jam simulasi) akan dihapus supaya alur bisa diulang dari scan 1.\n\nData karyawan, foto, dan data hari lain TIDAK dihapus.'))) return;
    const today = Storage.resetDemoHariIni();
    render();
    refreshDashboard();
    try { if (typeof Karyawan !== 'undefined') Karyawan.render(); } catch { /* ignore */ }
    try { if (typeof Presensi !== 'undefined') Presensi.render(); } catch { /* ignore */ }
    await Utils.alertDialog('Demo hari ini (' + today + ') sudah direset. Silakan mulai lagi dari jam 08:05.');
  }

  function hitung() {
    const hasilEl = document.getElementById('simCalcHasil');
    if (!hasilEl) return;
    const masuk = document.getElementById('simCalcMasuk')?.value || '08:05';
    const pulang = document.getElementById('simCalcPulang')?.value || '18:05';
    const r = Utils.hitungLembur(masuk, pulang);
    if (r.error) { hasilEl.textContent = r.error; return; }
    const ya = (v) => (v ? 'Ya' : 'Tidak');
    hasilEl.innerHTML =
      '<ul>' +
      '<li>Total kerja: <strong>' + Utils.escapeHtml(r.totalText) + '</strong> (' + Utils.escapeHtml(r.masuk) + ' &ndash; ' + Utils.escapeHtml(r.pulang) + ')</li>' +
      '<li>Lembur setelah 16:00: <strong>' + Utils.escapeHtml(r.lemburText) + '</strong></li>' +
      '<li>Boleh pulang: <strong>' + ya(r.bolehPulang) + '</strong></li>' +
      '<li>Kupon reguler: <strong>' + ya(r.kuponReguler) + '</strong></li>' +
      '<li>Kupon lembur: <strong>' + ya(r.kuponLembur) + '</strong>' +
      (r.kuponLembur ? ' (' + Utils.escapeHtml(Utils.formatDurasi(r.kuponLemburMenit)) + ' setelah 18:00)' : '') + '</li>' +
      '</ul>' +
      '<div class="sim-verdict">' + Utils.escapeHtml(r.alasan) + '</div>';
  }

  function openSettings() {
    const m = document.getElementById('modalDemo');
    if (!m) return;
    m.hidden = false;
    document.body.classList.add('modal-open');
    render();
  }

  function closeSettings() {
    const m = document.getElementById('modalDemo');
    if (!m) return;
    m.hidden = true;
    const anyOpen = typeof document.querySelector === 'function'
      ? document.querySelector('.modal-overlay:not([hidden])')
      : null;
    if (!anyOpen) document.body.classList.remove('modal-open');
  }

  function init() {
    if (bound) { render(); return; }
    bound = true;
    document.querySelectorAll('[data-sim-time]').forEach((btn) => {
      btn.addEventListener('click', () => setTime(btn.dataset.simTime));
    });
    document.getElementById('btnSimSet')?.addEventListener('click', async () => {
      const v = document.getElementById('simCustomTime')?.value;
      if (!v) { await Utils.alertDialog('Isi jam dulu, contoh 09:30.'); return; }
      setTime(v);
    });
    document.getElementById('btnSimRealtime')?.addEventListener('click', backToRealtime);
    document.getElementById('btnSimResetDemo')?.addEventListener('click', resetDemo);
    document.getElementById('btnSimHitung')?.addEventListener('click', hitung);
    document.getElementById('simCalcMasuk')?.addEventListener('change', hitung);
    document.getElementById('simCalcPulang')?.addEventListener('change', hitung);
    document.querySelectorAll('[data-calc-pulang]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const el = document.getElementById('simCalcPulang');
        if (el) el.value = btn.dataset.calcPulang;
        hitung();
      });
    });
    document.getElementById('btnDemoFab')?.addEventListener('click', openSettings);
    document.getElementById('btnCloseModalDemo')?.addEventListener('click', closeSettings);
    document.getElementById('btnTutupModalDemo')?.addEventListener('click', closeSettings);
    document.getElementById('btnSimStripBuka')?.addEventListener('click', openSettings);
    document.getElementById('modalDemo')?.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'modalDemo') closeSettings();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const m = document.getElementById('modalDemo');
      if (m && !m.hidden) closeSettings();
    });
    hitung();
    if (!timer) timer = setInterval(render, 1000);
    render();
  }

  return { init, render, setTime, backToRealtime, resetDemo, hitung, PRESETS, openSettings, closeSettings };
})();
