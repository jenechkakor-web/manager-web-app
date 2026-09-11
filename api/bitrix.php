<?php
// Server-only integration; compatible with the production PHP 5.6 runtime.
class BitrixException extends RuntimeException {}
function bitrix_value($source, $key, $fallback = '') { return is_array($source) && isset($source[$key]) ? $source[$key] : $fallback; }
function bitrix_text($value) { return is_string($value) || is_numeric($value) ? trim((string) $value) : ''; }
function bitrix_id($value) { $value = bitrix_text($value); return preg_match('/^[1-9]\d{0,17}$/D', $value) ? $value : ''; }
function bitrix_label($value)
{
    $value = preg_replace('/\s+/u', ' ', trim(bitrix_text($value)));
    // mbstring is optional on the existing host.
    return strtr(strtolower($value), array_combine(
        preg_split('//u', 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', -1, PREG_SPLIT_NO_EMPTY),
        preg_split('//u', 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе', -1, PREG_SPLIT_NO_EMPTY)));
}
function bitrix_rules()
{
    static $rules;
    if (!$rules) $rules = json_decode(file_get_contents(__DIR__ . '/bitrix-rules.json'), true);
    if (!is_array($rules)) throw new BitrixException('Не удалось прочитать правила Б24.', 503);
    return $rules;
}
function bitrix_stage_status($name)
{
    foreach (bitrix_rules()['stages'] as $status => $names) {
        foreach ($names as $candidate) if (bitrix_label($candidate) === bitrix_label($name)) return $status;
    }
    return '';
}
function bitrix_manager(array $creator, array $users, array $config)
{
    $fullName = bitrix_label(bitrix_text(bitrix_value($creator, 'NAME')) . ' ' . bitrix_text(bitrix_value($creator, 'LAST_NAME')));
    foreach (bitrix_rules()['managers'] as $name) {
        if (bitrix_label($name) !== $fullName) continue;
        $binding = bitrix_value(bitrix_value($config, 'managers', []), $name);
        $login = is_string($binding) ? $binding : bitrix_value($binding, 'login');
        $bitrixId = bitrix_value($binding, 'bitrixId');
        if ($bitrixId && bitrix_text($bitrixId) !== bitrix_id(bitrix_value($creator, 'ID'))) return null;
        $matches = [];
        foreach ($users as $user) {
            if ($login ? bitrix_label($user['login']) === bitrix_label($login) : bitrix_label(bitrix_value($user, 'fullName')) === $fullName) $matches[] = $user;
        }
        return count($matches) === 1 ? $matches[0] : null;
    }
    return null;
}
function bitrix_endpoint(array $config)
{
    $url = bitrix_text(bitrix_value($config, 'webhookUrl'));
    $parts = parse_url($url);
    if (!$parts || bitrix_value($parts, 'scheme') !== 'https' || empty($parts['host'])
        || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])
        || !preg_match('~/rest/[1-9]\d*/[A-Za-z0-9_-]+/$~D', bitrix_value($parts, 'path'))) {
        throw new BitrixException('Б24: требуется HTTPS-адрес входящего вебхука /rest/ID/TOKEN/.', 503);
    }
    return $url;
}
function bitrix_authenticate(array $body, array $config)
{
    $domain = strtolower(parse_url(bitrix_endpoint($config), PHP_URL_HOST));
    $expected = bitrix_text(bitrix_value($config, 'eventToken'));
    if (!$expected) throw new BitrixException('Токен исходящего вебхука Б24 не настроен.', 503);
    $auth = bitrix_value($body, 'auth', []);
    if (!hash_equals($expected, bitrix_text(bitrix_value($auth, 'application_token')))
        || bitrix_label(bitrix_value($auth, 'domain')) !== $domain
        || (!empty($config['memberId']) && bitrix_text(bitrix_value($auth, 'member_id')) !== bitrix_text($config['memberId']))) {
        throw new BitrixException('Недействительная подпись события Б24.', 403);
    }
    if (!in_array(bitrix_value($body, 'event'), ['ONCRMDEALADD', 'ONCRMDEALUPDATE'], true)) return null;
    $id = bitrix_id(bitrix_value(bitrix_value(bitrix_value($body, 'data', []), 'FIELDS', []), 'ID'));
    if (!$id) throw new BitrixException('Б24: некорректный ID сделки.', 400);
    return $id;
}
function bitrix_request_event()
{
    if ((int) bitrix_value($_SERVER, 'CONTENT_LENGTH', 0) > 65536) throw new BitrixException('Слишком большое событие Б24.', 413);
    $raw = file_get_contents('php://input', false, null, 0, 65537);
    if (strlen($raw) > 65536) throw new BitrixException('Слишком большое событие Б24.', 413);
    $type = trim(explode(';', bitrix_value($_SERVER, 'CONTENT_TYPE'))[0]);
    if ($type === 'application/json') {
        $body = json_decode($raw, true);
        if (!is_array($body)) throw new BitrixException('Некорректный JSON события Б24.', 400);
        return $body;
    }
    if ($type !== 'application/x-www-form-urlencoded') throw new BitrixException('Неподдерживаемый формат события Б24.', 415);
    parse_str($raw, $body);
    return $body;
}
function bitrix_call(array $config, $method, array $params)
{
    $url = bitrix_endpoint($config) . $method . '.json';
    if (!function_exists('curl_init')) throw new BitrixException('На сервере требуется расширение PHP cURL.', 503);
    $curl = curl_init($url);
    curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($params),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 12, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2]);
    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);
    $response = is_string($raw) ? json_decode($raw, true) : null;
    // Remote messages and transport errors can contain secrets. Never expose them.
    if ($status !== 200 || !is_array($response) || isset($response['error']) || !array_key_exists('result', $response)) {
        throw new BitrixException('Б24: не удалось выполнить ' . $method . '. Проверьте доступность и права вебхука.', 502);
    }
    return $response['result'];
}
function bitrix_fetch_snapshot($id, $call)
{
    $deal = call_user_func($call, 'crm.deal.get', ['id' => $id]);
    if (!is_array($deal) || bitrix_id(bitrix_value($deal, 'ID')) !== $id || !bitrix_id(bitrix_value($deal, 'CREATED_BY_ID'))) {
        throw new BitrixException('Б24: неполная карточка сделки.', 502);
    }
    $creators = call_user_func($call, 'user.get', ['ID' => $deal['CREATED_BY_ID']]);
    $creator = null;
    foreach (is_array($creators) ? $creators : [] as $item) {
        if (bitrix_id(bitrix_value($item, 'ID')) === bitrix_id($deal['CREATED_BY_ID'])) $creator = $item;
    }
    if (!$creator) throw new BitrixException('Б24: создатель сделки недоступен.', 502);
    $source = '';
    if (bitrix_text(bitrix_value($deal, 'SOURCE_ID'))) {
        $sources = call_user_func($call, 'crm.status.list', ['filter' => ['ENTITY_ID' => 'SOURCE', 'STATUS_ID' => $deal['SOURCE_ID']]]);
        $entry = null;
        foreach (is_array($sources) ? $sources : [] as $item) if (bitrix_value($item, 'STATUS_ID') === $deal['SOURCE_ID']) $entry = $item;
        if (!$entry) throw new BitrixException('Б24: источник сделки недоступен.', 502);
        $source = bitrix_text(bitrix_value($entry, 'NAME'));
    }
    return ['deal' => $deal, 'creator' => $creator, 'source' => $source];
}
function bitrix_money($value)
{
    $raw = str_replace(',', '.', preg_replace('/\s+/u', '', explode('|', bitrix_text($value))[0]));
    if (!preg_match('/^\d+(\.\d{1,2})?$/D', $raw) || (float) $raw > 9999999999999.99) throw new BitrixException('Б24: некорректная денежная сумма.', 502);
    return round((float) $raw, 2);
}
function bitrix_map_snapshot(array $snapshot, array $config, array $users, $previous = null)
{
    $deal = $snapshot['deal'];
    $manager = bitrix_manager($snapshot['creator'], $users, $config);
    if (!$manager) return ['skipped' => 'manager_not_allowed_or_unmapped'];
    if (!in_array(bitrix_value($deal, 'CURRENCY_ID'), ['RUB', 'RUR'], true)) throw new BitrixException('Б24: реестр поддерживает только суммы в рублях.', 409);
    $amount = bitrix_money(bitrix_value($deal, 'OPPORTUNITY'));
    $date = bitrix_value($previous, 'date', payout_today());
    $modifiedAt = bitrix_text(bitrix_value($deal, 'DATE_MODIFY'));
    if (strtotime($modifiedAt) === false) throw new BitrixException('Б24: некорректная дата изменения.', 502);
    $previousMeta = bitrix_value($previous, 'registryMeta', []);
    $paid = (float) bitrix_value($previousMeta, 'prepayment', 0);
    if ($paid > $amount || (bitrix_value($previousMeta, 'paymentStatus') === 'Да' && $paid < $amount)) {
        throw new BitrixException('Сумма Б24 противоречит оплате в реестре. Проверьте сумму и предоплату вручную.', 409);
    }
    $number = bitrix_text(bitrix_value($deal, !empty($config['numberField']) ? $config['numberField'] : 'ID'));
    if ($number === '' || preg_match_all('/./us', $number) > 191) throw new BitrixException('Б24: номер сделки отсутствует или слишком длинный.', 502);
    $meta = array_merge(['paymentStatus' => 'Планируется', 'prepayment' => 0, 'prepaymentOverridden' => true], $previousMeta, [
        'title' => bitrix_text(bitrix_value($deal, 'TITLE')),
        'source' => bitrix_text(bitrix_value(bitrix_value($config, 'sourceMap', []), bitrix_value($deal, 'SOURCE_ID'), $snapshot['source'])),
        'bitrix' => ['dealId' => bitrix_id($deal['ID']), 'domain' => strtolower(parse_url(bitrix_endpoint($config), PHP_URL_HOST)),
            'creatorId' => bitrix_id($deal['CREATED_BY_ID']), 'modifiedAt' => $modifiedAt, 'number' => $number],
    ]);
    return ['record' => array_merge($previous ?: [], ['number' => bitrix_value($previous, 'number', $number),
        'ownerId' => $manager['id'], 'date' => $date, 'amount' => $amount, 'registryMeta' => $meta,
        'data' => bitrix_value($previous, 'data', []), 'updatedAt' => gmdate('c')])];
}
function bitrix_preserve_fields(array $incoming, $previous)
{
    unset($incoming['registryMeta']['bitrix']);
    if (empty($previous['registryMeta']['bitrix'])) return $incoming;
    $incoming['number'] = $previous['number'];
    $incoming['registryMeta']['bitrix'] = $previous['registryMeta']['bitrix'];
    return $incoming;
}
function bitrix_configuration_status(array $config, array $users)
{
    $configured = false;
    try { bitrix_endpoint($config); $configured = !empty($config['eventToken']); } catch (BitrixException $ignored) {}
    $managers = [];
    foreach (bitrix_rules()['managers'] as $name) {
        $binding = bitrix_value(bitrix_value($config, 'managers', []), $name);
        $login = is_string($binding) ? $binding : bitrix_value($binding, 'login');
        $matches = [];
        foreach ($users as $user) {
            if ($login ? bitrix_label($login) === bitrix_label($user['login']) : bitrix_label(bitrix_value($user, 'fullName')) === bitrix_label($name)) $matches[] = $user;
        }
        $managers[] = ['name' => $name, 'login' => count($matches) === 1 ? $matches[0]['login'] : '', 'linked' => count($matches) === 1];
    }
    return ['configured' => $configured, 'domain' => $configured ? parse_url(bitrix_endpoint($config), PHP_URL_HOST) : '',
        'paidAmountField' => bitrix_value($config, 'paidAmountField'), 'fullPaymentField' => bitrix_value($config, 'fullPaymentField'),
        'numberField' => bitrix_value($config, 'numberField'),
        'paymentConfigured' => !empty($config['paidAmountField']) || !empty($config['fullPaymentField']), 'managers' => $managers];
}
function bitrix_updated_config(array $previous, array $body)
{
    $config = $previous;
    foreach (['webhookUrl','eventToken','paidAmountField','fullPaymentField','numberField'] as $key) {
        if (!array_key_exists($key, $body)) continue;
        if (!is_string($body[$key]) || strlen($body[$key]) > 2048) throw new BitrixException('Некорректные настройки Б24.', 400);
        if (in_array($key, ['webhookUrl','eventToken'], true) && trim($body[$key]) === '') continue;
        $config[$key] = trim($body[$key]);
    }
    bitrix_endpoint($config);
    if (empty($config['eventToken'])) throw new BitrixException('Укажите токен исходящего вебхука.', 400);
    foreach (['paidAmountField','fullPaymentField','numberField'] as $key) {
        if (!empty($config[$key]) && !preg_match('/^[A-Z][A-Z0-9_]{0,100}$/D', $config[$key])) throw new BitrixException('Некорректный код поля Б24.', 400);
    }
    return $config;
}
function bitrix_save_config(array $config)
{
    $temporary = tempnam(__DIR__, '.bitrix-');
    if (!$temporary) throw new BitrixException('Не удалось сохранить настройки Б24 на сервере.', 503);
    chmod($temporary, 0600);
    $body = "<?php\nreturn " . var_export($config, true) . ";\n";
    if (file_put_contents($temporary, $body, LOCK_EX) !== strlen($body) || !rename($temporary, __DIR__ . '/bitrix.local.php')) {
        @unlink($temporary);
        throw new BitrixException('Не удалось сохранить настройки Б24 на сервере.', 503);
    }
    if (function_exists('opcache_invalidate')) opcache_invalidate(__DIR__ . '/bitrix.local.php', true);
}
function bitrix_existing_deal_id(array $record, array $config)
{
    $link = bitrix_value(bitrix_value($record, 'registryMeta', []), 'bitrix', []);
    if ($link) {
        if (bitrix_value($link, 'domain') !== strtolower(parse_url(bitrix_endpoint($config), PHP_URL_HOST))) return '';
        return bitrix_id(bitrix_value($link, 'dealId'));
    }
    // Suffixes and numberless invoices may be parts of another deal. Never guess.
    return bitrix_id(bitrix_value($record, 'number'));
}
function bitrix_recent_ids(array $config, array $users, array $user, $call)
{
    $names = [];
    foreach (bitrix_rules()['managers'] as $name) {
        $binding = bitrix_value(bitrix_value($config, 'managers', []), $name);
        $login = is_string($binding) ? $binding : bitrix_value($binding, 'login');
        if ($login ? bitrix_label($login) === bitrix_label($user['login']) : bitrix_label($name) === bitrix_label(bitrix_value($user, 'fullName'))) $names[] = $name;
    }
    if (count($names) !== 1) throw new BitrixException('Ваше ФИО не связано с менеджером Б24. Обратитесь к администратору.', 409);
    $parts = explode(' ', $names[0], 2);
    $people = call_user_func($call, 'user.get', ['FILTER' => ['NAME' => $parts[0], 'LAST_NAME' => $parts[1]]]);
    $creators = [];
    foreach (is_array($people) ? $people : [] as $person) {
        $mapped = bitrix_manager($person, $users, $config);
        if ($mapped && (int) $mapped['id'] === (int) $user['id'] && bitrix_id(bitrix_value($person, 'ID'))) $creators[bitrix_id($person['ID'])] = true;
    }
    if (count($creators) !== 1) throw new BitrixException('Не удалось однозначно найти вашего сотрудника в Б24.', 409);
    $creator = (string) key($creators);
    $rows = call_user_func($call, 'crm.deal.list', ['filter' => ['CREATED_BY_ID' => $creator],
        'order' => ['DATE_CREATE' => 'DESC', 'ID' => 'DESC'], 'select' => ['ID', 'CREATED_BY_ID', 'DATE_CREATE'], 'start' => 0]);
    if (!is_array($rows)) throw new BitrixException('Б24: не удалось получить последние сделки.', 502);
    $ids = [];
    foreach ($rows as $row) {
        $id = bitrix_id(bitrix_value($row, 'ID'));
        if (!$id || bitrix_id(bitrix_value($row, 'CREATED_BY_ID')) !== $creator) throw new BitrixException('Б24 вернул сделку другого создателя. Обновление остановлено.', 409);
        if (!in_array($id, $ids, true)) $ids[] = $id;
        if (count($ids) === 5) break;
    }
    return $ids;
}
function bitrix_recent_sync(PDO $pdo, array $config, $id, $runId, $userId, $call = null)
{
    // The batch contains only IDs obtained for this session's creator. Recheck ownership under the deal lock as well.
    $records = fetch_records($pdo, ['id' => (int) $userId, 'role' => 'user']);
    foreach ($records as $record) if (bitrix_existing_deal_id($record, $config) === $id) {
        return bitrix_refresh_record($pdo, $config, $record['number'], $runId, $userId, $call, $userId);
    }
    return bitrix_sync($pdo, $config, $id, $call, null, $userId);
}
function bitrix_refresh_record(PDO $pdo, array $config, $number, $runId, $actorId, $call = null, $expectedOwnerId = null)
{
    if (!is_string($number) || $number === '' || strlen($number) > 764 || !is_string($runId)
        || !preg_match('/^[a-f0-9-]{36}$/D', $runId)) throw new BitrixException('Некорректный запрос обновления реестра.', 400);
    $statement = $pdo->prepare('SELECT * FROM manager_contracts WHERE record_number = ?');
    $statement->execute([$number]); $row = $statement->fetch();
    if (!$row) return ['number' => $number, 'skipped' => 'record_deleted'];
    if ($expectedOwnerId !== null && (int) $row['owner_id'] !== (int) $expectedOwnerId) throw new BitrixException('Можно обновить только свои сделки.', 403);
    $id = bitrix_existing_deal_id(record_from_database_row($row, false), $config);
    if (!$id) return ['number' => $number, 'skipped' => 'needs_deal_id'];
    $pdo->exec("CREATE TABLE IF NOT EXISTS manager_bitrix_refresh_history (
        run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        record_number VARCHAR(191) NOT NULL, refreshed_at VARCHAR(40) NOT NULL,
        actor_id INT UNSIGNED NOT NULL, previous_json LONGTEXT NOT NULL, result_json LONGTEXT NOT NULL,
        PRIMARY KEY (run_id, record_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    return bitrix_sync($pdo, $config, $id, $call, ['number' => $number, 'runId' => $runId, 'actorId' => $actorId], $expectedOwnerId);
}
function bitrix_sync(PDO $pdo, array $config, $id, $call = null, $refresh = null, $expectedOwnerId = null)
{
    $id = bitrix_id($id);
    if (!$id) throw new BitrixException('Б24: некорректный ID сделки.', 400);
    $domain = strtolower(parse_url(bitrix_endpoint($config), PHP_URL_HOST));
    // A separate unique link preserves identity even if a custom display number changes.
    $pdo->exec("CREATE TABLE IF NOT EXISTS manager_bitrix_deals (
        portal_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        deal_id VARCHAR(18) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        record_number VARCHAR(191) NOT NULL,
        PRIMARY KEY (portal_key, deal_id), UNIQUE KEY record_number (record_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $portalKey = hash('sha256', $domain);
    $lock = 'b24_' . substr(hash('sha256', $pdo->query('SELECT DATABASE()')->fetchColumn() . $domain . ':' . $id), 0, 56);
    $statement = $pdo->prepare('SELECT GET_LOCK(?, 5)'); $statement->execute([$lock]);
    if ((int) $statement->fetchColumn() !== 1) throw new BitrixException('Сделка Б24 синхронизируется. Повторите запрос.', 503);
    try {
        if ($refresh) {
            $statement = $pdo->prepare('SELECT result_json FROM manager_bitrix_refresh_history WHERE run_id = ? AND record_number = ?');
            $statement->execute([$refresh['runId'], $refresh['number']]); $savedResult = $statement->fetchColumn();
            if ($savedResult !== false) return json_decode($savedResult, true);
        }
        if (!$call) $call = static function ($method, $params) use ($config) { return bitrix_call($config, $method, $params); };
        // Fetch after acquiring the lock: out-of-order notifications always read current CRM state.
        $snapshot = bitrix_fetch_snapshot($id, $call);
        if ($expectedOwnerId !== null) {
            $manager = bitrix_manager($snapshot['creator'], fetch_users($pdo), $config);
            if (!$manager || (int) $manager['id'] !== (int) $expectedOwnerId) throw new BitrixException('Можно обновить только свои сделки.', 403);
        }
        $pdo->beginTransaction();
        $statement = $pdo->prepare('SELECT record_number FROM manager_bitrix_deals WHERE portal_key = ? AND deal_id = ? FOR UPDATE');
        $statement->execute([$portalKey, $id]); $number = $statement->fetchColumn();
        $previous = null;
        if ($refresh && $number !== false && $number !== $refresh['number']) {
            $pdo->commit(); return ['number' => $refresh['number'], 'skipped' => 'link_conflict'];
        }
        if ($number !== false || $refresh) {
            $statement = $pdo->prepare('SELECT * FROM manager_contracts WHERE record_number = ? FOR UPDATE');
            $statement->execute([$refresh ? $refresh['number'] : $number]); $row = $statement->fetch();
            // A deleted registry row is not silently recreated on the next update.
            if (!$row) { $pdo->commit(); return ['skipped' => 'record_deleted']; }
            if ($expectedOwnerId !== null && (int) $row['owner_id'] !== (int) $expectedOwnerId) throw new BitrixException('Можно обновить только свои сделки.', 403);
            $previous = record_from_database_row($row, true);
            $previous['ownerId'] = (int) $row['owner_id'];
            if ($refresh && bitrix_existing_deal_id($previous, $config) !== $id) {
                $pdo->commit(); return ['number' => $refresh['number'], 'skipped' => 'link_conflict'];
            }
        }
        $mapped = bitrix_map_snapshot($snapshot, $config, fetch_users($pdo), $previous);
        if (isset($mapped['skipped'])) { $pdo->commit(); return $mapped; }
        $owner = $mapped['record']['ownerId'];
        $record = normalize_record($mapped['record']);
        if ($previous && $owner !== $previous['ownerId']) {
            if ($refresh) { $pdo->commit(); return ['number' => $refresh['number'], 'skipped' => 'creator_mismatch']; }
            throw new BitrixException('Б24: изменена привязка владельца. Проверьте настройки менеджера.', 409);
        }
        if (!empty($previous['registryMeta']['bitrix']['modifiedAt']) && strtotime($previous['registryMeta']['bitrix']['modifiedAt']) > strtotime($record['registryMeta']['bitrix']['modifiedAt'])) {
            $pdo->commit(); return ['skipped' => 'stale_snapshot'];
        }
        if ($number === false) {
            if (!$previous) {
                $statement = $pdo->prepare('SELECT record_number FROM manager_contracts WHERE record_number = ? FOR UPDATE');
                $statement->execute([$record['number']]);
                if ($statement->fetch()) throw new BitrixException('Номер Б24 уже занят в реестре. Существующая запись сохранена.', 409);
            }
            $statement = $pdo->prepare('INSERT INTO manager_bitrix_deals (portal_key, deal_id, record_number) VALUES (?, ?, ?)');
            $statement->execute([$portalKey, $id, $record['number']]);
        }
        $result = ['synced' => true, 'number' => $record['number']];
        if ($refresh) {
            $statement = $pdo->prepare('SELECT qualified_at FROM manager_bonus_qualification WHERE record_number = ? FOR UPDATE');
            $statement->execute([$record['number']]); $oldQualification = $statement->fetchColumn();
            $result['title'] = $record['registryMeta']['title'];
            $result['amount'] = $record['amount'];
            $result['paymentStatus'] = $record['registryMeta']['paymentStatus'];
            $statement = $pdo->prepare('INSERT INTO manager_bitrix_refresh_history (run_id, record_number, refreshed_at, actor_id, previous_json, result_json) VALUES (?, ?, ?, ?, ?, ?)');
            $statement->execute([$refresh['runId'], $record['number'], gmdate('c'), $refresh['actorId'],
                json_encode(['record' => $row, 'qualifiedAt' => $oldQualification, 'linkedBefore' => $number !== false], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
        }
        // CRM linkage, record and qualification timestamp commit together.
        save_record($pdo, $record, ['id' => $owner, 'role' => 'user'], true);
        $pdo->commit();
        return $result;
    } catch (Exception $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    } finally {
        $statement = $pdo->prepare('SELECT RELEASE_LOCK(?)'); $statement->execute([$lock]);
    }
}
