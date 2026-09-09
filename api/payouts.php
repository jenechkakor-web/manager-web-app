<?php
// Internal module. Dates and ownership are always determined by the server.
function payout_cents($value) { return (int) round((float) $value * 100); }
function payout_today() { return (new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow')))->format('Y-m-d'); }
function payout_reasons() { return ['оклад', 'выполнение плана', 'отзывы', 'бонус от руководителя', 'другое']; }
function payout_value(array $source, $key, $fallback = '') { return isset($source[$key]) ? $source[$key] : $fallback; }
function payout_valid_date($value)
{
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    return $date && $date->format('Y-m-d') === $value;
}
function payout_eligible($record)
{
    return $record && $record['registryMeta']['paymentStatus'] === 'Да'
        && $record['registryMeta']['closingDocs'] === 'Отправлены'
        && payout_cents($record['registryMeta']['prepayment']) >= payout_cents($record['amount']);
}
function payout_bonus_cents(array $record)
{
    if (!payout_eligible($record)) return 0;
    $meta = $record['registryMeta'];
    if ($meta['bonusType'] === 'оклад') return 0;
    if ($meta['bonusType'] === 'от прибыли') return payout_cents($meta['bonusAmount']);
    $rates = ['12%' => 12, '10%' => 10, '7%' => 7, '5%' => 5, '4%' => 4, '3%' => 3];
    return (int) round(payout_cents($record['amount']) * payout_value($rates, $meta['bonusType'], 0) / 100);
}
function payout_qualification_date(array $record, $previous, $previousDate)
{
    return payout_eligible($record) ? (payout_eligible($previous) ? $previousDate : gmdate('c')) : '';
}

function initialize_payout_database(PDO $pdo)
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS manager_payout_migrations (
        version INT NOT NULL PRIMARY KEY, completed_at VARCHAR(40) NOT NULL, backup_manifest LONGTEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    if ($pdo->query('SELECT COUNT(*) FROM manager_payout_migrations WHERE version = 1')->fetchColumn()) return;
    $lock = 'manager_payout_schema_' . $pdo->query('SELECT DATABASE()')->fetchColumn();
    $statement = $pdo->prepare('SELECT GET_LOCK(?, 30)');
    $statement->execute([$lock]);
    if ((int) $statement->fetchColumn() !== 1) throw new RuntimeException('Payout schema lock unavailable');
    try {
        if ($pdo->query('SELECT COUNT(*) FROM manager_payout_migrations WHERE version = 1')->fetchColumn()) return;
        // Copy existing production data before adding the new payout tables.
        // Never import local JSON or rewrite existing contracts/users.
        $suffix = '_paybak_' . gmdate('Ymd_His') . '_' . substr(sha1(uniqid('', true)), 0, 8);
        $manifest = [];
        foreach (['manager_contracts', 'manager_users', 'manager_tech_presets', 'manager_bonus_ledger', 'manager_bonus_qualification'] as $table) {
            if (!has_table($pdo, $table)) continue;
            $backup = $table . $suffix;
            $pdo->exec("CREATE TABLE `$backup` LIKE `$table`");
            $manifest[$table] = ['table' => $backup];
        }
        $pdo->beginTransaction();
        foreach ($manifest as $table => &$item) {
            // INSERT ... SELECT takes an InnoDB shared lock; concurrent contract edits wait until commit.
            $pdo->exec('INSERT INTO `' . $item['table'] . '` SELECT * FROM `' . $table . '`');
            $original = (int) $pdo->query("SELECT COUNT(*) FROM `$table`")->fetchColumn();
            $copied = (int) $pdo->query('SELECT COUNT(*) FROM `' . $item['table'] . '`')->fetchColumn();
            if ($original !== $copied) throw new RuntimeException('Database backup row count mismatch');
            $item['rows'] = $copied;
        }
        unset($item);
        $pdo->commit();
        $pdo->exec("CREATE TABLE IF NOT EXISTS manager_bonus_ledger (
            request_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
            kind VARCHAR(20) NOT NULL, manager_id INT UNSIGNED NOT NULL, manager_login VARCHAR(64) NOT NULL,
            amount_cents BIGINT UNSIGNED NOT NULL, reason VARCHAR(100) NOT NULL,
            operation_date VARCHAR(10) NOT NULL, created_at VARCHAR(40) NOT NULL,
            created_by INT UNSIGNED NOT NULL, created_by_login VARCHAR(64) NOT NULL,
            KEY manager_date (manager_id, operation_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $pdo->exec("CREATE TABLE IF NOT EXISTS manager_bonus_qualification (
            record_number VARCHAR(191) NOT NULL PRIMARY KEY, qualified_at VARCHAR(40) NOT NULL DEFAULT ''
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $statement = $pdo->prepare('INSERT INTO manager_payout_migrations (version, completed_at, backup_manifest) VALUES (1, ?, ?)');
        $statement->execute([gmdate('c'), json_encode($manifest)]);
        error_log('Payout database backup verified: ' . json_encode($manifest));
    } catch (Exception $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    } finally {
        $statement = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $statement->execute([$lock]);
    }
}

function payout_stamp_record(PDO $pdo, array $record, $previous)
{
    $statement = $pdo->prepare('SELECT qualified_at FROM manager_bonus_qualification WHERE record_number = ? FOR UPDATE');
    $statement->execute([$record['number']]);
    $oldDate = $statement->fetchColumn();
    $date = payout_qualification_date($record, $previous, $oldDate === false ? '' : $oldDate);
    $statement = $pdo->prepare('INSERT INTO manager_bonus_qualification (record_number, qualified_at) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE qualified_at = VALUES(qualified_at)');
    $statement->execute([$record['number'], $date]);
}

function payout_ledger_entry(array $row)
{
    return ['id' => $row['request_id'], 'kind' => $row['kind'], 'managerId' => (int) $row['manager_id'],
        'managerLogin' => $row['manager_login'], 'amountCents' => (int) $row['amount_cents'], 'reason' => $row['reason'],
        'date' => $row['operation_date'], 'createdAt' => $row['created_at'],
        'createdBy' => (int) $row['created_by'], 'createdByLogin' => $row['created_by_login']];
}
function payout_append(PDO $pdo, array $body, array $admin)
{
    if ($admin['role'] !== 'admin') respond(['error' => 'Недостаточно прав.'], 403);
    $kind = payout_value($body, 'kind');
    $id = payout_value($body, 'requestId');
    $managerId = payout_value($body, 'managerId');
    $amount = isset($body['amount']) && is_scalar($body['amount']) ? (string) $body['amount'] : '';
    if (!in_array($kind, ['payment', 'accrual'], true)) respond(['error' => 'Выберите тип операции.'], 400);
    if (!is_string($id) || !preg_match('/^[0-9a-f-]{36}$/i', $id)) respond(['error' => 'Некорректный идентификатор операции.'], 400);
    if (!is_scalar($managerId) || !preg_match('/^[0-9]+$/', (string) $managerId)) respond(['error' => 'Выберите менеджера.'], 400);
    if (!preg_match('/^[0-9]{1,10}(\.[0-9]{1,2})?$/', $amount) || payout_cents($amount) <= 0) respond(['error' => 'Укажите положительную сумму с точностью до копеек.'], 400);
    $reason = $kind === 'accrual' ? payout_value($body, 'reason') : '';
    if ($kind === 'accrual' && !in_array($reason, payout_reasons(), true)) respond(['error' => 'Выберите причину начисления.'], 400);
    $statement = $pdo->prepare('SELECT id, login FROM manager_users WHERE id = ?');
    $statement->execute([(int) $managerId]);
    $manager = $statement->fetch();
    if (!$manager) respond(['error' => 'Выберите существующего менеджера.'], 400);
    try {
        $statement = $pdo->prepare('INSERT INTO manager_bonus_ledger
            (request_id, kind, manager_id, manager_login, amount_cents, reason, operation_date, created_at, created_by, created_by_login)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $statement->execute([$id, $kind, (int) $managerId, $manager['login'], payout_cents($amount), $reason,
            payout_today(), gmdate('c'), $admin['id'], $admin['login']]);
    } catch (PDOException $error) {
        if ((string) $error->getCode() !== '23000') throw $error;
        // Unique request ID makes retries/concurrent submissions safe.
    }
    $statement = $pdo->prepare('SELECT * FROM manager_bonus_ledger WHERE request_id = ?');
    $statement->execute([$id]);
    $row = $statement->fetch();
    if (!$row) throw new RuntimeException('Payout insert was not confirmed');
    if ($row['kind'] !== $kind || (int) $row['manager_id'] !== (int) $managerId
        || (int) $row['amount_cents'] !== payout_cents($amount) || $row['reason'] !== $reason) {
        respond(['error' => 'Эта операция уже сохранена с другими данными. Обновите реестр.'], 409);
    }
    return payout_ledger_entry($row);
}

function payout_sum(array $entries)
{
    $result = ['revenue' => 0, 'accrued' => 0, 'paid' => 0];
    foreach ($entries as $entry) foreach ($result as $key => $value) $result[$key] += $entry[$key];
    return $result;
}
function payout_serialize(array $total)
{
    return ['revenue' => $total['revenue'] / 100, 'accrued' => $total['accrued'] / 100,
        'paid' => $total['paid'] / 100, 'balance' => ($total['accrued'] - $total['paid']) / 100];
}
function payout_build_report(array $records, array $users, array $ledger, array $user, array $query)
{
    foreach (['from', 'to', 'month', 'manager'] as $key) if (isset($query[$key]) && !is_string($query[$key])) throw new InvalidArgumentException('Некорректный фильтр.');
    $from = payout_value($query, 'from'); $to = payout_value($query, 'to'); $month = payout_value($query, 'month');
    if ($month !== '') {
        if (!preg_match('/^[0-9]{4}-(0[1-9]|1[0-2])$/', $month)) throw new InvalidArgumentException('Некорректный месяц.');
        $from = $month . '-01'; $to = (new DateTimeImmutable($from))->format('Y-m-t');
    }
    if (($from !== '' && !payout_valid_date($from)) || ($to !== '' && !payout_valid_date($to)) || ($from && $to && $from > $to)) throw new InvalidArgumentException('Проверьте даты начала и окончания периода.');
    $manager = payout_value($query, 'manager');
    if ($manager !== '' && (!ctype_digit($manager) || strlen($manager) > 10)) throw new InvalidArgumentException('Некорректный менеджер.');
    $owner = $user['role'] === 'admin' ? ($manager === '' ? null : (int) $manager) : $user['id'];
    $inScope = static function ($id) use ($owner) { return $owner === null || (int) $id === $owner; };
    $names = array_column($users, 'login', 'id'); $entries = [];
    foreach ($records as $record) {
        if (!$inScope($record['ownerId'])) continue;
        $common = ['managerId' => $record['ownerId'], 'manager' => payout_value($names, $record['ownerId'], 'Удалённый пользователь'),
            'number' => $record['number'], 'title' => $record['registryMeta']['title'] ?: ($record['counterparty'] ?: 'Без названия')];
        $entries[] = array_merge($common, ['id' => 'sale:' . $record['number'], 'kind' => 'sale', 'date' => $record['date'],
            'reason' => 'Сумма сделки', 'revenue' => payout_cents($record['amount']), 'accrued' => 0, 'paid' => 0]);
        if (!payout_eligible($record)) continue;
        $date = empty($record['bonusQualifiedAt']) ? '' : (new DateTimeImmutable($record['bonusQualifiedAt']))->setTimezone(new DateTimeZone('Europe/Moscow'))->format('Y-m-d');
        $entries[] = array_merge($common, ['id' => 'deal:' . $record['number'], 'kind' => 'deal', 'date' => $date,
            'title' => $record['registryMeta']['title'] ?: 'Без названия', 'counterparty' => $record['counterparty'],
            'dealAmount' => $record['amount'], 'reason' => $record['registryMeta']['bonusType'], 'revenue' => 0,
            'accrued' => payout_bonus_cents($record), 'paid' => 0, 'eligible' => true,
            'paymentStatus' => $record['registryMeta']['paymentStatus'], 'closingDocs' => $record['registryMeta']['closingDocs']]);
    }
    foreach ($ledger as $entry) {
        if (!$inScope($entry['managerId'])) continue;
        $entries[] = ['id' => $entry['id'], 'kind' => $entry['kind'], 'date' => $entry['date'], 'managerId' => $entry['managerId'],
            'manager' => payout_value($names, $entry['managerId'], $entry['managerLogin']),
            'title' => $entry['kind'] === 'payment' ? 'Выплата бонусов' : 'Дополнительное начисление',
            'reason' => $entry['reason'], 'revenue' => 0, 'accrued' => $entry['kind'] === 'accrual' ? $entry['amountCents'] : 0,
            'paid' => $entry['kind'] === 'payment' ? $entry['amountCents'] : 0, 'createdBy' => $entry['createdByLogin']];
    }
    $selected = array_values(array_filter($entries, static function ($entry) use ($from, $to) {
        return ((!$from && !$to) || $entry['date']) && (!$from || $entry['date'] >= $from) && (!$to || $entry['date'] <= $to);
    }));
    $opening = payout_sum(array_filter($entries, static function ($entry) use ($from) { return $from && $entry['date'] && $entry['date'] < $from; }));
    $period = payout_sum($selected);
    $ids = array_unique(array_merge(array_column($users, 'id'), array_column($entries, 'managerId')));
    $managerTotals = [];
    foreach ($ids as $id) {
        if (!$inScope($id)) continue;
        $own = static function ($entry) use ($id) { return $entry['managerId'] === $id; };
        $managerTotals[] = array_merge(['id' => $id, 'login' => payout_value($names, $id, 'Удалённый пользователь')],
            payout_serialize(payout_sum(array_filter($selected, $own))),
            ['allTimeBalance' => payout_serialize(payout_sum(array_filter($entries, $own)))['balance']]);
    }
    usort($selected, static function ($a, $b) { return strcmp($b['date'], $a['date']) ?: strcmp($a['id'], $b['id']); });
    $undated = payout_sum(array_filter($entries, static function ($entry) { return $entry['kind'] === 'deal' && !$entry['date']; }));
    return ['today' => payout_today(), 'reasons' => payout_reasons(), 'from' => $from, 'to' => $to,
        'undatedAccrued' => $undated['accrued'] / 100,
        'managers' => array_values(array_map(static function ($row) { return ['id' => $row['id'], 'login' => $row['login']]; },
            array_filter($users, static function ($row) use ($user) { return $user['role'] === 'admin' || $row['id'] === $user['id']; }))),
        'totals' => payout_serialize($period), 'allTime' => payout_serialize(payout_sum($entries)),
        'openingBalance' => ($opening['accrued'] - $opening['paid']) / 100,
        'closingBalance' => ($opening['accrued'] - $opening['paid'] + $period['accrued'] - $period['paid']) / 100,
        'managerTotals' => $managerTotals,
        'entries' => array_map(static function ($entry) { foreach (['revenue', 'accrued', 'paid'] as $key) $entry[$key] /= 100; return $entry; }, $selected)];
}

function payout_report(PDO $pdo, array $user, array $query)
{
    // Fetch one contract at a time: data_json can contain large embedded images.
    $sql = 'SELECT c.*, q.qualified_at FROM manager_contracts c LEFT JOIN manager_bonus_qualification q ON q.record_number = c.record_number';
    $params = [];
    if ($user['role'] !== 'admin') { $sql .= ' WHERE c.owner_id = ?'; $params[] = $user['id']; }
    $statement = prepare_contract_statement($pdo, $sql);
    $statement->execute($params);
    $records = [];
    while ($row = $statement->fetch()) {
        $record = record_from_database_row($row, false);
        $record['ownerId'] = (int) $row['owner_id'];
        $record['bonusQualifiedAt'] = payout_value($row, 'qualified_at');
        $records[] = $record;
    }
    $statement->closeCursor();
    $sql = 'SELECT * FROM manager_bonus_ledger';
    if ($user['role'] !== 'admin') $sql .= ' WHERE manager_id = ?';
    $statement = $pdo->prepare($sql); $statement->execute($params);
    $ledger = array_map('payout_ledger_entry', $statement->fetchAll());
    return payout_build_report($records, fetch_users($pdo), $ledger, $user, $query);
}
