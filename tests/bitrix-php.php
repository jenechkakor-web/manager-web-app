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
foreach (['', null, false, '100000.00|RUB'] as $value) {
    $input = $snapshot; $input['stageName'] = 'ЗАМЕР (пр)'; $input['deal']['UF_PAID'] = $value;
    $paid = normalize_record(bitrix_map_snapshot($input, $config, $users)['record']);
    check_bitrix($paid['registryMeta']['paymentStatus'] === 'Да' && $paid['registryMeta']['prepayment'] == 100000, 'Empty or equal advance means full payment');
    check_bitrix(payout_bonus_cents($paid) === 0, 'Full payment in production does not accrue');
}
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
$settings = bitrix_updated_config($config, ['webhookUrl'=>'','eventToken'=>'','paidAmountField'=>'UF_PAID']);
check_bitrix($settings['eventToken'] === $config['eventToken'], 'Blank credentials retain saved values');
$publicSettings = json_encode(bitrix_configuration_status($settings, $users));
check_bitrix(strpos($publicSettings, 'test-token') === false && strpos($publicSettings, 'test-event-token') === false, 'No credentials in API status');
try { bitrix_updated_config($config, ['paidAmountField'=>'bad field']); throw new RuntimeException('Accepted invalid config'); } catch (BitrixException $expected) {}
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

unset($config['numberField']);
$remote = $snapshot; $remote['deal']['ID'] = '17002';
$manual = normalize_record(['number'=>'17002','amount'=>20000,'data'=>['customer'=>['name'=>'Сохранить реквизиты']],
    'registryMeta'=>['title'=>'Ручная запись','source'=>'Директ','bonusType'=>'5%','closingDocs'=>'Отправлены']]);
save_record($pdo,$manual,['id'=>2,'role'=>'user']);
$manualRow = $pdo->query("SELECT * FROM manager_contracts WHERE record_number = '17002'")->fetch();
$runId = '12345678-1234-4234-8234-123456789abc';
$result = bitrix_refresh_record($pdo,$config,'17002',$runId,1,$call);
check_bitrix($result['synced'] && $result['amount'] == 100000, 'Existing deal refreshed');
$adopted = fetch_record($pdo,['id'=>1,'role'=>'admin'],'17002');
check_bitrix($adopted['data'] === $manual['data'] && $adopted['registryMeta']['bonusType'] === '5%', 'Manual document and bonus type preserved');
check_bitrix($adopted['registryMeta']['bitrix']['dealId'] === '17002', 'Existing record linked');
$audit = json_decode($pdo->query("SELECT previous_json FROM manager_bitrix_refresh_history WHERE record_number = '17002'")->fetchColumn(),true);
check_bitrix($audit['record'] === $manualRow, 'Full previous database row backed up');
$remote['deal']['OPPORTUNITY'] = '200000';
check_bitrix(bitrix_refresh_record($pdo,$config,'17002',$runId,1,$call) === $result, 'Same run replay does not apply another snapshot');
check_bitrix(fetch_record($pdo,['id'=>1,'role'=>'admin'],'17002')['amount'] == 100000, 'Replay keeps original result');
bitrix_sync($pdo,$config,'17002',$call);
check_bitrix(fetch_record($pdo,['id'=>1,'role'=>'admin'],'17002')['amount'] == 200000, 'Future events update adopted records');
$manual['number']='17003'; save_record($pdo,$manual,['id'=>1,'role'=>'admin']); $remote['deal']['ID']='17003';
check_bitrix(bitrix_refresh_record($pdo,$config,'17003',$runId,1,$call)['skipped'] === 'creator_mismatch', 'Wrong creator skipped');
check_bitrix((int)$pdo->query("SELECT COUNT(*) FROM manager_bitrix_deals WHERE deal_id = '17003'")->fetchColumn() === 0, 'Skipped record has no link');
$manual['number']='17002_2'; save_record($pdo,$manual,['id'=>2,'role'=>'user']);
check_bitrix(bitrix_refresh_record($pdo,$config,'17002_2',$runId,1,$call)['skipped'] === 'needs_deal_id', 'Suffix never guessed');
check_bitrix(bitrix_refresh_record($pdo,$config,'99999',$runId,1,$call)['skipped'] === 'record_deleted', 'Refresh never creates a missing registry record');
echo "PHP Bitrix existing-registry refresh checks passed\n";
