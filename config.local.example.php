<?php
// Salin file ini menjadi config.local.php untuk menjalankan aplikasi
// secara lokal (XAMPP). File config.local.php TIDAK ikut commit
// (sudah ada di .gitignore), jadi kredensial lokal tidak bocor ke repo.
// config.php akan memakai file ini bila ada (setelah environment variable).
// Untuk hosting: upload file ini sebagai config.local.php (jangan commit),
// lalu isi dengan kredensial baru SETELAH password DB dirotasi di panel hosting.
define('DB_HOST', '127.0.0.1');
define('DB_PORT', '3306');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'absensi_qr');
