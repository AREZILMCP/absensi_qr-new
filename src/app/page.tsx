const navigation = [
  { icon: "▦", label: "Ringkasan", active: true },
  { icon: "◉", label: "Presensi" },
  { icon: "◇", label: "Voucher makan" },
  { icon: "♧", label: "Karyawan" },
];

export default function Home() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">L</div>
          <div><strong>LEUWITEX</strong><span>People Operations</span></div>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Navigasi utama">
          {navigation.map((item) => (
            <a className={`nav-link${item.active ? " active" : ""}`} href="#" key={item.label}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-note"><span className="live-dot" /> Sistem presensi QR <b>●</b><small>Workspace operasional · WIB</small></div>
          <div className="user-chip"><div className="avatar">P</div><div><strong>Personalia</strong><span>Monitoring</span></div><span className="more">···</span></div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><i>/</i><strong>Ringkasan</strong></div>
          <div className="topbar-actions"><span className="date-pill"><span>◷</span> Zona waktu WIB</span><button className="icon-button" aria-label="Notifikasi">♧<i /></button></div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div><div className="eyebrow"><span className="live-dot" /> MONITORING HARIAN</div><h1>Selamat pagi, Personalia <span>✳</span></h1><p>Pantau aktivitas lembur dan kelayakan jatah makan hari ini.</p></div>
            <button className="filter-button">▦ <span>Hari ini</span><span className="chevron">⌄</span></button>
          </div>

          <div className="metric-grid">
            <article className="metric-card">
              <div className="metric-top"><span className="metric-label">SEDANG LEMBUR</span><span className="metric-icon orange">◷</span></div>
              <div className="metric-value">—<small> orang</small></div>
              <div className="metric-foot"><span className="status-dot orange-dot" />Terdata check-out setelah 16.00</div>
              <div className="sparkline orange-line"><span /><span /><span /><span /><span /><span /><span /></div>
            </article>
            <article className="metric-card featured">
              <div className="metric-top"><span className="metric-label">BERHAK JATAH MAKAN</span><span className="metric-icon green">◇</span></div>
              <div className="metric-value">—<small> orang</small></div>
              <div className="metric-foot"><span className="status-dot green-dot" />Check-out setelah pukul 18.00</div>
              <div className="sparkline green-line"><span /><span /><span /><span /><span /><span /><span /></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span className="metric-label">VOUCHER DITUKARKAN</span><span className="metric-icon blue">↗</span></div>
              <div className="metric-value">—<small> voucher</small></div>
              <div className="metric-foot"><span className="status-dot blue-dot" />Klaim tercatat di kantin</div>
              <div className="sparkline blue-line"><span /><span /><span /><span /><span /><span /><span /></div>
            </article>
          </div>

          <div className="section-heading"><div><h2>Monitoring karyawan</h2><p>Daftar karyawan dan status aktivitas pada tanggal terpilih.</p></div><div className="table-actions"><label className="search-box"><span>⌕</span><input aria-label="Cari karyawan" placeholder="Cari nama atau ID..." /></label><button className="more-button">•••</button></div></div>

          <section className="table-card" aria-label="Monitoring karyawan">
            <div className="table-toolbar"><div className="segmented"><button className="selected">Semua <span>—</span></button><button>Lembur <span>—</span></button><button>Jatah makan <span>—</span></button></div><button className="export-button">⇩ <span>Ekspor</span></button></div>
            <div className="table-scroll"><table><thead><tr><th>KARYAWAN</th><th>BAGIAN</th><th>CHECK-IN</th><th>CHECK-OUT</th><th>STATUS LEMBUR</th><th>JATAH MAKAN</th></tr></thead><tbody><tr className="empty-state"><td colSpan={6}><div className="empty-icon">⌕</div><strong>Data monitoring akan tampil di sini</strong><span>Hubungkan ke data presensi untuk melihat karyawan lembur dan penerima jatah makan.</span></td></tr></tbody></table></div>
            <footer className="table-footer"><span>Menampilkan <b>—</b> karyawan</span><div><button disabled>←</button><span>Halaman — dari —</span><button disabled>→</button></div></footer>
          </section>

          <div className="rule-note"><span>i</span><p><strong>Aturan jatah makan lembur</strong><br />Karyawan non-shift yang check-out setelah pukul <b>18.00 WIB</b> berhak atas satu voucher makan lembur.</p><span className="rule-clock">08:00 — 16:00 — 18:00</span></div>
          <footer className="page-footer"><span>LEUWITEX <i>·</i> SISTEM INFORMASI ABSENSI &amp; KUPON MAKAN</span><span>Data diperbarui otomatis <b>·</b> zona waktu WIB</span></footer>
        </div>
      </section>
    </main>
  );
}
