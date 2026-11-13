"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => { try { return createClient(); } catch { return null; } }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!supabase) { setError("Supabase belum dikonfigurasi. Lengkapi .env.local terlebih dahulu."); return; }
    setBusy(true);
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError || !data.user) {
      setError(authError?.message || "Login gagal.");
      setBusy(false);
      return;
    }
    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("role, is_active").eq("id", data.user.id).single();
    if (profileError || !profile?.is_active) {
      await supabase.auth.signOut();
      setError("Profil pengguna belum aktif. Hubungi Admin.");
      setBusy(false);
      return;
    }
    router.replace(profile.role === "petugas_presensi" || profile.role === "petugas_kantin" ? "/operator" : "/");
    router.refresh();
  }

  return <main className="login-screen"><section className="login-card">
    <div className="login-brand"><div className="brand-mark">L</div><div><strong>LEUWITEX</strong><span>People Operations</span></div></div>
    <div className="login-intro"><div className="eyebrow"><span className="live-dot" /> SISTEM OPERASIONAL</div><h1>Selamat datang</h1><p>Masuk untuk mengelola presensi dan voucher makan.</p></div>
    <form className="login-form" onSubmit={handleSubmit}>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nama@perusahaan.com" /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Masukkan password" /></label>
      {error && <div className="form-alert" role="alert">{error}</div>}
      <button className="submit-button" type="submit" disabled={busy}>{busy ? "Memeriksa…" : "Masuk"}</button>
    </form>
    <p className="login-footnote">Akses diberikan oleh Admin sistem.</p>
  </section></main>;
}
