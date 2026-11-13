"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type MonitorRow = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department: string | null;
  check_in_at: string;
  check_out_at: string | null;
  is_overtime: boolean;
  overtime_meal_eligible: boolean;
  regular_voucher_status: "tersedia" | "diklaim" | "dibatalkan" | null;
  overtime_voucher_status: "tersedia" | "diklaim" | "dibatalkan" | null;
};

type ViewFilter = "semua" | "lembur" | "jatah";

function todayInJakarta() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (key: string) => parts.find((value) => value.type === key)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

function voucherLabel(status: MonitorRow["regular_voucher_status"]) {
  if (status === "tersedia") return "Tersedia";
  if (status === "diklaim") return "Ditukarkan";
  if (status === "dibatalkan") return "Dibatalkan";
  return "Belum terbit";
}

export default function Home() {
  const router = useRouter();
  const supabase = useMemo(() => {
    try { return createClient(); } catch { return null; }
  }, []);
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [profileName, setProfileName] = useState("Personalia");
  const [workDate, setWorkDate] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ViewFilter>("semua");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => { setWorkDate(todayInJakarta()); }, []);

  useEffect(() => {
    if (!supabase || !workDate) {
      if (!supabase) { setMessage("Hubungkan Supabase melalui .env.local untuk memuat monitoring."); setLoading(false); }
      return;
    }
    let cancelled = false;
    async function loadMonitor() {
      setLoading(true);
      setMessage("");
      const { data: authData, error: authError } = await supabase!.auth.getUser();
      if (authError || !authData.user) { router.replace("/login"); return; }
      const { data: profile, error: profileError } = await supabase!
        .from("profiles").select("display_name, role, is_active").eq("id", authData.user.id).single();
      if (profileError || !profile?.is_active) { setMessage("Akun belum memiliki profil aktif. Hubungi Admin."); setLoading(false); return; }
      if (profile.role !== "admin" && profile.role !== "personalia") { router.replace("/operator"); return; }
      setProfileName(profile.display_name || "Personalia");
      const { data, error } = await supabase!.rpc("get_personalia_daily_monitor", { p_work_date: workDate });
      if (cancelled) return;
      if (error) setMessage(error.message);
      else setRows((data ?? []) as MonitorRow[]);
      setLoading(false);
    }
    void loadMonitor();
    return () => { cancelled = true; };
  }, [supabase, workDate, router]);

  const overtimeCount = rows.filter((row) => row.is_overtime).length;
  const mealEligibleCount = rows.filter((row) => row.overtime_meal_eligible).length;
  const checkedOutCount = rows.filter((row) => row.check_out_at).length;
  const filteredRows = rows.filter((row) => {
    const matchesFilter = filter === "semua" || (filter === "lembur" ? row.is_overtime : row.overtime_meal_eligible);
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID");
    const matchesQuery = !normalizedQuery || row.employee_name.toLocaleLowerCase("id-ID").includes(normalizedQuery)
      || row.employee_code.toLocaleLowerCase("id-ID").includes(normalizedQuery)
      || (row.department || "").toLocaleLowerCase("id-ID").includes(normalizedQuery);
    return matchesFilter && matchesQuery;
  });

  async function logout(event: FormEvent) {
    event.preventDefault();
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
  }

  const dateLabel = workDate
    ? new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${workDate}T00:00:00+07:00`))
    : "Memuat tanggal";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><div className="brand-mark">L</div><div><strong>LEUWITEX</strong><span>People Operations</span></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Navigasi utama">
          <a className="nav-link active" href="/"><span className="nav-icon" aria-hidden="true">▦</span>Ringkasan</a>
          <a className="nav-link" href="/operator"><span className="nav-icon" aria-hidden="true">◉</span>Presensi &amp; klaim</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><span className="live-dot" /> Sistem presensi QR <b>●</b><small>Workspace operasional · WIB</small></div>
          <div className="user-chip"><div className="avatar">{profileName.charAt(0).toUpperCase()}</div><div><strong>{profileName}</strong><span>Monitoring</span></div><form onSubmit={logout}><button className="logout-link" type="submit">Keluar</button></form></div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><i>/</i><strong>Ringkasan</strong></div><div className="topbar-actions"><span className="date-pill"><span>◷</span> WIB · {dateLabel}</span></div></header>
        <div className="content-wrap">
          <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" /> MONITORING HARIAN</div><h1>Monitoring Personalia <span>✳</span></h1><p>Pantau aktivitas lembur dan kelayakan jatah makan karyawan.</p></div><label className="filter-button">▦ <input aria-label="Pilih tanggal monitoring" type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></label></div>

          <div className="metric-grid">
            <article className="metric-card"><div className="metric-top"><span className="metric-label">KARYAWAN LEMBUR</span><span className="metric-icon orange">◷</span></div><div className="metric-value">{loading ? "—" : overtimeCount}<small> orang</small></div><div className="metric-foot"><span className="status-dot orange-dot" />Lembur dihitung setelah pukul 16.00</div><div className="sparkline orange-line"><span /><span /><span /><span /><span /><span /><span /></div></article>
            <article className="metric-card featured"><div className="metric-top"><span className="metric-label">BERHAK JATAH MAKAN LEMBUR</span><span className="metric-icon green">◇</span></div><div className="metric-value">{loading ? "—" : mealEligibleCount}<small> orang</small></div><div className="metric-foot"><span className="status-dot green-dot" />Check-out setelah pukul 18.00</div><div className="sparkline green-line"><span /><span /><span /><span /><span /><span /><span /></div></article>
            <article className="metric-card"><div className="metric-top"><span className="metric-label">SUDAH CHECK-OUT</span><span className="metric-icon blue">↗</span></div><div className="metric-value">{loading ? "—" : checkedOutCount}<small> orang</small></div><div className="metric-foot"><span className="status-dot blue-dot" />Dari karyawan yang tercatat presensi</div><div className="sparkline blue-line"><span /><span /><span /><span /><span /><span /><span /></div></article>
          </div>

          <div className="section-heading"><div><h2>Monitoring karyawan</h2><p>{dateLabel} · Daftar presensi dan status lembur.</p></div><div className="table-actions"><label className="search-box"><span>⌕</span><input aria-label="Cari karyawan" placeholder="Cari nama atau ID..." value={query} onChange={(event) => setQuery(event.target.value)} /></label></div></div>
          <section className="table-card" aria-label="Monitoring karyawan">
            <div className="table-toolbar"><div className="segmented"><button className={filter === "semua" ? "selected" : ""} onClick={() => setFilter("semua")}>Semua <span>{rows.length}</span></button><button className={filter === "lembur" ? "selected" : ""} onClick={() => setFilter("lembur")}>Lembur <span>{overtimeCount}</span></button><button className={filter === "jatah" ? "selected" : ""} onClick={() => setFilter("jatah")}>Jatah makan <span>{mealEligibleCount}</span></button></div></div>
            <div className="table-scroll"><table><thead><tr><th>KARYAWAN</th><th>BAGIAN</th><th>CHECK-IN</th><th>CHECK-OUT</th><th>STATUS LEMBUR</th><th>JATAH MAKAN LEMBUR</th></tr></thead><tbody>
              {message ? <tr className="empty-state"><td colSpan={6}><div className="empty-icon">i</div><strong>{message}</strong><span>Periksa konfigurasi Supabase, sesi login, dan migrasi database.</span></td></tr>
                : loading ? <tr className="empty-state"><td colSpan={6}><strong>Memuat data monitoring…</strong></td></tr>
                : filteredRows.length === 0 ? <tr className="empty-state"><td colSpan={6}><div className="empty-icon">⌕</div><strong>Belum ada data pada tanggal ini</strong><span>Data presensi karyawan akan tampil setelah check-in tercatat.</span></td></tr>
                : filteredRows.map((row) => <tr key={row.employee_id}>
                  <td><div className="employee-cell"><div className="employee-avatar">{row.employee_name.charAt(0).toUpperCase()}</div><div><strong>{row.employee_name}</strong><span>{row.employee_code}</span></div></div></td>
                  <td>{row.department || "—"}</td><td>{formatTime(row.check_in_at)}</td><td>{formatTime(row.check_out_at)}</td>
                  <td><span className={`status-badge ${row.is_overtime ? "badge-overtime" : "badge-neutral"}`}>{row.is_overtime ? "Lembur" : "Jam kerja"}</span></td>
                  <td><span className={`status-badge ${row.overtime_meal_eligible ? "badge-eligible" : "badge-neutral"}`}>{row.overtime_meal_eligible ? voucherLabel(row.overtime_voucher_status) : "Tidak memenuhi syarat"}</span></td>
                </tr>)}
            </tbody></table></div>
            <footer className="table-footer"><span>Menampilkan <b>{filteredRows.length}</b> dari {rows.length} karyawan</span><span>Data dibatasi sesuai hak akses</span></footer>
          </section>
          <div className="rule-note"><span>i</span><p><strong>Aturan jatah makan lembur</strong><br />Karyawan non-shift yang check-out setelah pukul <b>18.00 WIB</b> berhak atas satu voucher makan lembur.</p><span className="rule-clock">08:00 — 16:00 — 18:00</span></div>
          <footer className="page-footer"><span>LEUWITEX <i>·</i> SISTEM INFORMASI ABSENSI &amp; KUPON MAKAN</span><span>Monitoring baca-saja <b>·</b> zona waktu WIB</span></footer>
        </div>
      </section>
    </main>
  );
}
