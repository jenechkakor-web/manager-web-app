<?php
define('MANAGER_API_TEST_MODE', true);
require dirname(__DIR__) . '/api/index.php';
function check_bitrix($condition, $message) { if (!$condition) throw new RuntimeException($message); }
$fixture = json_decode(file_get_contents(__DIR__ . '/bitrix-fixture.json'), true);
$config = $fixture['config']; $users = $fixture['users']; $snapshot = $fixture['snapshot'];
foreach (bitrix_rules()['stages'] as $names) foreach ($names as $name) {
    $input=$snapshot; $input['stageName']=$name; $input['deal']['UF_PAID']='invalid'; $input['deal']['DATE_CREATE']='invalid';
    $record=normalize_record(bitrix_map_snapshot($input,$config,$users)['record']);
    check_bitrix($record['registryMeta']['paymentStatus']==='Планируется' && $record['registryMeta']['prepayment']==0,'CRM cannot set payment');
    check_bitrix(!isset($record['registryMeta']['bitrix']['dealStatus']) && payout_bonus_cents($record)===0,'No CRM status or bonus');
    check_bitrix($record['date']===payout_today() && $record['amount']==100000,'Registry date and CRM amount');
}
foreach (bitrix_rules()['managers'] as $name) {
    $parts = explode(' ', $name);
    check_bitrix(bitrix_manager(['ID'=>'99','NAME'=>$parts[0],'LAST_NAME'=>$parts[1]], [['id'=>9,'login'=>'test','fullName'=>$name]], [])['id'] === 9, 'Allowlisted manager');
}
check_bitrix(bitrix_manager($snapshot['creator'], [], $config) === null, 'Missing account');
$duplicates = $users; $duplicates[] = $users[1];
check_bitrix(bitrix_manager($snapshot['creator'], $duplicates, $config) === null, 'Ambiguous account');
check_bitrix(bitrix_manager(['ID'=>'999','NAME'=>'Посторонний','LAST_NAME'=>'Сотрудник'], $users, $config) === null, 'Non-allowlisted account');
$alexey = ['ID'=>'1','NAME'=>'Алексей','LAST_NAME'=>'Купоров'];
$linkedAdmin = $users[0]; $linkedAdmin['fullName'] = 'Алексей Купоров';
check_bitrix(bitrix_manager($alexey, [$linkedAdmin], $config)['id'] === 1, 'Alexey Kuporov maps to existing admin by full name');
check_bitrix(bitrix_manager($alexey, $users, $config) === null, 'Admin role without matching full name does not grant mapping');
check_bitrix(bitrix_manager(['ID'=>'24','NAME'=>'Алексей','LAST_NAME'=>'Болдов'], [$linkedAdmin], $config) === null, 'Other Alexey is not allowlisted');
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
$bad = $snapshot; $bad['deal']['OPPORTUNITY'] = 'broken';
try { bitrix_map_snapshot($bad, $config, $users); throw new RuntimeException('Accepted invalid money'); } catch (BitrixException $expected) {}
$active=normalize_record(bitrix_map_snapshot($snapshot,$config,$users)['record']);
$active['date']='2025-02-03'; $active['registryMeta']['paymentStatus']='Да'; $active['registryMeta']['prepayment']=100000;
$active['registryMeta']['closingDocs']='Отправлены'; $active['registryMeta']['paymentType']='Наличка';
$complete=normalize_record(bitrix_map_snapshot($snapshot,$config,$users,$active)['record']);
check_bitrix($complete['date']==='2025-02-03' && $complete['registryMeta']['paymentType']==='Наличка','Local fields preserved');
check_bitrix(payout_bonus_cents($complete)===1200000,'Internal completion earns bonus');
check_bitrix(payout_qualification_date($complete,$complete,'2026-09-10T10:00:00Z')==='2026-09-10T10:00:00Z','Stable bonus date');
$active['registryMeta']['paymentStatus']='Предоплата'; $active['registryMeta']['bitrix']['dealStatus']='Завершена';
check_bitrix(payout_bonus_cents($active)===0,'Legacy CRM status ignored');
check_bitrix(payout_qualification_date($active,$complete,'2026-09-10T10:00:00Z')==='','Internal reopening revokes bonus');
$lastCall=[];
$recentCall=static function($method,$params) use($snapshot,&$lastCall) {
    if($method==='user.get') return [$snapshot['creator']];
    $lastCall=$params; $rows=[]; for($i=0;$i<8;$i++) $rows[]=['ID'=>(string)(18020-$i),'CREATED_BY_ID'=>$snapshot['creator']['ID']]; return $rows;
};
check_bitrix(bitrix_recent_ids($config,$users,$users[1],$recentCall)===['18020','18019','18018','18017','18016'],'Five recent deals');
check_bitrix($lastCall['filter']===['CREATED_BY_ID'=>$snapshot['creator']['ID']],'Only creator filter');
try { bitrix_recent_ids($config,$users,$users[0],$recentCall); throw new RuntimeException('Unmapped admin accepted'); } catch(BitrixException $expected) {}
$edited=registry_apply_fields($active,['title'=>'Вручную','source'=>'Сарафан','date'=>'2026-01-02','amount'=>123456],$users[1],$users);
check_bitrix($edited['date']==='2026-01-02' && $edited['amount']==123456 && $edited['registryMeta']['source']==='Сарафан','CRM rows editable');
foreach ([['number'=>'other'],['manager'=>'admin'],['recordStatus'=>'exported'],['amount'=>1],['bonusAmount'=>123]] as $fields) {
    try { registry_apply_fields($active,$fields,$users[1],$users); throw new RuntimeException('Invalid edit accepted'); } catch(BitrixException $expected) {}
}
foreach (['ip'=>'ИП','ooo'=>'ООО'] as $key=>$type) {
    $invoice=normalize_record(['number'=>'INV','status'=>'exported','data'=>['sellerKey'=>$key]]);
    check_bitrix($invoice['registryMeta']['paymentType']===$type,'Invoice issuer auto payment type');
}
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
check_bitrix($date === '', 'CRM completion never stamps qualification');
$internal=fetch_record($pdo,['id'=>2,'role'=>'user'],'17000');
$internal['registryMeta']['paymentStatus']='Да';$internal['registryMeta']['prepayment']=100000;$internal['registryMeta']['closingDocs']='Отправлены';
save_record($pdo,$internal,['id'=>2,'role'=>'user']);
$date=$pdo->query("SELECT qualified_at FROM manager_bonus_qualification WHERE record_number = '17000'")->fetchColumn();
check_bitrix(strlen($date)>10,'Internal completion stamps qualification');
bitrix_sync($pdo, $config, '17000', $call);
check_bitrix($pdo->query("SELECT qualified_at FROM manager_bonus_qualification WHERE record_number = '17000'")->fetchColumn() === $date, 'Repeated completion preserves timestamp');
$stored = $pdo->query("SELECT * FROM manager_contracts WHERE record_number = '17000'")->fetch();
$remote['deal']['OPPORTUNITY'] = 'bad';
try { bitrix_sync($pdo, $config, '17000', $call); throw new RuntimeException('Accepted bad remote data'); } catch (BitrixException $expected) {}
check_bitrix($stored === $pdo->query("SELECT * FROM manager_contracts WHERE record_number = '17000'")->fetch(), 'Failure rolled back');
$remote = $snapshot; $remote['stageName'] = 'ЗАМЕР (пр)';
bitrix_sync($pdo, $config, '17000', $call);
check_bitrix($pdo->query("SELECT qualified_at FROM manager_bonus_qualification WHERE record_number = '17000'")->fetchColumn() === $date, 'CRM reopening preserves internal qualification');
$remote['deal']['ID'] = '17001'; $config['numberField'] = 'TEST_NUMBER'; $remote['deal']['TEST_NUMBER'] = '17000';
try { bitrix_sync($pdo, $config, '17001', $call); throw new RuntimeException('Accepted number collision'); } catch (BitrixException $expected) { check_bitrix($expected->getCode() === 409, 'Number collision'); }
check_bitrix((int) $pdo->query("SELECT COUNT(*) FROM manager_bitrix_deals WHERE deal_id = '17001'")->fetchColumn() === 0, 'Conflict does not leave an orphan link');
$remote=$snapshot; unset($config['numberField']);
try { bitrix_sync($pdo,$config,'17000',$call,null,1); throw new RuntimeException('Foreign recent sync accepted'); } catch(BitrixException $expected) { check_bitrix($expected->getCode()===403,'Creator scope enforced'); }
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
check_bitrix(json_encode(bitrix_refresh_record($pdo,$config,'17002',$runId,1,$call)) === json_encode($result), 'Same run replay returns the identical API response');
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
