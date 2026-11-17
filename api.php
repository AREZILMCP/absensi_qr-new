<?php

require_once __DIR__ . '/config.php';

// Zona waktu server: WIB — semua validasi jam & timestamp scan memakai ini.
date_default_timezone_set('Asia/Jakarta');

// Sesi login (dipakai untuk membatasi endpoint khusus Admin)
ini_set('session.gc_maxlifetime', '43200');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
session_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$action = $_GET['action'] ?? '';

try {
  $pdo = getPDO();
  switch ($action) {
    case 'bootstrap': handleBootstrap($pdo); break;
    case 'sync':      handleSync($pdo);      break;
    case 'scan':      handleScan($pdo);      break;
    case 'login':     handleLogin($pdo);     break;
    case 'logout':    handleLogout();        break;
    case 'get_users':    handleGetUsers($pdo);    break;
    case 'save_user':    handleSaveUser($pdo);    break;
    case 'delete_user':  handleDeleteUser($pdo);  break;
    default:          jsonErr(404, "Action tidak dikenal: $action");
  }
} catch (Throwable $e) {
  $msg = $e->getMessage();

  if (stripos($msg, 'Unknown database') !== false) {
    $msg = 'Database "absensi_qr" tidak ditemukan. Import database.sql via phpMyAdmin.';
  } elseif (stripos($msg, "doesn't exist") !== false) {
    $msg = 'Tabel database belum lengkap. Import database.sql via phpMyAdmin.';
  } elseif (stripos($msg, 'Connection refused') !== false
         || stripos($msg, 'No such file or directory') !== false) {
    $msg = 'Tidak dapat terhubung ke MySQL. Pastikan MySQL XAMPP sudah Start.';
  }

  jsonErr(500, $msg);
}

/* ============================================================
   HELPERS
   ============================================================ */
function jsonErr(int $code, string $msg): void {
  http_response_code($code);
  echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}
function jsonOk(array $data = []): void {
  echo json_encode(array_merge(['ok' => true], $data), JSON_UNESCAPED_UNICODE);
  exit;
}
function readBody(): array {
  $raw  = file_get_contents('php://input');
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}
function snakeToCamel(string $s): string {
  return lcfirst(str_replace('_', '', ucwords($s, '_')));
}
function boolColumns(): array {
  return [
    'karyawan'           => ['absen', 'makan', 'kupon_released', 'kartu_cetak'],
    'reservasi_manual'   => ['released'],
    'reservasi_archive'  => ['released'],
    'overtime'           => ['auto_released'],
    'presensi'           => ['lembur'],
  ];
}
function rowsToCamel(array $rows, string $table): array {
  $bool = boolColumns()[$table] ?? [];
  return array_map(function ($row) use ($bool) {
    $out = [];
    foreach ($row as $k => $v) {
      $camel = snakeToCamel($k);
      if (in_array($k, $bool, true) && $v !== null) {
        $v = (bool)$v;
      }
      $out[$camel] = $v;
    }
    return $out;
  }, $rows);
}
function b($v): int { return $v ? 1 : 0; }
function n($v)     { return ($v === null || $v === '') ? null : $v; }

function requireAdmin(): void {
  if (($_SESSION['role'] ?? '') !== 'admin') {
    jsonErr(403, 'Akses ditolak. Hanya Admin yang dapat mengelola user. Jika Anda Admin, silakan logout lalu login ulang.');
  }
}

function requireLogin(): void {
  if (empty($_SESSION['uid'])) {
    jsonErr(401, 'Sesi login habis. Silakan login ulang.');
  }
}

function handleLogout(): void {
  $_SESSION = [];
  if (session_status() === PHP_SESSION_ACTIVE) session_destroy();
  jsonOk();
}

function reqId(array $r): string {
  return trim((string)($r['id'] ?? ''));
}

/* ============================================================
   ACTION: bootstrap
   ============================================================ */
