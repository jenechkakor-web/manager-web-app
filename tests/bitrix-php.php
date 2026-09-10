<?php
define('MANAGER_API_TEST_MODE', true);
require dirname(__DIR__) . '/api/index.php';
function check_bitrix($condition, $message) { if (!$condition) throw new RuntimeException($message); }
$fixture = json_decode(file_get_contents(__DIR__ . '/bitrix-fixture.json'), true);
$config = $fixture['config']; $users = $fixture['users']; $snapshot = $fixture['snapshot'];
foreach (bitrix_rules()['stages'] as $status => $names) foreach ($names as $name) {
    $input = $snapshot; $input['stageName'] = $name;
    $record = normalize_record(bitrix_map_snapshot($input, $config, $users)['record']);
    check_bitrix($record['registryMeta']['bitrix']['dealStatus'] === $status, 'Stage: ' . $name);
    check_bitrix($record['registryMeta']['paymentStatus'] === ($status === 'Планируется' ? 'Планируется' : 'Предоплата'), 'Payment stage');
    check_bitrix($record['amount'] == 100000 && $record['registryMeta']['prepayment'] == 50000, 'Money');
    check_bitrix(payout_bonus_cents($record) === ($status === 'Завершена' ? 1200000 : 0), 'Bonus');
}
check_bitrix(bitrix_stage_status('  создать Счёт и Договор (М) ') === 'Планируется', 'Case and spaces');
foreach (bitrix_rules()['managers'] as $name) {
    $parts = explode(' ', $name);
    check_bitrix(bitrix_manager(['ID'=>'99','NAME'=>$parts[0],'LAST_NAME'=>$parts[1]], [['id'=>9,'login'=>'test','fullName'=>$name]], [])['id'] === 9, 'Allowlisted manager');
}
check_bitrix(bitrix_manager($snapshot['creator'], [], $config) === null, 'Missing account');
$duplicates = $users; $duplicates[] = $users[1];
check_bitrix(bitrix_manager($snapshot['creator'], $duplicates, $config) === null, 'Ambiguous account');
check_bitrix(bitrix_manager(['ID'=>'999','NAME'=>'Посторонний','LAST_NAME'=>'Сотрудник'], $users, $config) === null, 'Non-allowlisted account');
$event = ['event'=>'ONCRMDEALADD','auth'=>['domain'=>'portal.example','application_token'=>$config['eventToken']],'data'=>['FIELDS'=>['ID'=>'17000']]];
check_bitrix(bitrix_authenticate($event, $config) === '17000', 'Valid event');
$bad = $event; $bad['auth']['domain'] = 'evil.example';
try { bitrix_authenticate($bad, $config); throw new RuntimeException('Accepted untrusted domain'); } catch (BitrixException $expected) { check_bitrix($expected->getCode() === 403, 'Forbidden'); }
$bad = $event; $bad['auth']['application_token'] = 'bad';
try { bitrix_authenticate($bad, $config); throw new RuntimeException('Accepted bad token'); } catch (BitrixException $expected) {}
$bad = $snapshot; $bad['deal']['UF_PAID'] = 'broken';
try { bitrix_map_snapshot($bad, $config, $users); throw new RuntimeException('Accepted invalid money'); } catch (BitrixException $expected) {}
$input = $snapshot; $input['stageName'] = 'В ПРОИЗВОДСТВЕ (пр)'; $input['deal']['UF_PAID'] = '100 000,00|RUB';
$active = normalize_record(bitrix_map_snapshot($input, $config, $users)['record']);
$active['registryMeta']['closingDocs'] = 'Отправлены';
check_bitrix($active['registryMeta']['paymentStatus'] === 'Да' && payout_bonus_cents($active) === 0, 'Full payment never closes a CRM deal');
$input['stageName'] = bitrix_rules()['stages']['Завершена'][0];
$complete = normalize_record(bitrix_map_snapshot($input, $config, $users, $active)['record']);
check_bitrix(payout_qualification_date($complete, $complete, '2026-09-10T10:00:00Z') === '2026-09-10T10:00:00Z', 'Stable bonus date');
check_bitrix(payout_qualification_date($active, $complete, '2026-09-10T10:00:00Z') === '', 'Reopening revokes bonus');
$complete['ownerId'] = 2; $complete['bonusQualifiedAt'] = '2026-09-10T10:00:00Z';
check_bitrix(payout_build_report([$complete], $users, [], $users[1], [])['allTime']['accrued'] == 12000, 'Report accrual');
$forged = bitrix_preserve_fields(['registryMeta'=>['bitrix'=>['dealStatus'=>'Завершена']]], null);
check_bitrix(!isset($forged['registryMeta']['bitrix']), 'Client cannot forge CRM metadata');
echo "PHP Bitrix rules and bonuses passed\n";

