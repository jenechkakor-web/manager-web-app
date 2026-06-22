<?php

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond($payload, $status = 200)
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function request_json()
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        respond(['error' => 'Некорректный JSON.'], 400);
    }
    return $decoded;
}

function require_same_origin()
{
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
    if ($origin === '') {
        return;
    }
    $originHost = parse_url($origin, PHP_URL_HOST);
    $requestHostParts = explode(':', isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '');
    $requestHost = $requestHostParts[0];
    if (!$originHost || !hash_equals(strtolower($requestHost), strtolower((string) $originHost))) {
        respond(['error' => 'Запрещенный источник запроса.'], 403);
    }
}

function open_database(array $config)
{
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $config['db_host'], $config['db_name']);
    return new PDO($dsn, $config['db_user'], $config['db_password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function has_column(PDO $pdo, $table, $column)
{
    $statement = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name AND COLUMN_NAME = :column_name');
    $statement->execute([':table_name' => $table, ':column_name' => $column]);
    return (int) $statement->fetchColumn() > 0;
}

function has_index(PDO $pdo, $table, $index)
{
    $statement = $pdo->prepare('SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name AND INDEX_NAME = :index_name');
    $statement->execute([':table_name' => $table, ':index_name' => $index]);
    return (int) $statement->fetchColumn() > 0;
}

function initialize_database(PDO $pdo, array $config)
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS manager_users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        login VARCHAR(64) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        created_at VARCHAR(40) NOT NULL,
        UNIQUE KEY unique_login (login)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $adminLogin = trim((string) $config['admin_login']);
    $statement = $pdo->prepare('SELECT id FROM manager_users WHERE login = :login LIMIT 1');
    $statement->execute([':login' => $adminLogin]);
    $adminId = (int) $statement->fetchColumn();
    if ($adminId === 0) {
        $statement = $pdo->prepare('INSERT INTO manager_users (login, password_hash, role, created_at)
            VALUES (:login, :password_hash, :role, :created_at)');
        $statement->execute([
            ':login' => $adminLogin,
            ':password_hash' => password_hash((string) $config['admin_password'], PASSWORD_DEFAULT),
            ':role' => 'admin',
            ':created_at' => gmdate('c'),
        ]);
        $adminId = (int) $pdo->lastInsertId();
    }

    $pdo->exec("CREATE TABLE IF NOT EXISTS manager_contracts (
        record_number VARCHAR(191) NOT NULL PRIMARY KEY,
        owner_id INT UNSIGNED NULL,
        contract_date VARCHAR(32) NOT NULL DEFAULT '',
        counterparty VARCHAR(255) NOT NULL DEFAULT '',
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        updated_at VARCHAR(40) NOT NULL,
        data_json LONGTEXT NOT NULL,
        KEY owner_id (owner_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    if (!has_column($pdo, 'manager_contracts', 'owner_id')) {
        $pdo->exec('ALTER TABLE manager_contracts ADD COLUMN owner_id INT UNSIGNED NULL AFTER record_number');
    }
    if (!has_index($pdo, 'manager_contracts', 'owner_id')) {
        $pdo->exec('ALTER TABLE manager_contracts ADD INDEX owner_id (owner_id)');
    }
    $statement = $pdo->prepare('UPDATE manager_contracts SET owner_id = :admin_id WHERE owner_id IS NULL');
    $statement->execute([':admin_id' => $adminId]);

    $pdo->exec("CREATE TABLE IF NOT EXISTS manager_tech_presets (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        group_name VARCHAR(191) NOT NULL,
        subgroup_name VARCHAR(191) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        UNIQUE KEY unique_title (title)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    return $adminId;
}

function public_user(array $row)
{
    return [
        'id' => (int) $row['id'],
        'login' => (string) $row['login'],
        'role' => $row['role'] === 'admin' ? 'admin' : 'user',
        'createdAt' => isset($row['created_at']) ? (string) $row['created_at'] : '',
    ];
}

function current_user(PDO $pdo)
{
    $userId = isset($_SESSION['manager_user_id']) ? (int) $_SESSION['manager_user_id'] : 0;
    if ($userId === 0) {
        return null;
    }
    $statement = $pdo->prepare('SELECT id, login, role, created_at FROM manager_users WHERE id = :id LIMIT 1');
    $statement->execute([':id' => $userId]);
    $row = $statement->fetch();
    if (!$row) {
        unset($_SESSION['manager_user_id']);
        return null;
    }
    return public_user($row);
}

function require_user(PDO $pdo)
{
    $user = current_user($pdo);
    if (!$user) {
        respond(['error' => 'Требуется вход в систему.'], 401);
    }
    return $user;
}

function require_admin(PDO $pdo)
{
    $user = require_user($pdo);
    if ($user['role'] !== 'admin') {
        respond(['error' => 'Недостаточно прав.'], 403);
    }
    return $user;
}

function normalize_record(array $record)
{
    $data = isset($record['data']) && is_array($record['data']) ? $record['data'] : [];
    if (isset($record['number'])) {
        $numberSource = $record['number'];
    } elseif (isset($record['contractNumber'])) {
        $numberSource = $record['contractNumber'];
    } elseif (isset($data['contractNumber'])) {
        $numberSource = $data['contractNumber'];
    } else {
        $numberSource = '';
    }
    $number = trim((string) $numberSource);
    if ($number === '') {
        return null;
    }
    $totals = isset($data['totals']) && is_array($data['totals']) ? $data['totals'] : [];
    $customer = isset($data['customer']) && is_array($data['customer']) ? $data['customer'] : [];
    $amountSource = isset($record['amount']) ? $record['amount'] : (isset($totals['grandTotal']) ? $totals['grandTotal'] : 0);
    $amount = (float) $amountSource;
    return [
        'number' => $number,
        'date' => (string) (isset($record['date']) ? $record['date'] : (isset($data['contractDate']) ? $data['contractDate'] : '')),
        'counterparty' => (string) (isset($record['counterparty']) ? $record['counterparty'] : (isset($customer['name']) ? $customer['name'] : (isset($customer['inn']) ? $customer['inn'] : ''))),
        'amount' => is_finite($amount) ? $amount : 0,
        'status' => (isset($record['status']) ? $record['status'] : '') === 'exported' ? 'exported' : 'draft',
        'updatedAt' => (string) (isset($record['updatedAt']) ? $record['updatedAt'] : gmdate('c')),
        'data' => $data,
    ];
}

function normalize_presets($source)
{
    if (!is_array($source)) {
        return [];
    }
    $result = [];
    foreach ($source as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $title = trim(isset($entry['title']) ? (string) $entry['title'] : '');
        $description = trim(isset($entry['description']) ? (string) $entry['description'] : '');
        if ($title === '' || $description === '') {
            continue;
        }
        $result[] = [
            'group' => trim((string) (isset($entry['group']) ? $entry['group'] : (isset($entry['category']) ? $entry['category'] : 'Общее'))) ?: 'Общее',
            'subgroup' => trim((string) (isset($entry['subgroup']) ? $entry['subgroup'] : (isset($entry['subcategory']) ? $entry['subcategory'] : 'Без подгруппы'))) ?: 'Без подгруппы',
            'title' => $title,
            'description' => $description,
        ];
    }
    return $result;
}

function fetch_records(PDO $pdo, array $user)
{
    $sql = 'SELECT contracts.*, users.login AS owner_login
        FROM manager_contracts contracts
        LEFT JOIN manager_users users ON users.id = contracts.owner_id';
    $params = [];
    if ($user['role'] !== 'admin') {
        $sql .= ' WHERE contracts.owner_id = :owner_id';
        $params[':owner_id'] = $user['id'];
    }
    $sql .= ' ORDER BY contracts.updated_at DESC';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    return array_map(static function (array $row) {
        $data = json_decode((string) $row['data_json'], true);
        return [
            'number' => (string) $row['record_number'],
            'date' => (string) $row['contract_date'],
            'counterparty' => (string) $row['counterparty'],
            'amount' => (float) $row['amount'],
            'status' => $row['status'] === 'exported' ? 'exported' : 'draft',
            'updatedAt' => (string) $row['updated_at'],
            'ownerLogin' => isset($row['owner_login']) ? (string) $row['owner_login'] : 'Удалённый пользователь',
            'data' => is_array($data) ? $data : [],
        ];
    }, $statement->fetchAll());
}

function save_record(PDO $pdo, array $record, array $user)
{
    $ownerStatement = $pdo->prepare('SELECT owner_id FROM manager_contracts WHERE record_number = :number LIMIT 1');
    $ownerStatement->execute([':number' => $record['number']]);
    $existingOwner = $ownerStatement->fetchColumn();
    if ($existingOwner !== false && $user['role'] !== 'admin' && (int) $existingOwner !== $user['id']) {
        respond(['error' => 'Нельзя изменить договор другого пользователя.'], 403);
    }
    $ownerId = $existingOwner === false ? $user['id'] : (int) $existingOwner;

    $statement = $pdo->prepare('INSERT INTO manager_contracts
        (record_number, owner_id, contract_date, counterparty, amount, status, updated_at, data_json)
        VALUES (:number, :owner_id, :date, :counterparty, :amount, :status, :updated_at, :data_json)
        ON DUPLICATE KEY UPDATE contract_date = VALUES(contract_date), counterparty = VALUES(counterparty),
        amount = VALUES(amount), status = VALUES(status), updated_at = VALUES(updated_at), data_json = VALUES(data_json)');
    $statement->execute([
        ':number' => $record['number'],
        ':owner_id' => $ownerId,
        ':date' => $record['date'],
        ':counterparty' => $record['counterparty'],
        ':amount' => $record['amount'],
        ':status' => $record['status'],
        ':updated_at' => $record['updatedAt'],
        ':data_json' => json_encode($record['data'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
}

function fetch_presets(PDO $pdo)
{
    $rows = $pdo->query('SELECT group_name, subgroup_name, title, description FROM manager_tech_presets ORDER BY sort_order, id')->fetchAll();
    return array_map(static function (array $row) {
        return [
            'group' => (string) $row['group_name'],
            'subgroup' => (string) $row['subgroup_name'],
            'title' => (string) $row['title'],
            'description' => (string) $row['description'],
        ];
    }, $rows);
}

function replace_presets(PDO $pdo, array $presets)
{
    $pdo->beginTransaction();
    try {
        $pdo->exec('DELETE FROM manager_tech_presets');
        $statement = $pdo->prepare('INSERT INTO manager_tech_presets
            (group_name, subgroup_name, title, description, sort_order)
            VALUES (:group_name, :subgroup_name, :title, :description, :sort_order)');
        foreach ($presets as $index => $preset) {
            $statement->execute([
                ':group_name' => $preset['group'],
                ':subgroup_name' => $preset['subgroup'],
                ':title' => $preset['title'],
                ':description' => $preset['description'],
                ':sort_order' => $index,
            ]);
        }
        $pdo->commit();
    } catch (Exception $error) {
        $pdo->rollBack();
        throw $error;
    }
}

function import_initial_presets(PDO $pdo)
{
    $root = dirname(__DIR__);
    $presetCount = (int) $pdo->query('SELECT COUNT(*) FROM manager_tech_presets')->fetchColumn();
    $presetsPath = $root . '/templates/tech-presets.json';
    if ($presetCount === 0 && is_file($presetsPath)) {
        $presets = normalize_presets(json_decode((string) file_get_contents($presetsPath), true));
        if ($presets !== []) {
            replace_presets($pdo, $presets);
        }
    }
}

function fetch_users(PDO $pdo)
{
    $rows = $pdo->query('SELECT id, login, role, created_at FROM manager_users ORDER BY login')->fetchAll();
    return array_map('public_user', $rows);
}

function validate_login($login)
{
    return preg_match('/^[A-Za-z0-9._-]{3,64}$/', $login) === 1;
}

try {
    $config = require __DIR__ . '/config.php';
    $secureCookie = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_name(isset($config['session_name']) ? (string) $config['session_name'] : 'manager_app_session');
    session_set_cookie_params(0, '/', '', $secureCookie, true);
    session_start();
    $pdo = open_database($config);
    initialize_database($pdo, $config);
    import_initial_presets($pdo);
    $route = trim(isset($_GET['route']) ? (string) $_GET['route'] : '', '/');
    $method = strtoupper(isset($_SERVER['REQUEST_METHOD']) ? (string) $_SERVER['REQUEST_METHOD'] : 'GET');

    if ($route === 'health' && $method === 'GET') {
        respond(['ok' => true, 'database' => true]);
    }
    if ($route === 'auth/login' && $method === 'POST') {
        require_same_origin();
        $body = request_json();
        $login = trim(isset($body['login']) ? (string) $body['login'] : '');
        $statement = $pdo->prepare('SELECT id, login, password_hash, role, created_at FROM manager_users WHERE login = :login LIMIT 1');
        $statement->execute([':login' => $login]);
        $row = $statement->fetch();
        $loginPassword = isset($body['password']) ? (string) $body['password'] : '';
        if (!$row || !password_verify($loginPassword, (string) $row['password_hash'])) {
            respond(['error' => 'Неверный логин или пароль.'], 401);
        }
        session_regenerate_id(true);
        $_SESSION['manager_user_id'] = (int) $row['id'];
        respond(['authenticated' => true, 'user' => public_user($row)]);
    }
    if ($route === 'auth/logout' && $method === 'POST') {
        require_same_origin();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        respond(['authenticated' => false]);
    }
    if ($route === 'auth/session' && $method === 'GET') {
        $user = current_user($pdo);
        respond(['authenticated' => $user !== null, 'user' => $user]);
    }
    if ($route === 'dadata/party' && $method === 'POST') {
        require_same_origin();
        require_user($pdo);
        $body = request_json();
        $inn = trim(isset($body['query']) ? (string) $body['query'] : '');
        if (preg_match('/^(?:[0-9]{10}|[0-9]{12})$/', $inn) !== 1) {
            respond(['error' => 'Введите корректный ИНН из 10 или 12 цифр.'], 400);
        }
        $dadataToken = trim(isset($config['dadata_token']) ? (string) $config['dadata_token'] : '');
        if ($dadataToken === '') {
            respond(['error' => 'Поиск по ИНН временно не настроен.'], 503);
        }
        require_once __DIR__ . '/dadata-client.php';
        respond(['suggestion' => find_dadata_party($dadataToken, $inn)]);
    }
    if ($route === 'users' && $method === 'GET') {
        require_admin($pdo);
        respond(fetch_users($pdo));
    }
    if ($route === 'users' && $method === 'POST') {
        require_same_origin();
        require_admin($pdo);
        $body = request_json();
        $login = trim(isset($body['login']) ? (string) $body['login'] : '');
        $password = isset($body['password']) ? (string) $body['password'] : '';
        $role = (isset($body['role']) ? $body['role'] : '') === 'admin' ? 'admin' : 'user';
        if (!validate_login($login)) {
            respond(['error' => 'Логин: 3–64 символа, латинские буквы, цифры, точка, дефис или подчёркивание.'], 400);
        }
        if (strlen($password) < 8) {
            respond(['error' => 'Пароль должен содержать не менее 8 символов.'], 400);
        }
        try {
            $statement = $pdo->prepare('INSERT INTO manager_users (login, password_hash, role, created_at)
                VALUES (:login, :password_hash, :role, :created_at)');
            $statement->execute([
                ':login' => $login,
                ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
                ':role' => $role,
                ':created_at' => gmdate('c'),
            ]);
        } catch (PDOException $error) {
            if ((string) $error->getCode() === '23000') {
                respond(['error' => 'Пользователь с таким логином уже существует.'], 409);
            }
            throw $error;
        }
        respond(fetch_users($pdo), 201);
    }
    if ($route === 'users' && $method === 'PUT') {
        require_same_origin();
        $admin = require_admin($pdo);
        $body = request_json();
        $userId = isset($body['id']) ? (int) $body['id'] : 0;
        if ($userId === 0) {
            respond(['error' => 'Пользователь не найден.'], 404);
        }
        if ((isset($body['action']) ? $body['action'] : '') === 'password') {
            $password = isset($body['password']) ? (string) $body['password'] : '';
            if (strlen($password) < 8) {
                respond(['error' => 'Пароль должен содержать не менее 8 символов.'], 400);
            }
            $statement = $pdo->prepare('UPDATE manager_users SET password_hash = :password_hash WHERE id = :id');
            $statement->execute([
                ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
                ':id' => $userId,
            ]);
            if ($statement->rowCount() === 0) {
                respond(['error' => 'Пользователь не найден.'], 404);
            }
            respond(fetch_users($pdo));
        }
        $role = (isset($body['role']) ? $body['role'] : '') === 'admin' ? 'admin' : 'user';
        if ($role !== 'admin') {
            $statement = $pdo->prepare("SELECT role FROM manager_users WHERE id = :id");
            $statement->execute([':id' => $userId]);
            if ($statement->fetchColumn() === 'admin') {
                $adminCount = (int) $pdo->query("SELECT COUNT(*) FROM manager_users WHERE role = 'admin'")->fetchColumn();
                if ($adminCount <= 1) {
                    respond(['error' => 'Нельзя снять права у последнего администратора.'], 409);
                }
            }
        }
        $statement = $pdo->prepare('UPDATE manager_users SET role = :role WHERE id = :id');
        $statement->execute([':role' => $role, ':id' => $userId]);
        if ($statement->rowCount() === 0 && $userId !== $admin['id']) {
            $exists = $pdo->prepare('SELECT COUNT(*) FROM manager_users WHERE id = :id');
            $exists->execute([':id' => $userId]);
            if ((int) $exists->fetchColumn() === 0) {
                respond(['error' => 'Пользователь не найден.'], 404);
            }
        }
        respond(fetch_users($pdo));
    }
    if ($route === 'users' && $method === 'DELETE') {
        require_same_origin();
        $admin = require_admin($pdo);
        $body = request_json();
        $userId = isset($body['id']) ? (int) $body['id'] : 0;
        if ($userId === $admin['id']) {
            respond(['error' => 'Нельзя удалить текущую учётную запись.'], 409);
        }
        $statement = $pdo->prepare('SELECT role FROM manager_users WHERE id = :id');
        $statement->execute([':id' => $userId]);
        $role = $statement->fetchColumn();
        if ($role === false) {
            respond(['error' => 'Пользователь не найден.'], 404);
        }
        if ($role === 'admin') {
            $adminCount = (int) $pdo->query("SELECT COUNT(*) FROM manager_users WHERE role = 'admin'")->fetchColumn();
            if ($adminCount <= 1) {
                respond(['error' => 'Нельзя удалить последнего администратора.'], 409);
            }
        }
        $statement = $pdo->prepare('DELETE FROM manager_users WHERE id = :id');
        $statement->execute([':id' => $userId]);
        respond(fetch_users($pdo));
    }
    if ($route === 'contracts-registry' && $method === 'GET') {
        respond(fetch_records($pdo, require_user($pdo)));
    }
    if ($route === 'contracts-registry' && $method === 'POST') {
        require_same_origin();
        $user = require_user($pdo);
        $body = request_json();
        if ((isset($body['action']) ? $body['action'] : '') === 'delete') {
            if ($user['role'] === 'admin') {
                $statement = $pdo->prepare('DELETE FROM manager_contracts WHERE record_number = :number');
                $statement->execute([':number' => trim(isset($body['number']) ? (string) $body['number'] : '')]);
            } else {
                $statement = $pdo->prepare('DELETE FROM manager_contracts WHERE record_number = :number AND owner_id = :owner_id');
                $statement->execute([
                    ':number' => trim(isset($body['number']) ? (string) $body['number'] : ''),
                    ':owner_id' => $user['id'],
                ]);
            }
            respond(fetch_records($pdo, $user));
        }
        $record = isset($body['record']) && is_array($body['record']) ? normalize_record($body['record']) : null;
        if (!$record) {
            respond(['error' => 'Для записи нужен номер договора или черновика.'], 400);
        }
        save_record($pdo, $record, $user);
        respond(['saved' => true]);
    }
    if ($route === 'tech-presets' && $method === 'GET') {
        require_user($pdo);
        respond(fetch_presets($pdo));
    }
    if ($route === 'tech-presets' && $method === 'PUT') {
        require_same_origin();
        require_admin($pdo);
        $presets = normalize_presets(request_json());
        if ($presets === []) {
            respond(['error' => 'Справочник не может быть пустым.'], 400);
        }
        $titles = array_map(static function (array $preset) {
            return function_exists('mb_strtolower')
                ? mb_strtolower($preset['title'])
                : strtolower($preset['title']);
        }, $presets);
        if (count($titles) !== count(array_unique($titles))) {
            respond(['error' => 'Названия шаблонов не должны повторяться.'], 400);
        }
        replace_presets($pdo, $presets);
        respond($presets);
    }
    respond(['error' => 'Метод или адрес API не найден.'], 404);
} catch (Exception $error) {
    error_log($error->getMessage());
    respond(['error' => 'Серверная часть приложения еще не настроена.'], 503);
}
