const Scanner = (() => {
  const { escapeHtml } = Utils;

  /* ------------------------------------------------------------
     [1] KONSTANTA & STATE
     ------------------------------------------------------------ */
  const COOLDOWN_MS = 2000;
  const RESULT_TIMEOUT_MS = 3500;

  const TARGET_ID = 'reader';
  const RESULT_ID = 'resultScan';

  let html5QrCode = null;
  let isScanning = false;
  let lastScan = { text: null, time: 0 };
  let resultTimer = null;

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
     [5] TAMPILAN HASIL — simple message & kartu karyawan
     ------------------------------------------------------------ */
  function showSimple(msg, type) {
    const el = document.getElementById(RESULT_ID);
    if (!el) return;
    if (resultTimer) clearTimeout(resultTimer);

    el.innerHTML = `<div class="scan-msg scan-msg-${type}">${escapeHtml(msg)}</div>`;
    el.className = 'result show';

    resultTimer = setTimeout(clearResult, RESULT_TIMEOUT_MS);
  }

  function showEmployee(k, type, message, timeStr) {
    const el = document.getElementById(RESULT_ID);
    if (!el) return;
    if (resultTimer) clearTimeout(resultTimer);

    const photoHtml = k.foto
      ? `<img src="${escapeHtml(k.foto)}" alt="${escapeHtml(k.nama)}">`
      : `<span class="scan-photo-initial">${escapeHtml(
          (k.nama || '?').charAt(0).toUpperCase()
        )}</span>`;

    const icon = type === 'ok' ? '✓' : type === 'warn' ? '!' : '✕';

    el.innerHTML = `
      <div class="scan-result scan-result-${type}">
        <div class="scan-photo">${photoHtml}</div>
        <div class="scan-info">
          <div class="scan-status">
            <span class="scan-status-icon">${icon}</span>
            ${escapeHtml(message)}
          </div>
          <div class="scan-name">${escapeHtml(k.nama)}</div>
          <div class="scan-meta">
            <span>${escapeHtml(k.id)}</span>
            <span class="scan-meta-dot">•</span>
            <span>${escapeHtml(k.kategori || '-')}</span>
          </div>
          <div class="scan-time">${timeStr || Utils.now().toLocaleTimeString('id-ID')}</div>
        </div>
      </div>`;
    el.className = 'result show';

    resultTimer = setTimeout(clearResult, RESULT_TIMEOUT_MS);
  }

  function clearResult() {
    const el = document.getElementById(RESULT_ID);
    if (!el) return;
    el.className = 'result';
    el.innerHTML = '';
    resultTimer = null;
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
  return { start, stop, isActive: () => isScanning, setMode, getMode: () => mode };
})();