if (!getenv('PAYOUT_TEST_MYSQL')) exit;
// Reuse the isolated CI database prepared by payouts-php.php; no production config.
$database = ['db_host'=>'127.0.0.1','db_name'=>'manager_payout_test','db_user'=>'root','db_password'=>'isolated-test-only'];
$pdo = open_database($database);
$pdo->exec("UPDATE manager_users SET full_name = 'Антон Исаков' WHERE id = 2");
$remote = $snapshot;
$call = static function ($method, $params) use (&$remote) {
    if ($method === 'crm.deal.get') return $remote['deal'];
    if ($method === 'user.get') return [$remote['creator']];
    return [['STATUS_ID'=>$params['filter']['STATUS_ID'], 'NAME'=>$params['filter']['ENTITY_ID'] === 'SOURCE' ? $remote['source'] : $remote['stageName']]];
};
$before = $pdo->query('SELECT * FROM manager_contracts ORDER BY record_number')->fetchAll();
bitrix_sync($pdo, $config, '17000', $call);
bitrix_sync($pdo, $config, '17000', $call);
check_bitrix((int) $pdo->query("SELECT COUNT(*) FROM manager_contracts WHERE record_number = '17000'")->fetchColumn() === 1, 'Idempotent insert');
check_bitrix((int) $pdo->query("SELECT owner_id FROM manager_contracts WHERE record_number = '17000'")->fetchColumn() === 2, 'Creator owns deal');
$after = $pdo->query("SELECT * FROM manager_contracts WHERE record_number <> '17000' ORDER BY record_number")->fetchAll();
check_bitrix($before === $after, 'Existing records unchanged');
$remote['stageName'] = 'Сделка завершена. Документы подписаны.';
bitrix_sync($pdo, $config, '17000', $call);
$date = $pdo->query("SELECT qualified_at FROM manager_bonus_qualification WHERE record_number = '17000'")->fetchColumn();
check_bitrix(strlen($date) > 10, 'Completion stamps qualification');
bitrix_sync($pdo, $config, '17000', $call);
check_bitrix($pdo->query("SELECT qualified_at FROM manager_bonus_qualification WHERE record_number = '17000'")->fetchColumn() === $date, 'Repeated completion preserves timestamp');
$stored = $pdo->query("SELECT * FROM manager_contracts WHERE record_number = '17000'")->fetch();
$remote['deal']['UF_PAID'] = 'bad';
try { bitrix_sync($pdo, $config, '17000', $call); throw new RuntimeException('Accepted bad remote data'); } catch (BitrixException $expected) {}
check_bitrix($stored === $pdo->query("SELECT * FROM manager_contracts WHERE record_number = '17000'")->fetch(), 'Failure rolled back');
$remote = $snapshot; $remote['stageName'] = 'ЗАМЕР (пр)';
bitrix_sync($pdo, $config, '17000', $call);
check_bitrix($pdo->query("SELECT qualified_at FROM manager_bonus_qualification WHERE record_number = '17000'")->fetchColumn() === '', 'Reopening revokes qualification');
$remote['deal']['ID'] = '17001'; $config['numberField'] = 'TEST_NUMBER'; $remote['deal']['TEST_NUMBER'] = '17000';
try { bitrix_sync($pdo, $config, '17001', $call); throw new RuntimeException('Accepted number collision'); } catch (BitrixException $expected) { check_bitrix($expected->getCode() === 409, 'Number collision'); }
check_bitrix((int) $pdo->query("SELECT COUNT(*) FROM manager_bitrix_deals WHERE deal_id = '17001'")->fetchColumn() === 0, 'Conflict does not leave an orphan link');
echo "PHP Bitrix MySQL transaction checks passed\n";
