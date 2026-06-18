<?php
header('Content-Type: application/json; charset=utf-8');

$configPath = __DIR__ . '/config.local.php';
$lint = function ($path) {
    if (!function_exists('shell_exec')) {
        return 'shell_exec unavailable';
    }
    return trim((string) shell_exec(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($path) . ' 2>&1'));
};
echo json_encode([
    'phpVersion' => PHP_VERSION,
    'configPresent' => is_file($configPath),
    'pdoMysql' => extension_loaded('pdo_mysql'),
    'indexLint' => $lint(__DIR__ . '/index.php'),
    'configLint' => is_file($configPath) ? $lint($configPath) : 'missing',
]);
