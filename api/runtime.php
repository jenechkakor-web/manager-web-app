<?php
header('Content-Type: application/json; charset=utf-8');

$configPath = __DIR__ . '/config.local.php';
echo json_encode([
    'phpVersion' => PHP_VERSION,
    'configPresent' => is_file($configPath),
    'pdoMysql' => extension_loaded('pdo_mysql'),
]);
