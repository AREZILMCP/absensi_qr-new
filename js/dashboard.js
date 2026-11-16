const Dashboard = (() => {
  const { escapeHtml } = Utils;

  // Nilai statistik & jumlah riwayat pada render sebelumnya.
  // Dipakai untuk flash angka yang berubah + sorot baris riwayat baru
  // setelah scan berhasil (plan UX §3.3). Render pertama (prev = null)
  // tidak mem-flash apa pun.
  let prevStats = null;
  let prevRiwayatLen = null;

  /* ------------------------------------------------------------
     [1] RENDER UTAMA — panggil semua sub-render
     ------------------------------------------------------------ */
  function render() {
    if (typeof Storage.autoReleaseStaleOvertime === 'function') {
      Storage.autoReleaseStaleOvertime();
    }

    if (typeof Storage.cleanupStaleMeals === 'function') {
      Storage.cleanupStaleMeals();
    }

    if (typeof Storage.cleanupStaleReservasiManual === 'function') {
      Storage.cleanupStaleReservasiManual();
    }

    const list = Storage.getKaryawan();
    const total = list.length;

    // Hadir hari ini, dipisah tepat waktu vs terlambat (masuk setelah 08:00).
    let hadir = 0;
    let tepat = 0;
    let telat = 0;
    list.forEach((k) => {
      if (!Utils.isToday(k.absenAt)) return;
      hadir += 1;
      const d = new Date(k.absenAt);
      const menit = Number.isNaN(d.getTime()) ? 0 : d.getHours() * 60 + d.getMinutes();
      if (menit > 8 * 60) telat += 1;
      else tepat += 1;
    });
    const belum = total - hadir;

    const today = Storage.todayLocalISO();
    const kuponKeys = new Set();
    let terbit = 0;

    // Kupon scan: hanya yang sudah DITEBUS di kantin yang dihitung
    // sebagai "Sudah Ambil Makan". Yang masih TERBIT dihitung terpisah.
    list.forEach((k) => {
      if (!Utils.isToday(k.makanAt)) return;
      if (k.kuponStatus === 'ditebus') {
        kuponKeys.add(k.kuponKode ? 'K:' + k.kuponKode : 'KRY:' + k.id);
      } else {
        terbit += 1;
      }
    });

    Storage.getReservasiManual().forEach((r) => {
      if (!r || !r.karyawanId) return;
      if (Utils.toLocalISODate(r.tanggal || r.createdAt) !== today) return;
      if (!r.released) return; // reservasi manual yang belum di-release bukan kupon yang sudah diambil
      kuponKeys.add(r.kode ? 'K:' + r.kode : 'RM:' + r.id);
    });

    Storage.getReservasiArchive().forEach((r) => {
      if (!r || !r.karyawanId) return;
      if (Utils.toLocalISODate(r.tanggal || r.archivedAt) !== today) return;
      if (r.ditebus !== 'Ya') return; // arsip kupon yang tidak ditebus bukan ambil makan
      kuponKeys.add(r.kode ? 'K:' + r.kode : 'RA:' + r.id);
    });

    const makan = kuponKeys.size;

    // Lembur hari ini dari catatan presensi (pulang setelah 18:00).
    const lembur = Storage.getPresensi().filter((p) => p.tanggal === today && p.lembur).length;

    setText('statTotal', total);
    setText('statHadir', hadir);
    setText('statMakan', makan);
    setText('statBelum', belum);

    // Flash hijau 1 detik pada angka yang berubah sejak render lalu.
    flashChanged({
      statTotal: total, statHadir: hadir, statMakan: makan, statBelum: belum,
      kuponTerbit: terbit, lemburHariIni: lembur,
    });

    setText('legendTepat', tepat);
    setText('legendTelat', telat);
    setText('legendBelum', belum);
    setText('lemburHariIni', lembur);
    setText('kuponTerbit', terbit);
    setText('grafikTanggal', today);

    renderDonut(tepat, telat, belum, total);
    renderRiwayat();
  }

  /* ------------------------------------------------------------
     [2] HELPER — set text & render donut
     ------------------------------------------------------------ */
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // Beri class .stat-flash pada angka yang nilainya berubah; class
  // dilepas lagi setelah 1 detik. Tanpa perubahan: tidak ada flash.
  function flashChanged(next) {
    const prev = prevStats;
    prevStats = next;
    if (!prev) return;
    Object.keys(next).forEach((id) => {
      if (prev[id] === next[id]) return;
      const el = document.getElementById(id);
      if (!el || !el.classList) return;
      el.classList.add('stat-flash');
      setTimeout(() => el.classList.remove('stat-flash'), 1000);
    });
  }

  // Donut 3 segmen: tepat waktu (hijau) / terlambat (kuning) / belum (abu).
  function renderDonut(tepat, telat, belum, total) {
    const hadir = tepat + telat;
    const percent = total > 0 ? Math.round((hadir / total) * 100) : 0;
    const tepatPct = total > 0 ? (tepat / total) * 100 : 0;
    const telatPct = total > 0 ? (telat / total) * 100 : 0;
    const donut = document.getElementById('donutChart');
    if (donut) {
      donut.style.background =
        `conic-gradient(#10b981 0% ${tepatPct}%, #f59e0b ${tepatPct}% ${tepatPct + telatPct}%, #e2e8f0 ${tepatPct + telatPct}% 100%)`;
    }
    setText('donutPercent', `${percent}%`);
  }

  /* ------------------------------------------------------------
     [3] RENDER RIWAYAT SCAN
     ------------------------------------------------------------ */
  function renderRiwayat() {
    const tbody = document.getElementById('riwayat');
    if (!tbody) return;

    const riwayat = Storage.getRiwayat();

    if (riwayat.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-row">Belum ada riwayat</td></tr>';
      return;
    }

    const bertambah = prevRiwayatLen !== null && riwayat.length > prevRiwayatLen;
    prevRiwayatLen = riwayat.length;

    tbody.innerHTML = riwayat
      .slice(0, 10)
      .map(
        (r) => `
        <tr>
          <td class="cell-waktu">${escapeHtml(r.waktu)}</td>
          <td>${escapeHtml(r.nama)}</td>
          <td>${escapeHtml(r.jenis)}</td>
        </tr>`
      )
      .join('');

    // Baris paling atas = entri terbaru: sorot hijau yang memudar 3 detik.
    if (bertambah) {
      const firstRow = tbody.querySelector('tr');
      if (firstRow && firstRow.classList) firstRow.classList.add('riwayat-new');
    }
  }

  /* ------------------------------------------------------------
     [4] EXPORT API
     ------------------------------------------------------------ */
  return { render };
})();
