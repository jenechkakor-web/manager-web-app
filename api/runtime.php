<?php
header('Content-Type: application/json; charset=utf-8');

$configPath = __DIR__ . '/config.local.php';
$lint = function ($path) {
    if (!function_exists('shell_exec')) {
        return 'shell_exec unavailable';
    }
    return trim((string) shell_exec(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($path) . ' 2>&1'));
};
$result = [
    'phpVersion' => PHP_VERSION,
    'configPresent' => is_file($configPath),
    'pdoMysql' => extension_loaded('pdo_mysql'),
    'indexLint' => $lint(__DIR__ . '/index.php'),
    'configLint' => is_file($configPath) ? $lint($configPath) : 'missing',
];

try {
    $config = require __DIR__ . '/config.php';
    $result['configLoaded'] = true;
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $config['db_host'], $config['db_name']);
    new PDO($dsn, $config['db_user'], $config['db_password']);
    $result['databaseConnected'] = true;
} catch (Exception $error) {
    $result['setupError'] = $error->getMessage();
}

echo json_encode($result);
