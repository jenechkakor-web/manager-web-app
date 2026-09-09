<?php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (strpos($path, '/api/') === 0) {
    $_GET['route'] = substr($path, 5);
    require getcwd() . '/api/index.php';
    return true;
}
return false;
