<?php
// Read-only runtime diagnostics, accessible only through an existing admin session.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
try {
    $config = require __DIR__ . '/config.php';
    session_name(isset($config['session_name']) ? $config['session_name'] : 'manager_app_session');
    session_start();
    $pdo = new PDO(sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $config['db_host'], $config['db_name']), $config['db_user'], $config['db_password']);
    $query = $pdo->prepare('SELECT role FROM manager_users WHERE id = ?');
    $query->execute([isset($_SESSION['manager_user_id']) ? $_SESSION['manager_user_id'] : 0]);
    if ($query->fetchColumn() !== 'admin') { http_response_code(403); echo '{"error":"Admin required"}'; exit; }
    $result = ['phpVersion' => PHP_VERSION, 'randomBytes' => function_exists('random_bytes')];
    if (function_exists('shell_exec')) {
        $result['payoutsLint'] = trim((string) shell_exec(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg(__DIR__ . '/payouts.php') . ' 2>&1'));
    }
    echo json_encode($result);
} catch (Exception $error) {
    http_response_code(503); echo '{"error":"Diagnostic unavailable"}';
}
