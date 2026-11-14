<?php

// Override lokal (tidak ikut commit): bila file config.local.php ada,
// kredensial DB diambil dari sana; define() hosting di bawah dilewati.
if (file_exists(__DIR__ . '/config.local.php')) {
  require __DIR__ . '/config.local.php';
}

if (!defined('DB_HOST')) define('DB_HOST', 'sql213.infinityfree.com');
if (!defined('DB_PORT')) define('DB_PORT', 3306);
if (!defined('DB_USER')) define('DB_USER', 'if0_43308636');
if (!defined('DB_PASS')) define('DB_PASS', 'rezakurnia07');
if (!defined('DB_NAME')) define('DB_NAME', 'if0_43308636_absensi_qr');

function getPDO(): PDO {
  static $pdo = null;
  if ($pdo === null) {
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