<?php

// Kredensial DB TIDAK ditulis di file ini (dulu plaintext di repo publik).
// Urutan: environment variable -> config.local.php (tidak ikut commit,
// upload manual ke hosting / salin dari config.local.example.php).
// Bila keduanya tidak ada, getPDO() gagal dengan pesan yang jelas.
foreach (['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASS', 'DB_NAME'] as $key) {
  $val = getenv($key);
  if ($val !== false && ($key === 'DB_PASS' || $val !== '')) define($key, $val);
}

if (file_exists(__DIR__ . '/config.local.php')) {
  require __DIR__ . '/config.local.php';
}

function getPDO(): PDO {
  static $pdo = null;
  if ($pdo === null) {
    foreach (['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'] as $key) {
      if (!defined($key)) {
        throw new RuntimeException('Kredensial database belum diatur. Atur environment variable DB_HOST/DB_USER/DB_PASS/DB_NAME atau sediakan config.local.php (lihat config.local.example.php).');
      }
    }
    if (!defined('DB_PORT')) define('DB_PORT', 3306);
    $dsn = sprintf(
      'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
      DB_HOST, DB_PORT, DB_NAME
    );
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
      PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
  }
  return $pdo;
}