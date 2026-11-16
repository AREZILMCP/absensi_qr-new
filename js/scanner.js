const Scanner = (() => {
  const { escapeHtml } = Utils;

  /* ------------------------------------------------------------
     [1] KONSTANTA & STATE
     ------------------------------------------------------------ */
  const COOLDOWN_MS = 2000;
  // Durasi overlay hasil scan per tipe (ms) — plan UX §3.1.
  // Sukses singkat (antrean jalan terus), peringatan lebih lama,
  // gagal paling lama supaya alasannya sempat dibaca.
  const RESULT_TIMEOUTS = { ok: 3000, warn: 4000, err: 5000 };

  const TARGET_ID = 'reader';
  const RESULT_ID = 'resultScan';

  // Bunyi beep: default AKTIF (disimpan di localStorage 'scan_sound').
  // Dipilih ON karena skenario utama adalah PC standby di meja admin —
  // admin/karyawan harus dengar hasil scan tanpa menatap layar terus.
  // Matikan lewat tombol suara di topbar.
  const SOUND_KEY = 'scan_sound';

  let html5QrCode = null;
  let isScanning = false;
  let lastScan = { text: null, time: 0 };
  let resultTimer = null;

  // Overlay hasil scan (plan UX §3.4 — antrean): hanya satu overlay
  // yang tampil; scan berikutnya masuk antrean (maks. 1 slot, yang
  // terbaru menggantikan yang lama) dan ditampilkan setelah overlay
  // sekarang selesai. waitingCount = jumlah scan yang masuk saat
  // overlay tampil (dipakai badge "n scan menunggu").
  let overlayBusy = false;
  let queuedResult = null;
  let waitingCount = 0;
  let closeBound = false;

  let soundEnabled = true;
  try { soundEnabled = localStorage.getItem(SOUND_KEY) !== '0'; } catch { /* abaikan */ }
  let audioCtx = null;

  // Mode scan: 'presensi' (alur 1-4) atau 'kantin' (tebus kupon terbit).
  // Default presensi; diganti lewat tombol mode di hero dashboard.
  let mode = 'presensi';

  const MODE_TEXT = {
    presensi: {
      title: 'Scan QR Karyawan',
      desc: 'Scan pertama mencatat <strong>absensi</strong>, scan berikutnya mencatat pengambilan <strong>kupon makan</strong>.',
      hint: 'Scan 1 masuk · Scan 2 kupon makan · Scan 3 pulang · Scan 4 kupon lembur',
    },
    kantin: {
      title: 'Scan Kantin — Tebus Kupon',
      desc: 'Scan QR karyawan untuk menebus kupon makan yang sudah <strong>terbit</strong> hari ini. Satu kupon hanya berlaku 1×.',
      hint: 'Kupon terbit di scan presensi ke-2 (reguler) atau ke-4 (lembur) · tanpa kupon aktif, scan ditolak',
    },
  };

  function setMode(m) {
    if (m !== 'kantin' && m !== 'presensi') return;
    mode = m;
    const t = MODE_TEXT[m];
    const titleEl = document.getElementById('scanTitle');
    if (titleEl) titleEl.textContent = t.title;
    const descEl = document.getElementById('scanDesc');
    if (descEl) descEl.innerHTML = t.desc;
    const hintEl = document.getElementById('heroHint');
    if (hintEl) hintEl.textContent = t.hint;
    document.querySelectorAll('[data-scan-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.scanMode === m);
    });
  }

  /* ------------------------------------------------------------
     [2] LIFECYCLE — start / stop kamera
     ------------------------------------------------------------ */
  async function start() {
    if (isScanning) {
      await stop();
      await delay(300);
    }

    if (typeof Html5Qrcode === 'undefined') {
      showSimple('Library scanner belum dimuat. Cek koneksi internet.', 'err');
      return;
    }

    if (!document.getElementById(TARGET_ID)) return;

    html5QrCode = new Html5Qrcode(TARGET_ID);
    lastScan = { text: null, time: 0 };

    try {
      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => handleScan(decodedText),
        () => {}
      );
      isScanning = true;
    } catch (err) {
      console.error('Scanner: gagal start', err);
      showSimple('Gagal mengakses kamera. Pastikan izin kamera aktif.', 'err');
      html5QrCode = null;
      isScanning = false;
    }
  }

  async function stop() {
    if (!html5QrCode) {
      isScanning = false;
      return;
    }
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch {
      /* ignore */
    } finally {
      html5QrCode = null;
      isScanning = false;
    }
  }

  /* ------------------------------------------------------------
     [3] HELPER — deteksi tanggal lokal (YYYY-MM-DD, tanpa UTC)
     ------------------------------------------------------------ */
  function todayLocalISO() { return Utils.todayLocalISO(); }

  function hasManualToday(karyawanId) {
    if (!karyawanId) return false;
    const today = todayLocalISO();
    return Storage.getReservasiManual().some((r) => {
      if (r.karyawanId !== karyawanId) return false;
      return Utils.toLocalISODate(r.tanggal || r.createdAt) === today;
    });
  }

  /* ------------------------------------------------------------
     [4.a] SCAN VIA SERVER (Fase 2) — validasi jam & state di server
     Dipakai hanya bila mode server (bukan Mode Demo, bukan simulasi).
     Bila server tidak terjangkau / sesi habis / respons tidak valid,
     kembalikan false supaya handleScan jatuh ke logika lokal.
     ------------------------------------------------------------ */
  function shouldUseServer() {
    if (typeof fetch !== 'function') return false;
    if (typeof Utils !== 'undefined' && Utils.isSimulated && Utils.isSimulated()) return false;
    if (typeof Demo !== 'undefined' && Demo.isEnabled && Demo.isEnabled()) return false;
    return true;
  }

  async function tryServerScan(text) {
    try {
      const res = await fetch('api.php?action=scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kode: text, mode }),
        cache: 'no-store',
      });
      if (!res.ok) return false; // 401/404/500 -> fallback lokal
      const data = await res.json();
      if (!data || !data.ok || !data.result) return false;
      applyServerResult(data);
      return true;
    } catch {
      return false; // offline / gagal parse -> fallback lokal
    }
  }

  function applyServerResult(data) {
    const r = data.result;
    const row = r.karyawan || null;
    let k = row ? Karyawan.cari(row.id) : null;
    if (row && k) {
      // Gabungkan baris server (camelCase) ke objek lokal.
      Object.assign(k, row);
    } else if (row) {
      k = row; // karyawan belum ada di data lokal (mis. baru ditambah di server)
    }
    if (k) {
      if (r.riwayatJenis) {
        try { Storage.addRiwayat(k.nama, r.riwayatJenis); } catch { /* abaikan */ }
      }
      if (r.riwayatTambahan) {
        try { Storage.addRiwayat(k.nama, r.riwayatTambahan); } catch { /* abaikan */ }
      }
      if (r.aksi === 'masuk') {
        try { Storage.catatPresensiMasuk(k, r.nowIso); } catch { /* abaikan */ }
      }
      if (r.aksi === 'pulang') {
        try { Storage.catatPresensiPulang(k, r.nowIso, !!r.lembur); } catch { /* abaikan */ }
      }
      try { Storage.save(); } catch { /* abaikan */ }
      showEmployee(k, r.type, r.message, r.waktuServer);
    } else {
      showSimple(r.message, r.type === 'ok' ? 'ok' : r.type);
    }
  }

  function refreshAfterScan() {
    Karyawan.render();
    if (typeof Dashboard !== 'undefined') Dashboard.render();

    if (
      typeof Reservasi !== 'undefined' &&
      document.getElementById('panel-reservasi')?.classList.contains('active')
    ) {
      Reservasi.render();
    }
    if (
      typeof ReservasiOvertime !== 'undefined' &&
      document.getElementById('panel-reservasi-overtime')?.classList.contains('active')
    ) {
      ReservasiOvertime.render();
    }
    if (
      typeof ReleaseReservasi !== 'undefined' &&
      document.getElementById('panel-release-reservasi')?.classList.contains('active')
    ) {
      ReleaseReservasi.render();
    }
  }

  /* ------------------------------------------------------------
     [4] HANDLE SCAN — inti logika absensi & kupon
     ------------------------------------------------------------ */
  async function handleScan(text) {
    if (!isScanning) return;

    // Anti-duplikat: cooldown per teks QR
    const now = Date.now(); // jam asli: anti-duplikat 2 detik, bukan jam simulasi
    if (lastScan.text === text && now - lastScan.time < COOLDOWN_MS) return;
    lastScan = { text, time: now };

    // Fase 2: validasi dari server bila mode server (bukan Mode Demo,
    // bukan simulasi). Bila server tidak terjangkau / sesi habis,
    // jatuh ke logika lokal di bawah — scan tetap jalan.
    if (shouldUseServer()) {
      try {
        if (await tryServerScan(text)) {
          refreshAfterScan();
          return;
        }
      } catch (err) {
        console.warn('Scanner: server scan gagal, fallback lokal', err);
      }
    }

    const karyawan = Karyawan.cari(text);
    if (!karyawan) {
      showSimple(`QR tidak dikenali: ${text}`, 'err');
      return;
    }

    // Karyawan non-aktif ditolak
    if (Utils.isKaryawanNonAktif(karyawan)) {
      showEmployee(
        karyawan,
        'err',
        'Karyawan Non-Aktif — absensi & kupon ditolak'
      );
      return;
    }

    // Bersihkan makan kemarin
    const archived = Storage.archiveStaleMeal(karyawan);
    if (archived) Storage.save();

    const nowIso = Utils.nowIso();
    const absenToday = Utils.isToday(karyawan.absenAt);
    const makanToday = Utils.isToday(karyawan.makanAt);
    const pulangToday = Utils.isToday(karyawan.pulangAt);
    const manualToday = hasManualToday(karyawan.id);
    const kuponToday = makanToday || manualToday;

    // --- MODE KANTIN: tebus kupon yang sudah terbit (B7) ---
    if (mode === 'kantin') {
      handleKantin(karyawan, nowIso, makanToday);
    }
    // --- STATE 1: belum absen hari ini → catat ABSENSI MASUK ---
    else if (!absenToday) {
      karyawan.absen = true;
      karyawan.absenAt = nowIso;
      delete karyawan.pulangAt;
      Storage.addRiwayat(karyawan.nama, 'Absensi');
      Storage.catatPresensiMasuk(karyawan, nowIso);
      Storage.save();
      showEmployee(karyawan, 'ok', 'Absensi masuk berhasil dicatat');
    }
    // --- STATE 2: belum punya kupon hari ini → TERBITKAN KUPON MAKAN ---
    else if (!kuponToday) {
      karyawan.makan = true;
      karyawan.makanAt = nowIso;
      karyawan.kuponKode = Utils.nextKodeTransaksi();
      karyawan.kuponReleased = true;
      karyawan.kuponReleasedAt = nowIso;
      karyawan.kuponStatus = 'terbit';
      karyawan.kuponJenis = pulangToday ? 'lembur' : 'reguler';
      delete karyawan.kuponDitebusAt;
      Storage.addRiwayat(karyawan.nama, 'Kupon Makan');
      Storage.save();
      showEmployee(
        karyawan,
        'ok',
        pulangToday
          ? 'Kupon Makan lembur (tambahan) berhasil diterbitkan — tebus di kantin'
          : 'Kupon Makan berhasil diterbitkan — tebus di kantin'
      );
    }
    // --- STATE 3: sudah absen & punya kupon, belum pulang ---
    else if (!pulangToday) {
      if (!Utils.isSudahJamPulang()) {
        showEmployee(
          karyawan,
          'warn',
          makanToday
            ? `Sudah absen & kupon makan sudah terbit. Absen pulang mulai ${Utils.formatJamPulang()}`
            : 'Kupon makan hari ini sudah tercatat via reservasi manual'
        );
        return;
      }

      // Catat ABSENSI PULANG
      karyawan.pulangAt = nowIso;
      Storage.addRiwayat(karyawan.nama, 'Absensi Pulang');

      let msg = 'Absensi pulang berhasil dicatat';
      if (Utils.isLembur()) {
        const direset = Storage.autoResetLembur(karyawan);
        if (direset) {
          Storage.addRiwayat(karyawan.nama, 'Lembur - Kupon Direset');
          msg = 'Absensi pulang dicatat — LEMBUR: kupon makan direset, 1× kupon tambahan tersedia';
        } else {
          msg = 'Absensi pulang dicatat (lembur hari ini sudah pernah direset)';
        }
      }
      Storage.catatPresensiPulang(karyawan, nowIso, Utils.isLembur());
      Storage.save();
      showEmployee(karyawan, 'ok', msg);
    }
    // --- STATE 4: sudah absen pulang ---
    else {
      showEmployee(
        karyawan,
        'warn',
        karyawan.kuponStatus === 'ditebus'
          ? 'Sudah absen pulang & kupon makan hari ini sudah ditebus'
          : 'Sudah absen pulang — kupon makan masih bisa ditebus di kantin'
      );
    }

    refreshAfterScan();
  }

  /* ------------------------------------------------------------
     [4.b] MODE KANTIN — tebus kupon terbit (B7)
     Kupon dari reservasi manual TIDAK ditebus di sini; jalurnya
     tetap lewat menu Release Reservasi.
     ------------------------------------------------------------ */
  function handleKantin(karyawan, nowIso, makanToday) {
    if (!makanToday) {
      showEmployee(
        karyawan,
        'warn',
        'Tidak ada kupon makan aktif hari ini — kupon belum diterbitkan (scan presensi dulu)'
      );
      return;
    }
    if (karyawan.kuponStatus === 'ditebus') {
      const d = new Date(karyawan.kuponDitebusAt);
      const jam = Number.isNaN(d.getTime())
        ? ''
        : ` pukul ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
      showEmployee(
        karyawan,
        'warn',
        `Kupon makan sudah ditebus${jam} — 1 kupon hanya berlaku 1×`
      );
      return;
    }
    const jenis = karyawan.kuponJenis === 'lembur' ? 'lembur' : 'reguler';
    karyawan.kuponStatus = 'ditebus';
    karyawan.kuponDitebusAt = nowIso;
    Storage.addRiwayat(karyawan.nama, 'Tebus Kupon');
    Storage.save();
    showEmployee(karyawan, 'ok', `Kupon makan ${jenis} berhasil ditebus di kantin`);
  }

  /* ------------------------------------------------------------
     [5] TAMPILAN HASIL — overlay memenuhi hero (plan UX §3)
     showSimple/showEmployee HANYA membangun isi hasil, lalu
     displayResult() yang memutuskan: tampil sekarang atau antre.
     Logika scan (state 1-4, kantin, validasi) TIDAK diubah di sini.
     ------------------------------------------------------------ */

  // Judul besar dari pesan hasil — satu pesan dominan per overlay.
  function headlineFor(message, type) {
    const m = String(message || '');
    // Urutan penting: penolakan dicek dulu — pesan "kupon belum
    // diterbitkan" mengandung kata "diterbitkan" dan akan salah
    // tertangkap pola KUPON TERBIT kalau dicek belakangan.
    if (/Karyawan Non-Aktif/i.test(m)) return 'DITOLAK';
    if (/QR tidak dikenali/i.test(m)) return 'QR TIDAK DIKENALI';
    if (/Tidak ada kupon/i.test(m)) return 'TIDAK ADA KUPON';
    if (/Kupon makan sudah ditebus/i.test(m)) return 'SUDAH DITEBUS';
    if (/Kupon makan .* berhasil ditebus/i.test(m)) return 'KUPON DITEBUS';
    if (/Kupon Makan lembur .* diterbitkan/i.test(m)) return 'KUPON LEMBUR TERBIT';
    if (/Kupon Makan .* diterbitkan/i.test(m)) return 'KUPON MAKAN TERBIT';
    if (/Absensi pulang/i.test(m)) return 'ABSENSI PULANG';
    if (/Absensi masuk/i.test(m)) return 'ABSENSI MASUK';
    if (/Sudah absen/i.test(m)) return 'SUDAH TERCATAT';
    if (/Gagal mengakses kamera|Library scanner/i.test(m)) return 'KAMERA BERMASALAH';
    return type === 'ok' ? 'BERHASIL' : type === 'warn' ? 'PERHATIAN' : 'GAGAL';
  }

  // Baris detail di bawah nama: jam + tepat waktu/terlambat (masuk)
  // atau catatan lembur (pulang). Selain itu tampilkan jam saja.
  function detailFor(k, headline, message, timeStr) {
    const jam = timeStr || Utils.now().toLocaleTimeString('id-ID');
    if (headline === 'ABSENSI MASUK' && k.absenAt) {
      const d = new Date(k.absenAt);
      if (!Number.isNaN(d.getTime())) {
        const telat = d.getHours() * 60 + d.getMinutes() - 8 * 60;
        return 'Masuk ' + jam + ' • ' + (telat > 0 ? 'Terlambat ' + telat + ' menit' : 'Tepat waktu');
      }
    }
    if (headline === 'ABSENSI PULANG') {
      return /LEMBUR/.test(message)
        ? 'Pulang ' + jam + ' • Lembur — kupon reguler direset'
        : 'Pulang ' + jam;
    }
    return jam;
  }

  // Kode kupon ditampilkan besar hanya saat kupon terbit/ditebus.
  // (Sebelumnya kuponKode diisi di state 2 tapi tidak pernah tampil.)
  function kuponCodeFor(k, headline) {
    if (!k.kuponKode) return '';
    if (headline !== 'KUPON MAKAN TERBIT' && headline !== 'KUPON LEMBUR TERBIT' && headline !== 'KUPON DITEBUS') return '';
    return k.kuponKode;
  }

  function photoHtmlFor(k) {
    return k.foto
      ? `<img src="${escapeHtml(k.foto)}" alt="${escapeHtml(k.nama)}">`
      : `<span class="scan-photo-initial">${escapeHtml((k.nama || '?').charAt(0).toUpperCase())}</span>`;
  }

  function buildEmployeeItem(k, type, message, timeStr) {
    const headline = headlineFor(message, type);
    const icon = type === 'ok' ? '✓' : type === 'warn' ? '!' : '✕';
    const kode = kuponCodeFor(k, headline);
    const kodeHtml = kode
      ? `<div class="scan-overlay-kupon"><span class="scan-overlay-kupon-lbl">Kode kupon</span><span class="scan-overlay-kupon-kode">${escapeHtml(kode)}</span></div>`
      : '';
    const noteHtml = (headline === 'KUPON MAKAN TERBIT' || headline === 'KUPON LEMBUR TERBIT')
      ? '<div class="scan-overlay-note">Tebus di kantin — 1 kupon hanya berlaku 1×</div>'
      : '';
    const html = `
      <div class="scan-overlay-inner scan-overlay-${type}">
        <div class="scan-overlay-icon" aria-hidden="true">${icon}</div>
        <div class="scan-overlay-info">
          <div class="scan-overlay-headline">${escapeHtml(headline)}</div>
          <div class="scan-overlay-name">${escapeHtml(k.nama)}</div>
          <div class="scan-overlay-meta"><span>${escapeHtml(k.id)}</span><span class="scan-meta-dot">•</span><span>${escapeHtml(k.kategori || '-')}</span></div>
          <div class="scan-overlay-detail">${escapeHtml(detailFor(k, headline, message, timeStr))}</div>
          ${kodeHtml}${noteHtml}
        </div>
        <div class="scan-overlay-photo">${photoHtmlFor(k)}</div>
        <button type="button" class="scan-overlay-close" aria-label="Tutup hasil scan">✕</button>
        <div class="scan-overlay-waiting" hidden></div>
      </div>`;
    return { html, type };
  }

  function buildSimpleItem(msg, type) {
    const headline = headlineFor(msg, type);
    const icon = type === 'ok' ? '✓' : type === 'warn' ? '!' : '✕';
    const html = `
      <div class="scan-overlay-inner scan-overlay-${type}">
        <div class="scan-overlay-icon" aria-hidden="true">${icon}</div>
        <div class="scan-overlay-info">
          <div class="scan-overlay-headline">${escapeHtml(headline)}</div>
          <div class="scan-overlay-detail">${escapeHtml(msg)}</div>
        </div>
        <button type="button" class="scan-overlay-close" aria-label="Tutup hasil scan">✕</button>
        <div class="scan-overlay-waiting" hidden></div>
      </div>`;
    return { html, type };
  }

  // Bunyi beep via Web Audio (tanpa file eksternal). Gagal diam-diam:
  // bunyi itu pelengkap, status tetap jelas dari warna + ikon + kata.
  function beep(type) {
    if (!soundEnabled) return;
    try {
      if (typeof AudioContext === 'undefined') return;
      audioCtx = audioCtx || new AudioContext();
      if (audioCtx.state === 'suspended' && audioCtx.resume) {
        audioCtx.resume().catch(() => {});
      }
      const notes = type === 'ok'
        ? [[880, 0, 0.12]]
        : type === 'warn' ? [[660, 0, 0.09], [660, 0.13, 0.09]] : [[220, 0, 0.25]];
      notes.forEach(([freq, delay, dur]) => {
        const t0 = audioCtx.currentTime + delay;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      });
    } catch { /* abaikan: bunyi opsional */ }
  }

  function setSoundEnabled(on) {
    soundEnabled = !!on;
    try { localStorage.setItem(SOUND_KEY, soundEnabled ? '1' : '0'); } catch { /* abaikan */ }
  }

  // Badge "n scan menunggu" pada overlay yang sedang tampil.
  function updateWaitingBadge() {
    const el = document.getElementById(RESULT_ID);
    if (!el) return;
    const badge = el.querySelector('.scan-overlay-waiting');
    if (!badge) return;
    if (waitingCount > 0) {
      badge.hidden = false;
      badge.textContent = '+' + waitingCount + ' scan menunggu';
    } else {
      badge.hidden = true;
      badge.textContent = '';
    }
  }

  function displayResult(item) {
    if (overlayBusy) {
      // Antrean maks. 1 slot: yang terbaru menggantikan yang lama.
      queuedResult = item;
      waitingCount += 1;
      updateWaitingBadge();
      return;
    }
    showOverlay(item);
  }

  function showOverlay(item) {
    const el = document.getElementById(RESULT_ID);
    if (!el) return;
    bindCloseOnce(el);
    overlayBusy = true;
    el.innerHTML = item.html;
    el.className = 'result show scan-overlay scan-overlay-' + item.type;
    updateWaitingBadge();
    beep(item.type);
    if (resultTimer) clearTimeout(resultTimer);
    resultTimer = setTimeout(clearResult, RESULT_TIMEOUTS[item.type] || 3000);
  }

  // Tutup overlay lebih awal (tombol ✕ untuk admin). Kalau ada antrean,
  // hasil berikutnya langsung tampil.
  function dismissResult() {
    if (resultTimer) clearTimeout(resultTimer);
    resultTimer = null;
    clearResult();
  }

  function bindCloseOnce(el) {
    if (closeBound) return;
    closeBound = true;
    el.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('.scan-overlay-close')) {
        dismissResult();
      }
    });
  }

  function showSimple(msg, type) {
    displayResult(buildSimpleItem(msg, type));
  }

  function showEmployee(k, type, message, timeStr) {
    displayResult(buildEmployeeItem(k, type, message, timeStr));
  }

  function clearResult() {
    const el = document.getElementById(RESULT_ID);
    resultTimer = null;
    overlayBusy = false;
    if (queuedResult) {
      // Antrean hanya menyimpan 1 slot (yang terbaru); scan yang
      // tertimpa sudah tercatat datanya, hanya konfirmasi visualnya
      // yang dilewat — jadi hitungan menunggu di-reset di sini.
      const next = queuedResult;
      queuedResult = null;
      waitingCount = 0;
      showOverlay(next);
      return;
    }
    if (el) {
      el.className = 'result scan-overlay';
      el.innerHTML = '';
    }
  }

  /* ------------------------------------------------------------
     [6] HELPER
     ------------------------------------------------------------ */
  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /* ------------------------------------------------------------
     [7] EXPORT API
     ------------------------------------------------------------ */
  return {
    start,
    stop,
    isActive: () => isScanning,
    setMode,
    getMode: () => mode,
    dismissResult,
    setSoundEnabled,
    isSoundEnabled: () => soundEnabled,
    getWaitingCount: () => waitingCount,
  };
})();
