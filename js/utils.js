const Utils = (() => {

  /* ------------------------------------------------------------
     [1] HTML ESCAPING — wajib untuk semua render dinamis
     ------------------------------------------------------------ */
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ------------------------------------------------------------
     [2] FORMAT WAKTU
     ------------------------------------------------------------ */
  function formatWaktu(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID');
  }

  /* ------------------------------------------------------------
     [3] CEK TANGGAL — apakah value jatuh di HARI INI
     ------------------------------------------------------------ */
  /* ------------------------------------------------------------
     [2.b] JAM SISTEM - satu-satunya sumber waktu aplikasi.
     Normal: jam perangkat (realtime). Mode Simulasi: jam digeser
     dengan offset (disimpan di localStorage, jadi tahan refresh)
     supaya demo/presentasi bisa loncat ke 08:05, 12:00, 16:05,
     18:05, dst tanpa menunggu jam asli. Semua modul WAJIB pakai
     Utils.now() / nowIso() / nowMs() / isToday(), jangan new Date().
     ------------------------------------------------------------ */
  const SIM_KEY = 'absensi_sim_offset_ms';

  function loadSimOffset() {
    try {
      const v = parseInt(localStorage.getItem(SIM_KEY) || '0', 10);
      return Number.isFinite(v) ? v : 0;
    } catch { return 0; }
  }

  let simOffsetMs = loadSimOffset();

  function now() { return new Date(Date.now() + simOffsetMs); }
  function nowMs() { return Date.now() + simOffsetMs; }
  function nowIso() { return now().toISOString(); }
  function isSimulated() { return simOffsetMs !== 0; }

  // Set jam simulasi hari ini, mis. '08:05'. Jam berjalan normal
  // dari titik itu (offset, bukan jam beku), jadi 08:05 akan
  // menjadi 08:06 semenit kemudian.
  function setSimulatedTime(hhmm) {
    const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) throw new Error('Format jam tidak valid, pakai HH:MM, contoh 08:05');
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) throw new Error('Jam tidak valid');
    const target = new Date();
    target.setHours(h, min, 0, 0);
    simOffsetMs = target.getTime() - Date.now();
    try { localStorage.setItem(SIM_KEY, String(simOffsetMs)); } catch { /* ignore */ }
    return now();
  }

  function clearSimulation() {
    simOffsetMs = 0;
    try { localStorage.removeItem(SIM_KEY); } catch { /* ignore */ }
    return now();
  }

  function todayLocalISO() {
    const d = now();
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }

  function isToday(value) {
    if (!value) return false;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return false;
    const n = now();
    return (
      d.getFullYear() === n.getFullYear() &&
      d.getMonth() === n.getMonth() &&
      d.getDate() === n.getDate()
    );
  }

  /* ------------------------------------------------------------
     [3.b] NORMALISASI TANGGAL → 'YYYY-MM-DD' pada zona waktu LOKAL
     ------------------------------------------------------------ */
  function toLocalISODate(value) {
    if (!value) return '';
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = value instanceof Date ? value : new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /* ------------------------------------------------------------
     [3.c] JAM KERJA — ubah angka di sini bila aturan berubah
     Atur jam disini untuk otomatis kupon makan lembur
     ------------------------------------------------------------ */
  const WORK = {
    MASUK: '08:00',              // jam masuk (non-shift, sesuai artikel B1)
    PULANG: '16:00',             // jam pulang (non-shift, sesuai artikel B1)
    LEMBUR_SETELAH_MENIT: 120,   // lembur jika pulang >= PULANG
  };

  // 'HH:MM' / 'HH:MM:SS' → detik sejak 00:00
  function jamKeDetik(str) {
    const [h = 0, m = 0, s = 0] = String(str).split(':').map(Number);
    return h * 3600 + m * 60 + s;
  }

  function detikHariIni(d) {
    const t = d instanceof Date ? d : now();
    return t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds();
  }

  function isSudahJamPulang(d) {
    return detikHariIni(d) >= jamKeDetik(WORK.PULANG);
  }

  function isLembur(d) {
    // B4/B5 artikel: lembur hanya bila pulang SETELAH 18:00;
    // tepat 18:00 atau lebih awal TIDAK memenuhi syarat.
    const batas = jamKeDetik(WORK.PULANG) + WORK.LEMBUR_SETELAH_MENIT * 60;
    return detikHariIni(d) > batas;
  }

  function formatJamPulang() {
    return String(WORK.PULANG).slice(0, 8);
  }

  /* ------------------------------------------------------------
     [3.e] KALKULATOR LEMBUR - cuma ngitung, tidak mengubah data.
     Dipakai panel simulasi untuk menjawab "kalau pulang jam X
     gimana?" tanpa scan ulang. Aturan dari artikel B3-B5:
     - pulang >= 16:00 baru boleh pulang
     - lembur dihitung setelah 16:00
     - kupon lembur HANYA bila pulang SETELAH 18:00 (tepat 18:00 tidak)
     ------------------------------------------------------------ */
  function formatDurasi(menit) {
    const m = Math.round(menit);
    if (m < 60) return m + ' menit';
    const j = Math.floor(m / 60);
    const s = m % 60;
    return s === 0 ? j + ' jam' : j + ' jam ' + s + ' menit';
  }

  function hitungLembur(masukStr, pulangStr) {
    const masuk = jamKeDetik(masukStr);
    const pulang = jamKeDetik(pulangStr);
    if (!Number.isFinite(masuk) || !Number.isFinite(pulang)) {
      return { error: 'Isi jam masuk dan jam pulang dulu (HH:MM).' };
    }
    if (pulang <= masuk) {
      return { error: 'Jam pulang harus setelah jam masuk (satu hari yang sama).' };
    }
    const jamPulang = jamKeDetik(WORK.PULANG);
    const batasLembur = jamPulang + WORK.LEMBUR_SETELAH_MENIT * 60;
    const totalMenit = (pulang - masuk) / 60;
    const lemburMenit = Math.max(0, (pulang - jamPulang) / 60);
    const bolehPulang = pulang >= jamPulang;
    const kuponLembur = pulang > batasLembur;
    const kuponLemburMenit = kuponLembur ? (pulang - batasLembur) / 60 : 0;
    let alasan;
    if (!bolehPulang) {
      alasan = 'Belum boleh pulang: pulang mulai ' + formatJamPulang() + '.';
    } else if (kuponLembur) {
      alasan = 'Pulang setelah 18:00, jadi dapat kupon lembur (B4).';
    } else if (pulang === batasLembur) {
      alasan = 'Pulang tepat 18:00, belum lembur untuk kupon (B5).';
    } else {
      alasan = 'Sudah boleh pulang, tapi belum lewat 18:00, jadi belum dapat kupon lembur.';
    }
    return {
      masuk: String(masukStr).slice(0, 5),
      pulang: String(pulangStr).slice(0, 5),
      totalMenit, totalText: formatDurasi(totalMenit),
      lemburMenit, lemburText: formatDurasi(lemburMenit),
      bolehPulang, kuponReguler: true,
      kuponLembur, kuponLemburMenit,
      alasan,
    };
  }

  /* ------------------------------------------------------------
     [3.d] SORTING TABEL — klik header kolom (ID / Nama)
     ------------------------------------------------------------ */
  function sortBy(list, field, direction) {
    const angka = (v) => {
      const d = String(v || '').replace(/[^0-9]/g, '');
      return d === '' ? NaN : parseInt(d, 10);
    };
    const sorted = [...list].sort((a, b) => {
      if (field === 'id') {
        const na = angka(a.id);
        const nb = angka(b.id);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return String(a.id || '').localeCompare(String(b.id || ''), 'id', {
          sensitivity: 'base',
          numeric: true,
        });
      }
      const va = String(a[field] || '').toLowerCase().trim();
      const vb = String(b[field] || '').toLowerCase().trim();
      return va.localeCompare(vb, 'id', { sensitivity: 'base', numeric: true });
    });
    return direction === 'asc' ? sorted : sorted.reverse();
  }

  function updateSortIndicator(tableSel, cfg) {
    document.querySelectorAll(`${tableSel} th[data-sort]`).forEach((th) => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (cfg.field === th.dataset.sort) {
        th.classList.add(cfg.direction === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  function bindSortHeader(tableSel, cfg, onChange) {
    const thead = document.querySelector(`${tableSel} thead`);
    if (!thead) return;
    thead.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const field = th.dataset.sort;
      if (cfg.field === field) {
        cfg.direction = cfg.direction === 'asc' ? 'desc' : 'asc';
      } else {
        cfg.field = field;
        cfg.direction = 'asc';
      }
      onChange();
    });
  }

  /* ------------------------------------------------------------
     [4] CEK STATUS KARYAWAN — non-aktif = tolak operasi
     ------------------------------------------------------------ */
  function isKaryawanNonAktif(karyawan) {
    if (!karyawan) return false;
    const s = String(karyawan.status || '').toLowerCase().trim();
    return s === 'non-aktif' || s === 'nonaktif';
  }

  /* ------------------------------------------------------------
     [5] GENERATE KODE TRANSAKSI — TR-YYMM-XXX (auto-increment)
     ------------------------------------------------------------ */
  function nextKodeTransaksi() {
    const d = now();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const prefix = `TR-${yy}${mm}-`;

    let maxSeq = 0;

    if (typeof Storage !== 'undefined' && Storage) {
      try {
        Storage.getReservasiManual().forEach((r) => {
          const kode = String(r.kode || '');
          if (!kode.startsWith(prefix)) return;
          const seq = parseInt(kode.slice(prefix.length), 10);
          if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
        });
      } catch (err) {
        console.warn('Utils: gagal membaca reservasi manual', err);
      }

      try {
        Storage.getKaryawan().forEach((k) => {
          const kode = String(k.kuponKode || '');
          if (!kode.startsWith(prefix)) return;
          const seq = parseInt(kode.slice(prefix.length), 10);
          if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
        });
      } catch (err) {
        console.warn('Utils: gagal membaca kuponKode karyawan', err);
      }

      try {
        if (typeof Storage.getReservasiArchive === 'function') {
          Storage.getReservasiArchive().forEach((r) => {
            const kode = String(r.kode || '');
            if (!kode.startsWith(prefix)) return;
            const seq = parseInt(kode.slice(prefix.length), 10);
            if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
          });
        }
      } catch (err) {
        console.warn('Utils: gagal membaca arsip reservasi', err);
      }
    }

    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  }

  /* ------------------------------------------------------------
     [5.b] GENERATE KODE OVERTIME — OT-YYMM-XXX (auto-increment)
     ------------------------------------------------------------ */
  function nextKodeOvertime() {
    const d = now();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const prefix = `OT-${yy}${mm}-`;

    let maxSeq = 0;

    if (typeof Storage !== 'undefined' && Storage) {
      try {
        Storage.getOvertime().forEach((r) => {
          const kode = String(r.id || '');
          if (!kode.startsWith(prefix)) return;
          const suffix = kode.slice(prefix.length);
          
          if (!/^\d{3,}$/.test(suffix)) return;
          const seq = parseInt(suffix, 10);
          if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
        });
      } catch (err) {
        console.warn('Utils: gagal membaca data overtime', err);
      }
    }

    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  }


  /* ------------------------------------------------------------
     [5.b] DIALOG — modal konfirmasi & alert aplikasi.
     Pengganti native confirm()/alert() yang di-suppress sebagian
     browser (embedded/cloud) sehingga tombol Hapus/Keluar/Release
     tampak mati. Fallback ke native bila markup modal tidak ada.
     ------------------------------------------------------------ */
  let dialogState = null; // { resolve, els }
  let dialogWired = false;

  function getDialogEls() {
    if (typeof document === 'undefined') return null;
    const modal = document.getElementById('modalConfirm');
    if (!modal) return null;
    return {
      modal,
      title: document.getElementById('modalConfirmTitle'),
      msg: document.getElementById('modalConfirmMsg'),
      btnYa: document.getElementById('btnModalConfirmYa'),
      btnBatal: document.getElementById('btnModalConfirmBatal'),
      btnClose: document.getElementById('btnCloseModalConfirm'),
    };
  }

  function closeDialog(result) {
    if (!dialogState) return;
    const { resolve, els } = dialogState;
    dialogState = null;
    els.modal.hidden = true;
    if (document.body && document.body.classList) document.body.classList.remove('modal-open');
    resolve(result);
  }

  function wireDialog(els) {
    if (dialogWired) return;
    dialogWired = true;
    els.btnYa.addEventListener('click', () => closeDialog(true));
    els.btnBatal.addEventListener('click', () => closeDialog(false));
    els.btnClose.addEventListener('click', () => closeDialog(false));
    els.modal.addEventListener('click', (e) => {
      if (e.target === els.modal) closeDialog(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dialogState) closeDialog(false);
    });
  }

  function showDialog({ title, message, okText, showCancel }) {
    return new Promise((resolve) => {
      const els = getDialogEls();
      if (!els) {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (showCancel) { resolve(window.confirm(message)); return; }
          if (typeof window.alert === 'function') window.alert(message);
          resolve(true); return;
        }
        resolve(true);
        return;
      }
      // Dialog sebelumnya (kalau ada) dianggap dibatalkan.
      if (dialogState) dialogState.resolve(false);
      wireDialog(els);
      els.title.textContent = title;
      els.msg.textContent = message;
      els.btnYa.textContent = okText;
      els.btnYa.className = 'btn ' + (showCancel ? 'btn-danger' : 'btn-primary');
      els.btnBatal.style.display = showCancel ? '' : 'none';
      dialogState = { resolve, els };
      els.modal.hidden = false;
      if (document.body && document.body.classList) document.body.classList.add('modal-open');
      if (els.btnYa.focus) els.btnYa.focus();
    });
  }

  function confirmDialog(message, opts) {
    const o = opts || {};
    return showDialog({
      title: o.title || 'Konfirmasi',
      message,
      okText: o.okText || 'Ya, lanjutkan',
      showCancel: true,
    });
  }

  function alertDialog(message, opts) {
    const o = opts || {};
    return showDialog({
      title: o.title || 'Perhatian',
      message,
      okText: o.okText || 'OK',
      showCancel: false,
    }).then(() => undefined);
  }

  /* ------------------------------------------------------------
     [6] EXPORT — API publik
     ------------------------------------------------------------ */
  return {
    escapeHtml,
    formatWaktu,
    now,
    nowMs,
    nowIso,
    isSimulated,
    setSimulatedTime,
    clearSimulation,
    todayLocalISO,
    isToday,
    toLocalISODate,
    sortBy,
    updateSortIndicator,
    bindSortHeader,
    WORK,
    isSudahJamPulang,
    isLembur,
    formatJamPulang,
    hitungLembur,
    formatDurasi,
    isKaryawanNonAktif,
    nextKodeTransaksi,
    nextKodeOvertime,
    confirmDialog,
    alertDialog,
  };
})();
