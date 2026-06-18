<?php

$localConfigPath = __DIR__ . '/config.local.php';
if (!is_file($localConfigPath)) {
    throw new RuntimeException('Server configuration is missing.');
}

$config = require $localConfigPath;
if (!is_array($config)) {
    throw new RuntimeException('Server configuration is invalid.');
}

$required = ['db_host', 'db_name', 'db_user', 'db_password', 'admin_login', 'admin_password'];
foreach ($required as $key) {
    if (!array_key_exists($key, $config) || trim((string) $config[$key]) === '') {
        throw new RuntimeException("Server configuration key {$key} is missing.");
    }
}

return $config;
