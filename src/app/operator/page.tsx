"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Html5Qrcode } from "html5-qrcode";
import { createClient } from "@/lib/supabase/client";

type Operation = "check_in" | "check_out" | "claim";
type VoucherKind = "reguler" | "lembur";

export default function OperatorPage() {
  const router = useRouter();
  const supabase = useMemo(() => { try { return createClient(); } catch { return null; } }, []);
  const scanner = useRef<Html5Qrcode | null>(null);
  const processing = useRef(false);
  const [role, setRole] = useState("");
  const [name, setName] = useState("Petugas");
  const [operation, setOperation] = useState<Operation>("check_in");
  const [voucherKind, setVoucherKind] = useState<VoucherKind>("reguler");
  const [token, setToken] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "info">("info");
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (!supabase) { setMessage("Supabase belum dikonfigurasi. Lengkapi .env.local terlebih dahulu."); return; }
    let cancelled = false;
    void (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) { router.replace("/login"); return; }
      const { data: profile } = await supabase.from("profiles").select("display_name, role, is_active").eq("id", authData.user.id).single();
      if (!profile?.is_active) { router.replace("/login"); return; }
      if (!cancelled) {
        setRole(profile.role);
        setName(profile.display_name || "Petugas");
        setAuthorized(["admin", "petugas_presensi", "petugas_kantin"].includes(profile.role));
        if (profile.role === "petugas_kantin") setOperation("claim");
        if (!["admin", "petugas_presensi", "petugas_kantin"].includes(profile.role)) setMessage("Akun ini hanya memiliki akses monitoring Personalia.");
      }
    })();
    return () => { cancelled = true; void stopCamera(); };
  }, [supabase, router]);

  async function stopCamera() {
    const activeScanner = scanner.current;
    scanner.current = null;
    setScanning(false);
    if (!activeScanner) return;
    try { await activeScanner.stop(); } catch { /* scanner may already have stopped */ }
    try { activeScanner.clear(); } catch { /* camera target may already be removed */ }
  }

  async function processToken(qrToken: string) {
    if (!supabase || busy || !authorized) return;
    setBusy(true);
    setMessage("");
    const rpcName = operation === "check_in" ? "check_in_by_qr" : operation === "check_out" ? "check_out_by_qr" : "claim_meal_voucher_by_qr";
    const args = operation === "claim" ? { p_qr_token: qrToken, p_kind: voucherKind } : { p_qr_token: qrToken };
    const { data, error } = await supabase.rpc(rpcName, args);
    setToken("");
    if (error) {
      setMessage(error.message);
      setMessageType("error");
      setBusy(false);
      return;
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (operation === "check_in") setMessage(`Check-in berhasil — ${result?.employee_name || "karyawan"}. Voucher reguler diterbitkan.`);
    else if (operation === "check_out") setMessage(result?.overtime_meal_eligible
      ? `Check-out berhasil — ${result?.employee_name || "karyawan"} berhak mendapat voucher makan lembur.`
      : `Check-out berhasil — ${result?.employee_name || "karyawan"}. Tidak memenuhi syarat voucher lembur.`);
    else setMessage(`Klaim voucher ${voucherKind} berhasil — ${result?.employee_name || "karyawan"}.`);
    setMessageType("success");
    setBusy(false);
  }

  async function startCamera() {
    if (scanner.current || !authorized) return;
    setMessage("");
    try {
      const instance = new Html5Qrcode("qr-reader");
      scanner.current = instance;
      await instance.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 } }, async (decodedText) => {
        if (processing.current) return;
        processing.current = true;
        await stopCamera();
        await processToken(decodedText);
        processing.current = false;
      }, () => {});
      setScanning(true);
    } catch (error) {
      scanner.current = null;
      setScanning(false);
      setMessage(error instanceof Error ? error.message : "Kamera tidak dapat diakses.");
      setMessageType("error");
    }
  }

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token.trim()) await processToken(token.trim());
  }

  async function logout() {
    await stopCamera();
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
  }

  const canAttend = role === "admin" || role === "petugas_presensi";
  const canClaim = role === "admin" || role === "petugas_kantin";

  return <main className="operator-page">
    <header className="operator-header"><a className="brand-lockup" href="/"><div className="brand-mark">L</div><div><strong>LEUWITEX</strong><span>People Operations</span></div></a><div className="operator-user"><span>{name}</span><button onClick={() => void logout()}>Keluar</button></div></header>
    <section className="operator-content">
      <a className="back-link" href="/">← Kembali ke monitoring</a>
      <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" /> PETUGAS OPERASIONAL</div><h1>Presensi &amp; klaim voucher</h1><p>Pindai QR statis pada ID Card karyawan.</p></div></div>
      {!authorized ? <div className="operator-card form-alert">{message || "Memeriksa akses akun…"}</div> : <>
        <section className="operator-card">
          <div className="operation-tabs">
            {canAttend && <><button disabled={scanning || busy} className={operation === "check_in" ? "selected" : ""} onClick={() => setOperation("check_in")}>Check-in</button><button disabled={scanning || busy} className={operation === "check_out" ? "selected" : ""} onClick={() => setOperation("check_out")}>Check-out</button></>}
            {canClaim && <button disabled={scanning || busy} className={operation === "claim" ? "selected" : ""} onClick={() => setOperation("claim")}>Klaim kantin</button>}
          </div>
          {operation === "claim" && <div className="voucher-kind"><span>Jenis voucher yang diklaim</span><div><button disabled={scanning || busy} className={voucherKind === "reguler" ? "selected" : ""} onClick={() => setVoucherKind("reguler")}>Reguler</button><button disabled={scanning || busy} className={voucherKind === "lembur" ? "selected" : ""} onClick={() => setVoucherKind("lembur")}>Lembur</button></div></div>}
          <div className="camera-box"><div id="qr-reader" /><div className="camera-copy"><span className="camera-icon">⌗</span><strong>{scanning ? "Kamera aktif" : "Siap memindai QR"}</strong><span>{scanning ? "Arahkan kamera ke QR pada ID Card karyawan." : "Izinkan akses kamera untuk memulai pemindaian."}</span><button className="submit-button" onClick={() => void (scanning ? stopCamera() : startCamera())}>{scanning ? "Hentikan kamera" : "Mulai kamera"}</button></div></div>
          <div className="manual-divider"><span>atau masukkan token hasil pemindaian</span></div>
          <form className="token-form" onSubmit={submitManual}><input aria-label="Token QR" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Token QR" autoComplete="off" /><button className="secondary-button" type="submit" disabled={!token.trim() || busy}>{busy ? "Memproses…" : "Proses"}</button></form>
          {message && <div className={`operation-message ${messageType}`} role="status">{message}</div>}
        </section>
        <p className="operator-hint">Semua waktu presensi dan aturan voucher divalidasi oleh server dalam zona waktu WIB.</p>
      </>}
    </section>
  </main>;
}
