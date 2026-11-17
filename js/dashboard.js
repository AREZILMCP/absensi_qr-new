const Dashboard = (() => {
  const { escapeHtml } = Utils;

  // Nilai statistik & jumlah riwayat pada render sebelumnya.
  // Dipakai untuk flash angka yang berubah + sorot baris riwayat baru
  // setelah scan berhasil (plan UX §3.3). Render pertama (prev = null)
  // tidak mem-flash apa pun.
  let prevStats = null;
  let prevRiwayatLen = null;

  // Rentang grafik kehadiran (filter "Hari ini / Kemarin / 7 hari terakhir"
  // di kartu grafik). Kartu statistik di atas tetap snapshot hari ini.
  let grafikRange = 'today';
  let grafikFilterBound = false;

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

    // Grafik mengikuti filter rentang (donut + legenda + footer).
    const gFoot = renderGrafik(today, total, tepat, telat, belum, terbit);

    // Flash hijau 1 detik pada angka yang berubah sejak render lalu.
    flashChanged({
      statTotal: total, statHadir: hadir, statMakan: makan, statBelum: belum,
      kuponTerbit: gFoot.kupon, lemburHariIni: gFoot.lembur,
    });

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
     [2.b] GRAFIK — filter rentang Hari ini / Kemarin / 7 hari terakhir
     ------------------------------------------------------------ */
  // Grafik kehadiran mengikuti filter rentang: donut + legenda (jumlah
  // DAN persen) + footer lembur/kupon. Mengembalikan angka footer yang
  // ditampilkan (dipakai flashChanged).
  function renderGrafik(today, total, tepatToday, telatToday, belumToday, terbitToday) {
    bindGrafikFilter();
    const dates = rangeDates(grafikRange);
    const g = computeGrafik(dates, total, tepatToday, telatToday, belumToday);
    const foot = computeFooter(grafikRange, dates, terbitToday);
    const pct = (n) => (g.denom > 0 ? Math.round((n / g.denom) * 100) : 0);
    setText('legendTepat', g.tepat);
    setText('legendTelat', g.telat);
    setText('legendBelum', g.belum);
    setText('legendTepatPct', pct(g.tepat) + '%');
    setText('legendTelatPct', pct(g.telat) + '%');
    setText('legendBelumPct', pct(g.belum) + '%');
    setText('donutLabel', labelRentang(grafikRange, 'Kehadiran'));
    setText('lemburLabel', labelRentang(grafikRange, 'Lembur') + ':');
    setText('kuponLabel', foot.kuponLabel + ':');
    setText('lemburHariIni', foot.lembur);
    setText('kuponTerbit', foot.kupon);
    setText('grafikTanggal', labelTanggal(grafikRange, dates));
    renderDonut(g.tepat, g.telat, g.belum, g.denom);
    return foot;
  }

  function labelRentang(range, kata) {
    if (range === 'yesterday') return kata + ' kemarin';
    if (range === 'week') return kata + ' 7 hari terakhir';
    return kata + ' hari ini';
  }

  function labelTanggal(range, dates) {
    if (range === 'week') return dates[0] + ' – ' + dates[dates.length - 1];
    return dates[0];
  }

  // Hitung tepat/telat/belum untuk rentang tanggal tertentu.
  // 'today' memakai absenAt karyawan (perilaku lama yang sudah teruji);
  // rentang lampau memakai catatan presensi.
  function computeGrafik(dates, total, tepatToday, telatToday, belumToday) {
    if (grafikRange === 'today') {
      return { tepat: tepatToday, telat: telatToday, belum: belumToday, denom: total };
    }
    const dateSet = new Set(dates);
    let tepat = 0;
    let telat = 0;
    Storage.getPresensi().forEach((p) => {
      if (!p || !dateSet.has(p.tanggal)) return;
      const menit = menitMasuk(p.masukAt);
      if (menit == null) return;
      if (menit > 8 * 60) telat += 1;
      else tepat += 1;
    });
    const denom = total * dates.length;
    const belum = Math.max(0, denom - (tepat + telat));
    return { tepat, telat, belum, denom };
  }

  function menitMasuk(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.getHours() * 60 + d.getMinutes();
  }

  // Footer grafik: lembur + kupon mengikuti rentang. Hari ini: kupon
  // yang masih TERBIT (belum ditebus). Rentang lampau: kupon yang sudah
  // DITEBUS dalam rentang itu.
  function computeFooter(range, dates, terbitToday) {
    const dateSet = new Set(dates);
    const lembur = Storage.getPresensi().filter((p) => p && dateSet.has(p.tanggal) && p.lembur).length;
    if (range === 'today') {
      return { lembur, kupon: terbitToday, kuponLabel: 'Kupon terbit' };
    }
    const keys = new Set();
    Storage.getKaryawan().forEach((k) => {
      if (!k || k.kuponStatus !== 'ditebus' || !k.makanAt) return;
      if (!dateSet.has(Utils.toLocalISODate(k.makanAt))) return;
      keys.add(k.kuponKode ? 'K:' + k.kuponKode : 'KRY:' + k.id);
    });
    Storage.getReservasiManual().forEach((r) => {
      if (!r || !r.karyawanId || !r.released) return;
      if (!dateSet.has(Utils.toLocalISODate(r.tanggal || r.createdAt))) return;
      keys.add(r.kode ? 'K:' + r.kode : 'RM:' + r.id);
    });
    Storage.getReservasiArchive().forEach((r) => {
      if (!r || !r.karyawanId || r.ditebus !== 'Ya') return;
      if (!dateSet.has(Utils.toLocalISODate(r.tanggal || r.archivedAt))) return;
      keys.add(r.kode ? 'K:' + r.kode : 'RA:' + r.id);
    });
    return { lembur, kupon: keys.size, kuponLabel: 'Kupon ditebus' };
  }

  function rangeDates(range) {
    const today = Storage.todayLocalISO();
    if (range === 'yesterday') return [isoDaysAgo(1)];
    if (range === 'week') {
      const out = [];
      for (let i = 6; i >= 0; i--) out.push(isoDaysAgo(i));
      return out;
    }
    return [today];
  }

  function isoDaysAgo(n) {
    const d = nowDate();
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() - n);
    return Utils.toLocalISODate(t);
  }

  function nowDate() {
    try {
      return typeof Utils !== 'undefined' && typeof Utils.now === 'function' ? Utils.now() : new Date();
    } catch {
      return new Date();
    }
  }

  function bindGrafikFilter() {
    if (grafikFilterBound) return;
    const sel = document.getElementById('grafikFilter');
    if (!sel) return;
    grafikFilterBound = true;
    sel.addEventListener('change', (e) => {
      setGrafikRange(e && e.target ? e.target.value : 'today');
    });
  }

  function setGrafikRange(range) {
    grafikRange = range === 'yesterday' || range === 'week' ? range : 'today';
    const sel = document.getElementById('grafikFilter');
    if (sel) sel.value = grafikRange;
    render();
  }

  /* ------------------------------------------------------------
     [3] RENDER RIWAYAT SCAN
     ------------------------------------------------------------ */
  const IC_CLOCK = '<svg class="ic-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const IC_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const IC_FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>';

  // Jam HH:MM:SS dari string waktu riwayat ("17/11/2026, 07.56.28"
  // atau "07:56:28"). Bila tidak cocok, tampilkan apa adanya.
  function jamDariWaktu(waktu) {
    const s = String(waktu || '');
    const m = s.match(/(\d{1,2})[.:](\d{2})[.:](\d{2})/);
    if (!m) return s;
    return m[1].padStart(2, '0') + ':' + m[2] + ':' + m[3];
  }

  // Inisial: huruf pertama kata pertama + huruf pertama kata kedua
  // ("Muhammad Syechan Al Fariz" -> "MS", seperti mockup referensi).
  function initialsFor(nama) {
    const parts = String(nama || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    const first = parts[0].charAt(0).toUpperCase();
    const second = parts.length > 1 ? parts[1].charAt(0).toUpperCase() : '';
    return first + second;
  }

  const INITIAL_COLORS = ['#2563eb', '#059669', '#7c3aed', '#d97706', '#db2777', '#0891b2'];
  function initialColorFor(nama) {
    let h = 0;
    const s = String(nama || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return INITIAL_COLORS[h % INITIAL_COLORS.length];
  }

  // Badge berwarna per jenis riwayat (label + warna + ikon).
  function badgeJenis(jenis) {
    const map = {
      'Absensi': { label: 'Absensi Masuk', cls: 'badge-green', icon: IC_ARROW },
      'Absensi Pulang': { label: 'Absensi Pulang', cls: 'badge-gray', icon: IC_ARROW },
      'Makan Siang': { label: 'Makan Siang', cls: 'badge-blue', icon: IC_FORK },
      'Ekstra Makan': { label: 'Ekstra Makan', cls: 'badge-purple', icon: IC_FORK },
      'Kupon Makan': { label: 'Kupon Makan', cls: 'badge-blue', icon: IC_FORK },
    };
    return map[jenis] || { label: jenis || '-', cls: 'badge-gray', icon: IC_ARROW };
  }

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
        (r) => {
          const badge = badgeJenis(r.jenis);
          return `
        <tr>
          <td class="cell-waktu">${IC_CLOCK}<span title="${escapeHtml(r.waktu)}">${escapeHtml(jamDariWaktu(r.waktu))}</span></td>
          <td><span class="riwayat-nama"><span class="riwayat-initial" style="background:${initialColorFor(r.nama)}">${escapeHtml(initialsFor(r.nama))}</span>${escapeHtml(r.nama)}</span></td>
          <td><span class="jenis-badge ${badge.cls}">${badge.icon}<span>${escapeHtml(badge.label)}</span></span></td>
        </tr>`;
        }
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
  return { render, setGrafikRange };
})();