function ensureSchema(PDO $pdo): void {
  // Auto-migrasi: kolom presensi pulang (aman dijalankan berulang)
  $c = $pdo->query("SHOW COLUMNS FROM karyawan LIKE 'pulang_at'")->fetch();
  if (!$c) {
    $pdo->exec("ALTER TABLE karyawan ADD COLUMN pulang_at VARCHAR(30) NULL AFTER absen_at");
  }
  // Kolom status kupon (Fase 1: TERBIT -> DITEBUS) + arsip ditebus (Fase 2)
  foreach ([
    ['karyawan', 'kupon_status', 'VARCHAR(20) NULL AFTER kupon_released_at'],
    ['karyawan', 'kupon_ditebus_at', 'VARCHAR(30) NULL AFTER kupon_status'],
    ['karyawan', 'kupon_jenis', 'VARCHAR(20) NULL AFTER kupon_ditebus_at'],
    ['reservasi_archive', 'ditebus', 'VARCHAR(10) NULL AFTER released_at'],
    ['reservasi_archive', 'ditebus_at', 'VARCHAR(30) NULL AFTER ditebus'],
  ] as [$table, $col, $def]) {
    $c = $pdo->query("SHOW COLUMNS FROM $table LIKE '$col'")->fetch();
    if (!$c) {
      $pdo->exec("ALTER TABLE $table ADD COLUMN $col $def");
    }
  }
  // Tabel presensi (riwayat absensi masuk/pulang)
  $pdo->exec("CREATE TABLE IF NOT EXISTS presensi (
    id VARCHAR(80) PRIMARY KEY,
    karyawan_id VARCHAR(50) NULL,
    nama VARCHAR(150) NULL,
    bagian VARCHAR(100) NULL,
    tanggal VARCHAR(20) NULL,
    masuk_at VARCHAR(30) NULL,
    keluar_at VARCHAR(30) NULL,
    lembur TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_pr_karyawan (karyawan_id),
    INDEX idx_pr_tanggal (tanggal)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function handleBootstrap(PDO $pdo): void {
  requireLogin();
  ensureSchema($pdo);
  $karyawan         = $pdo->query('SELECT * FROM karyawan ORDER BY id ASC')->fetchAll();
  $riwayat          = $pdo->query('SELECT waktu, nama, jenis FROM riwayat ORDER BY id ASC LIMIT 100')->fetchAll();
  $jenisKartu       = $pdo->query('SELECT * FROM jenis_kartu ORDER BY id ASC')->fetchAll();
  $reservasiManual  = $pdo->query('SELECT * FROM reservasi_manual ORDER BY created_at DESC')->fetchAll();
  $reservasiArchive = $pdo->query('SELECT * FROM reservasi_archive ORDER BY archived_at DESC')->fetchAll();
  $overtime         = $pdo->query('SELECT * FROM overtime ORDER BY created_at DESC')->fetchAll();
  $presensi         = $pdo->query('SELECT * FROM presensi ORDER BY tanggal DESC, masuk_at DESC')->fetchAll();

  echo json_encode([
    'ok'                => true,
    'karyawan'          => rowsToCamel($karyawan, 'karyawan'),
    'riwayat'           => rowsToCamel($riwayat, 'riwayat'),
    'jenisKartu'        => rowsToCamel($jenisKartu, 'jenis_kartu'),
    'reservasiManual'   => rowsToCamel($reservasiManual, 'reservasi_manual'),
    'reservasiArchive'  => rowsToCamel($reservasiArchive, 'reservasi_archive'),
    'overtime'          => rowsToCamel($overtime, 'overtime'),
    'presensi'          => rowsToCamel($presensi, 'presensi'),
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

/* ============================================================
   ACTION: sync
   ============================================================ */
function handleSync(PDO $pdo): void {
  requireLogin();
  $data = readBody();

  $pdo->beginTransaction();
  try {
    if (isset($data['karyawan']))         syncKaryawan($pdo, $data['karyawan']);
    if (isset($data['riwayat']))          syncRiwayat($pdo, $data['riwayat']);
    if (isset($data['jenisKartu']))       syncJenisKartu($pdo, $data['jenisKartu']);
    if (isset($data['reservasiManual']))  syncReservasiManual($pdo, $data['reservasiManual']);
    if (isset($data['reservasiArchive'])) syncReservasiArchive($pdo, $data['reservasiArchive']);
    if (isset($data['overtime']))         syncOvertime($pdo, $data['overtime']);
    if (isset($data['presensi']))         syncPresensi($pdo, $data['presensi']);
    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
  }
  jsonOk();
}

function syncKaryawan(PDO $pdo, array $rows): void {
  $pdo->exec('DELETE FROM karyawan');
  $sql = 'INSERT INTO karyawan
    (id, nama, kategori, posisi, bagian, status, foto,
     absen, absen_at, pulang_at, makan, makan_at,
     kupon_kode, kupon_released, kupon_released_at,
     kupon_status, kupon_ditebus_at, kupon_jenis,
     kartu_cetak, kartu_cetak_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
  $stmt = $pdo->prepare($sql);
  foreach ($rows as $r) {
    if (!is_array($r)) continue;
    $id = reqId($r);
    if ($id === '') continue;

    $stmt->execute([
      $id,
      $r['nama']     ?? '',
      n($r['kategori'] ?? null),
      n($r['posisi']   ?? null),
      n($r['bagian']   ?? null),
      n($r['status']   ?? null),
      n($r['foto']     ?? null),
      b($r['absen'] ?? false),
      n($r['absenAt'] ?? null),
      n($r['pulangAt'] ?? null),
      b($r['makan'] ?? false),
      n($r['makanAt'] ?? null),
      n($r['kuponKode'] ?? null),
      isset($r['kuponReleased']) ? b($r['kuponReleased']) : null,
      n($r['kuponReleasedAt'] ?? null),
      n($r['kuponStatus'] ?? null),
      n($r['kuponDitebusAt'] ?? null),
      n($r['kuponJenis'] ?? null),
      b($r['kartuCetak'] ?? false),
      n($r['kartuCetakAt'] ?? null),
    ]);
  }
}

function syncRiwayat(PDO $pdo, array $rows): void {
  $pdo->exec('DELETE FROM riwayat');
  $ordered = array_reverse($rows);
  $stmt = $pdo->prepare('INSERT INTO riwayat (waktu, nama, jenis) VALUES (?,?,?)');
  foreach ($ordered as $r) {
    if (!is_array($r)) continue;
    $stmt->execute([
      $r['waktu'] ?? '',
      $r['nama']  ?? '',
      $r['jenis'] ?? '',
    ]);
  }
}

function syncJenisKartu(PDO $pdo, array $rows): void {
  $pdo->exec('DELETE FROM jenis_kartu');
  $stmt = $pdo->prepare('INSERT INTO jenis_kartu (id, nama, keterangan) VALUES (?,?,?)');
  foreach ($rows as $r) {
    if (!is_array($r)) continue;
    $id = reqId($r);
    if ($id === '') continue;
    $stmt->execute([
      $id,
      $r['nama'] ?? '',
      n($r['keterangan'] ?? null),
    ]);
  }
}

function syncReservasiManual(PDO $pdo, array $rows): void {
  $pdo->exec('DELETE FROM reservasi_manual');
  $stmt = $pdo->prepare('INSERT INTO reservasi_manual
    (id, kode, karyawan_id, nama, tanggal, lembur, tindakan,
     keterangan, released, released_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  foreach ($rows as $r) {
    if (!is_array($r)) continue;
    $id = reqId($r);
    if ($id === '') continue;
    $stmt->execute([
      $id,
      n($r['kode']     ?? null),
      $r['karyawanId'] ?? null,
      $r['nama']       ?? null,
      n($r['tanggal']  ?? null),
      n($r['lembur']   ?? null),
      n($r['tindakan'] ?? null),
      n($r['keterangan'] ?? null),
      b($r['released'] ?? false),
      n($r['releasedAt'] ?? null),
      n($r['createdAt']  ?? null),
    ]);
  }
}

function syncReservasiArchive(PDO $pdo, array $rows): void {
  $pdo->exec('DELETE FROM reservasi_archive');
  $stmt = $pdo->prepare('INSERT INTO reservasi_archive
    (id, kode, karyawan_id, nama, bagian, tanggal, lembur,
     tindakan, keterangan, released, released_at, archived_at,
     ditebus, ditebus_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  foreach ($rows as $r) {
    if (!is_array($r)) continue;
    $id = reqId($r);
    if ($id === '') continue;
    $stmt->execute([
      $id,
      n($r['kode']     ?? null),
      $r['karyawanId'] ?? null,
      $r['nama']       ?? null,
      n($r['bagian']   ?? null),
      n($r['tanggal']  ?? null),
      n($r['lembur']   ?? null),
      n($r['tindakan'] ?? null),
      n($r['keterangan'] ?? null),
      b($r['released'] ?? false),
      n($r['releasedAt'] ?? null),
      n($r['archivedAt'] ?? null),
      n($r['ditebus'] ?? null),
      n($r['ditebusAt'] ?? null),
    ]);
  }
}

function syncOvertime(PDO $pdo, array $rows): void {
  $pdo->exec('DELETE FROM overtime');
  $stmt = $pdo->prepare('INSERT INTO overtime
    (id, karyawan_id, nama, tanggal, status,
     created_at, released_at, auto_released)
    VALUES (?,?,?,?,?,?,?,?)');
  foreach ($rows as $r) {
    if (!is_array($r)) continue;
    $id = reqId($r);
    if ($id === '') continue;
    $stmt->execute([
      $id,
      $r['karyawanId'] ?? null,
      $r['nama']       ?? null,
      n($r['tanggal']  ?? null),
      n($r['status']   ?? null),
      n($r['createdAt']    ?? null),
      n($r['releasedAt']   ?? null),
      b($r['autoReleased'] ?? false),
    ]);
  }
}

function syncPresensi(PDO $pdo, array $rows): void {
  $pdo->exec('DELETE FROM presensi');
  $stmt = $pdo->prepare('INSERT INTO presensi
    (id, karyawan_id, nama, bagian, tanggal, masuk_at, keluar_at, lembur)
    VALUES (?,?,?,?,?,?,?,?)');
  foreach ($rows as $r) {
    if (!is_array($r)) continue;
    $id = reqId($r);
    if ($id === '') continue;
    $stmt->execute([
      $id,
      $r['karyawanId'] ?? null,
      $r['nama']       ?? null,
      n($r['bagian']   ?? null),
      n($r['tanggal']  ?? null),
      n($r['masukAt']  ?? null),
      n($r['keluarAt'] ?? null),
      b($r['lembur']   ?? false),
    ]);
  }
}

/* ============================================================
   ACTION: login
   ============================================================ */
function handleLogin(PDO $pdo): void {
  $data     = readBody();
  $username = trim((string)($data['username'] ?? ''));
  $password = (string)($data['password'] ?? '');

  if ($username === '' || $password === '') {
    jsonErr(400, 'Username dan password wajib diisi.');
  }

  $totalUsers = 0;
  try {
    $totalUsers = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
  } catch (Throwable $e) {
    jsonErr(500, 'Tabel "users" belum ada. Import database.sql via phpMyAdmin.');
  }

  if ($totalUsers === 0) {
    jsonErr(503, 'Database belum memiliki user. Silakan jalankan query INSERT user pada database Anda.');
  }

  // Ambil data user beserta role dan permissions
  $stmt = $pdo->prepare('SELECT id, username, name, password_hash, role, is_active, permissions FROM users WHERE username = ? LIMIT 1');
  $stmt->execute([$username]);
  $u = $stmt->fetch();

  if (!$u || !password_verify($password, $u['password_hash'])) {
    jsonErr(401, 'Username atau password salah.');
  }

  if ((int)$u['is_active'] === 0) {
    jsonErr(403, 'Akun Anda dinonaktifkan. Hubungi Admin.');
  }

  session_regenerate_id(true);
  $_SESSION['uid']  = (int)$u['id'];
  $_SESSION['role'] = $u['role'] ?? 'user';

  jsonOk([
    'user' => [
      'id'          => $u['id'],
      'username'    => $u['username'],
      'name'        => $u['name'],
      'role'        => $u['role'] ?? 'user',
      'permissions' => $u['permissions'] ? json_decode($u['permissions'], true) : (object)[]
    ]
  ]);
}

/* ============================================================
   ACTION: get_users (Hanya untuk Admin)
   ============================================================ */
function handleGetUsers(PDO $pdo): void {
  requireAdmin();
  // Catatan: Di produksi, pastikan ada validasi token/session admin di sini.
  $stmt = $pdo->query('SELECT id, username, name, role, is_active, permissions FROM users ORDER BY id ASC');
  $users = $stmt->fetchAll();
  
  // Parse permissions JSON string ke array/object
  foreach ($users as &$u) {
    $u['permissions'] = $u['permissions'] ? json_decode($u['permissions'], true) : (object)[];
  }

  jsonOk(['users' => $users]);
}

/* ============================================================
   ACTION: save_user (Tambah/Edit)
   ============================================================ */
function handleSaveUser(PDO $pdo): void {
  requireAdmin();
  $data = readBody();
  $id = isset($data['id']) ? (int)$data['id'] : 0;
  $username = trim($data['username'] ?? '');
  $name = trim($data['name'] ?? '');
  $password = $data['password'] ?? '';
  $role = $data['role'] ?? 'user';
  $isActive = isset($data['isActive']) ? (int)$data['isActive'] : 1;
  $permissions = isset($data['permissions']) ? json_encode($data['permissions']) : '[]';

  if (!$username || !$name) {
    jsonErr(400, 'Username dan Nama wajib diisi.');
  }

  if ($id > 0) {
    // Mode Edit
    if ($password !== '') {
      $hash = password_hash($password, PASSWORD_DEFAULT);
      $stmt = $pdo->prepare('UPDATE users SET username=?, name=?, password_hash=?, role=?, is_active=?, permissions=? WHERE id=?');
      $stmt->execute([$username, $name, $hash, $role, $isActive, $permissions, $id]);
    } else {
      $stmt = $pdo->prepare('UPDATE users SET username=?, name=?, role=?, is_active=?, permissions=? WHERE id=?');
      $stmt->execute([$username, $name, $role, $isActive, $permissions, $id]);
    }
  } else {
    // Mode Tambah
    if ($password === '') jsonErr(400, 'Password wajib diisi untuk user baru.');
    $hash = password_hash($password, PASSWORD_DEFAULT);
    try {
      $stmt = $pdo->prepare('INSERT INTO users (username, name, password_hash, role, is_active, permissions) VALUES (?,?,?,?,?,?)');
      $stmt->execute([$username, $name, $hash, $role, $isActive, $permissions]);
    } catch (Exception $e) {
      jsonErr(400, 'Username sudah digunakan atau terjadi kesalahan.');
    }
  }
  jsonOk();
}

/* ============================================================
   ACTION: delete_user
   ============================================================ */
function handleDeleteUser(PDO $pdo): void {
  requireAdmin();
  $data = readBody();
  $id = isset($data['id']) ? (int)$data['id'] : 0;
  if ($id <= 0) jsonErr(400, 'ID tidak valid.');
  if ($id === (int)($_SESSION['uid'] ?? 0)) jsonErr(400, 'Tidak dapat menghapus akun yang sedang digunakan.');
  
  $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
  jsonOk();
}

/* ============================================================
   ACTION: scan — validasi & pencatatan scan dari server (Fase 2)
   Aturan jam memakai JAM SERVER (WIB), bukan jam perangkat klien.
   Klien memanggil endpoint ini bila mode server (bukan Mode Demo,
   bukan simulasi); bila server tidak terjangkau / sesi habis,
   klien fallback ke logika lokal. Semua tulis dibungkus transaksi.
   Pesan dikembalikan sama persis dengan pesan logika lokal klien,
   supaya hasil scan konsisten di kedua jalur.
   ============================================================ */
function scanNextKode(PDO $pdo, string $prefix, array $tables): string {
  $max = 0;
  foreach ($tables as $t) {
    [$table, $col] = $t;
    try {
      $rows = $pdo->query('SELECT ' . $col . ' FROM ' . $table . ' WHERE ' . $col . ' LIKE ' . $pdo->quote($prefix . '%'))->fetchAll(PDO::FETCH_COLUMN);
      foreach ($rows as $kode) {
        $seq = (int)substr((string)$kode, strlen($prefix));
        if ($seq > $max) $max = $seq;
      }
    } catch (Throwable $e) { /* tabel/kolom belum ada — abaikan */ }
  }
  return $prefix . str_pad((string)($max + 1), 3, '0', STR_PAD_LEFT);
}

function scanKaryawan(PDO $pdo, string $id): ?array {
  $stmt = $pdo->prepare('SELECT * FROM karyawan WHERE id = ? LIMIT 1');
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  return $row ?: null;
}

function scanIsToday($v, string $today): bool {
  return $v !== null && $v !== '' && substr((string)$v, 0, 10) === $today;
}

function scanNewId(): string {
  return 'RV-ARCH-' . time() . '-' . bin2hex(random_bytes(4));
}

function scanClearKupon(PDO $pdo, array &$k): void {
  $pdo->prepare('UPDATE karyawan SET makan = 0, makan_at = NULL, kupon_kode = NULL, kupon_released = NULL, kupon_released_at = NULL, kupon_status = NULL, kupon_ditebus_at = NULL, kupon_jenis = NULL WHERE id = ?')->execute([$k['id']]);
  $k['makan'] = 0; $k['makan_at'] = null; $k['kupon_kode'] = null;
  $k['kupon_released'] = null; $k['kupon_released_at'] = null;
  $k['kupon_status'] = null; $k['kupon_ditebus_at'] = null; $k['kupon_jenis'] = null;
}

function scanInsertRiwayat(PDO $pdo, string $waktu, string $nama, string $jenis): void {
  $pdo->prepare('INSERT INTO riwayat (waktu, nama, jenis) VALUES (?,?,?)')->execute([$waktu, $nama, $jenis]);
}

function scanArchiveKupon(PDO $pdo, array $k, string $keterangan, string $nowIso, string $lembur): void {
  $pdo->prepare('INSERT INTO reservasi_archive
    (id, kode, karyawan_id, nama, bagian, tanggal, lembur, tindakan, keterangan, released, released_at, archived_at, ditebus, ditebus_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
    scanNewId(), $k['kupon_kode'] ?? '', $k['id'], $k['nama'], $k['bagian'] ?? '',
    $k['makan_at'], $lembur, 'Ambil', $keterangan,
    ($k['kupon_released'] ?? null) !== null ? (int)(bool)$k['kupon_released'] : 1,
    $k['kupon_released_at'] ?? $k['makan_at'], $nowIso,
    ($k['kupon_status'] ?? '') === 'ditebus' ? 'Ya' : 'Tidak',
    $k['kupon_ditebus_at'] ?? '',
  ]);
}

function scanArchiveStaleMeal(PDO $pdo, array &$k, string $today, string $nowIso): bool {
  if (empty($k['makan']) || empty($k['makan_at'])) return false;
  if (scanIsToday($k['makan_at'], $today)) return false;

  $hariMakan = substr($k['makan_at'], 0, 10);
  $stmt = $pdo->prepare("SELECT COUNT(*) FROM reservasi_archive WHERE karyawan_id = ? AND LOWER(keterangan) LIKE '%lembur%' AND SUBSTR(archived_at,1,10) = ?");
  $stmt->execute([$k['id'], $hariMakan]);
  $kuponTambahan = ((int)$stmt->fetchColumn()) > 0;

  scanArchiveKupon($pdo, $k, 'Siklus harian', $nowIso, $kuponTambahan ? 'Ya' : 'Tidak');
  scanClearKupon($pdo, $k);
  return true;
}

function scanAutoResetLembur(PDO $pdo, array &$k, string $today, string $nowIso): bool {
  $stmt = $pdo->prepare('SELECT COUNT(*) FROM overtime WHERE karyawan_id = ? AND SUBSTR(tanggal,1,10) = ?');
  $stmt->execute([$k['id'], $today]);
  if ((int)$stmt->fetchColumn() > 0) return false;
  $stmt = $pdo->prepare("SELECT COUNT(*) FROM reservasi_archive WHERE karyawan_id = ? AND LOWER(keterangan) LIKE '%lembur%' AND SUBSTR(archived_at,1,10) = ?");
  $stmt->execute([$k['id'], $today]);
  if ((int)$stmt->fetchColumn() > 0) return false;

  scanArchiveStaleMeal($pdo, $k, $today, $nowIso);

  if (!empty($k['makan']) && scanIsToday($k['makan_at'] ?? null, $today)) {
    scanArchiveKupon($pdo, $k, 'Reset otomatis lembur (presensi pulang)', $nowIso, 'Tidak');
    scanClearKupon($pdo, $k);
  }

  $stmt = $pdo->prepare('SELECT id, kode, tanggal, tindakan, released, released_at, created_at FROM reservasi_manual WHERE karyawan_id = ? AND SUBSTR(COALESCE(tanggal, created_at),1,10) = ?');
  $stmt->execute([$k['id'], $today]);
  $manual = $stmt->fetchAll();
  foreach ($manual as $r) {
    $pdo->prepare('INSERT INTO reservasi_archive
      (id, kode, karyawan_id, nama, bagian, tanggal, lembur, tindakan, keterangan, released, released_at, archived_at, ditebus, ditebus_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
      scanNewId(), $r['kode'] ?? '', $k['id'], $k['nama'], $k['bagian'] ?? '',
      $r['tanggal'] ?? $nowIso, 'Tidak', $r['tindakan'] ?? 'Ambil', 'Reset otomatis lembur (presensi pulang)',
      (int)(bool)($r['released'] ?? 0), $r['released_at'] ?? null, $nowIso,
      !empty($r['released']) ? 'Ya' : 'Tidak', $r['released_at'] ?? null,
    ]);
  }
  if (count($manual) > 0) {
    $pdo->prepare('DELETE FROM reservasi_manual WHERE karyawan_id = ? AND SUBSTR(COALESCE(tanggal, created_at),1,10) = ?')->execute([$k['id'], $today]);
  }

  $otId = scanNextKode($pdo, 'OT-' . date('ym') . '-', [['overtime', 'id']]);
  $pdo->prepare('INSERT INTO overtime (id, karyawan_id, nama, tanggal, status, created_at, released_at, auto_released) VALUES (?,?,?,?,?,?,?,?)')->execute([
    $otId, $k['id'], $k['nama'], $today, 'aktif', $nowIso, null, 1,
  ]);
  return true;
}

function scanFormatDurasi(int $menit): string {
  if ($menit < 60) return $menit . ' menit';
  $j = intdiv($menit, 60);
  $s = $menit % 60;
  return $s === 0 ? $j . ' jam' : $j . ' jam ' . $s . ' menit';
}

function handleScan(PDO $pdo): void {
  requireLogin();

  $data = readBody();
  $kode = trim((string)($data['kode'] ?? ''));
  $mode = ($data['mode'] ?? 'presensi') === 'kantin' ? 'kantin' : 'presensi';

  if ($kode === '') jsonErr(400, 'Kode karyawan wajib diisi.');

  $now = new DateTime('now');
  $today = $now->format('Y-m-d');
  $nowIso = $now->format('Y-m-d\TH:i:s');
  $waktuServer = $now->format('H:i:s');
  $waktuRiwayat = $now->format('d/m/Y, H.i.s');
  $menit = ((int)$now->format('H')) * 60 + ((int)$now->format('i'));
  // Model DINAMIS berbasis jam (17 Nov 2026) — sama dengan
  // js/scanner.js decideScan(). Jam yang menentukan arti scan.
  $menitMasukMax = 8 * 60;     // 08:00 tepat waktu
  $menitToleransi = 15;         // sampai 08:15 terlambat, lewat itu block
  $menitMakanMulai = 12 * 60;   // 12:00 jendela makan siang (inklusif)
  $menitMakanAkhir = 13 * 60;   // 13:00 batas akhir jendela (eksklusif: 13:00 sudah lewat jendela)
  $menitPulang = 16 * 60;       // 16:00 check-out; lewat itu lembur
  $menitLemburMakan = 120;      // ekstra makan bila lembur >= 120 mnt (>= 18:00)

  $k = scanKaryawan($pdo, $kode);
  if (!$k) {
    jsonOk(['result' => [
      'type' => 'err', 'message' => 'QR tidak dikenali: ' . $kode, 'aksi' => 'err',
      'karyawan' => null, 'riwayatJenis' => null, 'riwayatTambahan' => null, 'lembur' => false,
      'nowIso' => $nowIso, 'waktuServer' => $waktuServer,
    ]]);
  }
  if (in_array(strtolower((string)($k['status'] ?? '')), ['non-aktif', 'nonaktif'], true)) {
    jsonOk(['result' => [
      'type' => 'err', 'message' => 'Karyawan Non-Aktif — absensi & kupon ditolak', 'aksi' => 'err',
      'karyawan' => rowsToCamel([$k], 'karyawan')[0], 'riwayatJenis' => null, 'riwayatTambahan' => null, 'lembur' => false,
      'nowIso' => $nowIso, 'waktuServer' => $waktuServer,
    ]]);
  }

  $pdo->beginTransaction();
  try {
    // Bersihkan makan kemarin (sama seperti logika lokal klien)
    scanArchiveStaleMeal($pdo, $k, $today, $nowIso);

    $absenToday = !empty($k['absen']) && scanIsToday($k['absen_at'] ?? null, $today);
    $pulangToday = !empty($k['pulang_at']) && scanIsToday($k['pulang_at'], $today);
    $pulangMenit = null;
    if ($pulangToday && !empty($k['pulang_at'])) {
      $pulangMenit = ((int)substr((string)$k['pulang_at'], 11, 2)) * 60 + ((int)substr((string)$k['pulang_at'], 14, 2));
    }
    $jenis = (($k['kupon_jenis'] ?? 'reguler') === 'lembur') ? 'lembur' : 'reguler';
    $makanSiangToday = !empty($k['makan']) && scanIsToday($k['makan_at'] ?? null, $today) && $jenis === 'reguler' && ($k['kupon_status'] ?? '') === 'ditebus';
    $ekstraMakanToday = !empty($k['makan']) && scanIsToday($k['makan_at'] ?? null, $today) && $jenis === 'lembur' && ($k['kupon_status'] ?? '') === 'ditebus';

    $type = 'ok'; $message = ''; $aksi = ''; $riwayatJenis = null; $riwayatTambahan = null; $lembur = false;

    if ($mode === 'kantin') {
      // Kupon OTOMATIS terbit + ditebus dalam satu scan (model dinamis).
      // Kupon reservasi manual TIDAK disentuh di sini; jalurnya tetap
      // Release Reservasi.
      // Jendela makan siang 12:00 <= t < 13:00 (13:00 sudah lewat jendela).
      $jamMakan = $menit >= $menitMakanMulai && $menit < $menitMakanAkhir;
      $jamEkstra = $menit >= $menitPulang + $menitLemburMakan; // >= 18:00
      // Syarat dulu: makan butuh check-in hari ini (berlaku di semua jam).
      if (!$absenToday) {
        $type = 'warn'; $aksi = 'tolak';
        $message = 'Belum absen masuk — makan butuh absensi masuk hari ini';
      } elseif ($menit < $menitMakanMulai) {
        // Pagi: sebelum jendela makan siang.
        $type = 'warn'; $aksi = 'tolak';
        $message = 'Belum waktunya makan — makan siang 12:00–13:00';
      } elseif ($jamMakan) {
        if ($makanSiangToday) {
          $type = 'warn'; $aksi = 'tolak';
          $message = 'Sudah ambil makan siang hari ini';
        } else {
          $kuponKode = scanNextKode($pdo, 'TR-' . $now->format('ym') . '-', [['reservasi_manual', 'kode'], ['reservasi_archive', 'kode'], ['karyawan', 'kupon_kode']]);
          $pdo->prepare('UPDATE karyawan SET makan = 1, makan_at = ?, kupon_kode = ?, kupon_released = 1, kupon_released_at = ?, kupon_status = ?, kupon_jenis = ?, kupon_ditebus_at = ? WHERE id = ?')->execute([
            $nowIso, $kuponKode, $nowIso, 'ditebus', 'reguler', $nowIso, $k['id'],
          ]);
          $k['makan'] = 1; $k['makan_at'] = $nowIso; $k['kupon_kode'] = $kuponKode;
          $k['kupon_released'] = 1; $k['kupon_released_at'] = $nowIso;
          $k['kupon_status'] = 'ditebus'; $k['kupon_jenis'] = 'reguler'; $k['kupon_ditebus_at'] = $nowIso;
          scanInsertRiwayat($pdo, $waktuRiwayat, $k['nama'], 'Makan Siang');
          $type = 'ok'; $aksi = 'makan-siang'; $riwayatJenis = 'Makan Siang';
          $message = 'Makan siang berhasil — kupon otomatis terbit, silakan ambil makanan';
        }
      } elseif ($menit < $menitPulang) {
        // 13:00–16:00: jendela makan siang sudah lewat.
        if ($makanSiangToday) {
          $type = 'warn'; $aksi = 'tolak';
          $message = 'Sudah ambil makan siang hari ini';
        } else {
          $type = 'warn'; $aksi = 'tolak';
          $message = 'Sudah lewat jam makan siang — makan siang 12:00–13:00';
        }
      } elseif (!$jamEkstra) {
        // 16:00–18:00: lembur, ekstra makan baru mulai 18:00.
        $type = 'warn'; $aksi = 'tolak';
        $message = 'Belum dapat ekstra makan — ekstra makan mulai 18:00';
      } else {
        // jamEkstra (>= 18:00) — karyawan MASIH KERJA: ekstra makan TIDAK
        // mensyaratkan sudah absen pulang. Lembur diukur dari jam saat ini.
        $lemburMenit = max(0, $menit - $menitPulang);
        if ($ekstraMakanToday) {
          $type = 'warn'; $aksi = 'tolak';
          $message = 'Sudah ambil ekstra makan hari ini';
        } else {
          // Arsipkan kupon makan siang sebelum diganti kupon lembur.
          if (!empty($k['makan']) && scanIsToday($k['makan_at'] ?? null, $today)) {
            scanArchiveKupon($pdo, $k, 'Makan siang (diganti kupon lembur)', $nowIso, 'Tidak');
          }
          $kuponKode = scanNextKode($pdo, 'TR-' . $now->format('ym') . '-', [['reservasi_manual', 'kode'], ['reservasi_archive', 'kode'], ['karyawan', 'kupon_kode']]);
          $pdo->prepare('UPDATE karyawan SET makan = 1, makan_at = ?, kupon_kode = ?, kupon_released = 1, kupon_released_at = ?, kupon_status = ?, kupon_jenis = ?, kupon_ditebus_at = ? WHERE id = ?')->execute([
            $nowIso, $kuponKode, $nowIso, 'ditebus', 'lembur', $nowIso, $k['id'],
          ]);
          $k['makan'] = 1; $k['makan_at'] = $nowIso; $k['kupon_kode'] = $kuponKode;
          $k['kupon_released'] = 1; $k['kupon_released_at'] = $nowIso;
          $k['kupon_status'] = 'ditebus'; $k['kupon_jenis'] = 'lembur'; $k['kupon_ditebus_at'] = $nowIso;
          scanInsertRiwayat($pdo, $waktuRiwayat, $k['nama'], 'Ekstra Makan');
          $type = 'ok'; $aksi = 'ekstra-makan'; $riwayatJenis = 'Ekstra Makan'; $lembur = true;
          $message = 'Ekstra makan berhasil — kupon lembur otomatis terbit, silakan ambil makanan';
        }
      }
    } elseif ($menit < $menitPulang) {
      // Pagi: check-in (atau tolak: belum jam pulang / block terlambat)
      if (!$absenToday) {
        if ($menit > $menitMasukMax + $menitToleransi) {
          $type = 'err'; $aksi = 'tolak';
          $message = 'Check-in ditutup — terlambat melewati 08:15';
        } else {
          $pdo->prepare('UPDATE karyawan SET absen = 1, absen_at = ?, pulang_at = NULL WHERE id = ?')->execute([$nowIso, $k['id']]);
          $k['absen'] = 1; $k['absen_at'] = $nowIso; $k['pulang_at'] = null;
          $prId = 'PR-' . str_replace('-', '', $today) . '-' . $k['id'];
          $pdo->prepare('INSERT INTO presensi (id, karyawan_id, nama, bagian, tanggal, masuk_at, keluar_at, lembur) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE masuk_at = VALUES(masuk_at)')->execute([
            $prId, $k['id'], $k['nama'], $k['bagian'] ?? '', $today, $nowIso, null, 0,
          ]);
          scanInsertRiwayat($pdo, $waktuRiwayat, $k['nama'], 'Absensi');
          $type = 'ok'; $aksi = 'masuk'; $riwayatJenis = 'Absensi';
          $message = 'Absensi masuk berhasil dicatat';
        }
      } else {
        $type = 'warn'; $aksi = 'tolak';
        $message = 'Belum jam pulang — check-out mulai 16:00';
      }
    } elseif (!$absenToday) {
      $type = 'warn'; $aksi = 'tolak';
      $message = 'Belum absen masuk hari ini';
    } elseif ($pulangToday) {
      $type = 'warn'; $aksi = 'tolak';
      $message = 'Sudah absen pulang hari ini';
    } else {
      // Check-out; lembur dihitung mulai lewat 16:00 (17:00 = 1 jam).
      // Tidak ada lagi reset kupon lembur di sini — kupon lembur
      // diterbitkan terpisah di kantin (ekstra makan).
      $lemburMenit = $menit - $menitPulang;
      $lembur = $lemburMenit > 0;
      $pdo->prepare('UPDATE karyawan SET pulang_at = ? WHERE id = ?')->execute([$nowIso, $k['id']]);
      $k['pulang_at'] = $nowIso;
      $prId = 'PR-' . str_replace('-', '', $today) . '-' . $k['id'];
      $stmt = $pdo->prepare('UPDATE presensi SET keluar_at = ?, lembur = ? WHERE id = ?');
      $stmt->execute([$nowIso, $lembur ? 1 : 0, $prId]);
      if ($stmt->rowCount() === 0) {
        $pdo->prepare('INSERT INTO presensi (id, karyawan_id, nama, bagian, tanggal, masuk_at, keluar_at, lembur) VALUES (?,?,?,?,?,?,?,?)')->execute([
          $prId, $k['id'], $k['nama'], $k['bagian'] ?? '', $today, $k['absen_at'] ?? $nowIso, $nowIso, $lembur ? 1 : 0,
        ]);
      }
      scanInsertRiwayat($pdo, $waktuRiwayat, $k['nama'], 'Absensi Pulang');
      $type = 'ok'; $aksi = 'pulang'; $riwayatJenis = 'Absensi Pulang';
      $message = $lembur
        ? 'Absensi pulang dicatat — Lembur ' . scanFormatDurasi($lemburMenit)
        : 'Absensi pulang berhasil dicatat';
    }

    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
  }

  jsonOk(['result' => [
    'type' => $type, 'message' => $message, 'aksi' => $aksi,
    'karyawan' => rowsToCamel([$k], 'karyawan')[0],
    'riwayatJenis' => $riwayatJenis, 'riwayatTambahan' => $riwayatTambahan, 'lembur' => $lembur,
    'nowIso' => $nowIso, 'waktuServer' => $waktuServer,
  ]]);
}
