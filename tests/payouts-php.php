<?php
define('MANAGER_API_TEST_MODE', true);
require dirname(__DIR__) . '/api/index.php';
function check($condition, $message) { if (!$condition) throw new RuntimeException($message); }
$admin = ['id' => 1, 'login' => 'admin', 'role' => 'admin'];
$manager = ['id' => 2, 'login' => 'manager', 'role' => 'user'];
$users = [$admin, $manager, ['id' => 3, 'login' => 'other', 'role' => 'user']];
$record = ['number' => 'A1', 'ownerId' => 2, 'date' => '2026-06-15', 'amount' => 10000, 'counterparty' => 'Test',
    'registryMeta' => ['title' => 'Test', 'paymentStatus' => 'Да', 'prepayment' => 10000, 'closingDocs' => 'Отправлены', 'bonusType' => '12%', 'bonusAmount' => 250],
    'bonusQualifiedAt' => '2026-07-10T10:00:00Z'];
check(payout_bonus_cents($record) === 120000, '12 percent');
foreach ([['closingDocs' => 'Не нужно'], ['closingDocs' => 'Не отправлены'], ['paymentStatus' => 'Предоплата'], ['prepayment' => 9999.99]] as $patch) {
    $pending = $record; $pending['registryMeta'] = array_merge($record['registryMeta'], $patch);
    check(payout_bonus_cents($pending) === 0, 'Ineligible deal must not accrue');
}
$salary = $record; $salary['registryMeta']['bonusType'] = 'оклад';
check(payout_bonus_cents($salary) === 0, 'salary');
$salary['registryMeta']['bonusType'] = 'от прибыли';
check(payout_bonus_cents($salary) === 25000, 'profit');
$unknown = $record; $unknown['number'] = 'OLD'; $unknown['bonusQualifiedAt'] = '';
$other = $record; $other['ownerId'] = 3; $other['amount'] = 999999;
$ledger = [
    ['id' => 'p', 'kind' => 'payment', 'date' => '2026-08-02', 'managerId' => 2, 'managerLogin' => 'manager', 'amountCents' => 40000, 'reason' => '', 'createdByLogin' => 'admin'],
    ['id' => 'a', 'kind' => 'accrual', 'date' => '2026-08-01', 'managerId' => 2, 'managerLogin' => 'manager', 'amountCents' => 10000, 'reason' => 'оклад', 'createdByLogin' => 'admin']
];
$report = payout_build_report([$record,$unknown,$other], $users, $ledger, $manager, ['month' => '2026-08','manager' => '3']);
check($report['totals']['revenue'] == 0 && $report['totals']['accrued'] == 100 && $report['totals']['paid'] == 400, 'period totals');
check($report['openingBalance'] == 1200 && $report['closingBalance'] == 900 && $report['allTime']['balance'] == 2100, 'balances');
check($report['undatedAccrued'] == 1200 && count($report['managers']) === 1, 'legacy and ownership');
foreach ($report['entries'] as $entry) check($entry['managerId'] === 2, 'owner isolation');
check(payout_qualification_date($record, $record, '') === '', 'Historical date must not be invented');
check(payout_qualification_date($record, $record, '2026-07-10T10:00:00Z') === '2026-07-10T10:00:00Z', 'Date remains unchanged');
check(payout_qualification_date($pending, $record, '2026-07-10T10:00:00Z') === '', 'Revoking clears date');
check(strlen(payout_qualification_date($record, $pending, '')) > 10, 'New eligibility gets timestamp');
$midnight = $record; $midnight['bonusQualifiedAt'] = '2026-07-09T22:00:00Z';
check(payout_build_report([$midnight], $users, [], $manager, ['from' => '2026-07-10','to' => '2026-07-10'])['totals']['accrued'] == 1200, 'Moscow timezone');
foreach ([['from'=>'2026-02-30'],['from'=>'2026-09-09','to'=>'2026-08-01'],['month'=>'invalid'],['manager'=>[]]] as $query) {
    try { payout_build_report([], $users, [], $admin, $query); throw new RuntimeException('Invalid filter accepted'); }
    catch (InvalidArgumentException $expected) {}
}
echo "PHP payout calculations passed\n";

if (!getenv('PAYOUT_TEST_MYSQL')) exit;
// Explicitly confined to the disposable CI database; never use a production configuration.
$config = ['db_host' => '127.0.0.1', 'db_name' => 'manager_payout_test', 'db_user' => 'root', 'db_password' => 'isolated-test-only',
    'admin_login' => 'admin', 'admin_password' => 'TestPassword2026'];
$pdo = open_database($config);
$pdo->exec("CREATE TABLE manager_contracts (record_number VARCHAR(191) NOT NULL PRIMARY KEY, owner_id INT UNSIGNED NULL,
    contract_date VARCHAR(32) NOT NULL DEFAULT '', counterparty VARCHAR(255) NOT NULL DEFAULT '', amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'draft', updated_at VARCHAR(40) NOT NULL, data_json LONGTEXT NOT NULL,
    registry_meta_json LONGTEXT NULL, KEY owner_id (owner_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
$pdo->prepare('INSERT INTO manager_contracts VALUES (?,?,?,?,?,?,?,?,?)')->execute(['EXISTING',1,'2026-06-15','Keep me',10000,'draft','2026-06-15T00:00:00Z','{"sentinel":"untouched"}',json_encode($record['registryMeta'])]);
$before = $pdo->query('SELECT * FROM manager_contracts')->fetchAll();
initialize_database($pdo, $config);
$after = $pdo->query('SELECT * FROM manager_contracts')->fetchAll();
check($before === $after, 'Migration changed existing contract');
$manifest = json_decode($pdo->query('SELECT backup_manifest FROM manager_payout_migrations WHERE version = 1')->fetchColumn(), true);
check($pdo->query('SELECT * FROM `' . $manifest['manager_contracts']['table'] . '`')->fetchAll() === $before, 'Backup content mismatch');
initialize_database($pdo, $config);
check((int) $pdo->query('SELECT COUNT(*) FROM manager_payout_migrations')->fetchColumn() === 1, 'Migration idempotence');
$statement = $pdo->prepare('INSERT INTO manager_users (login,password_hash,role,created_at) VALUES (?,?,?,?)');
foreach (['manager','other'] as $login) $statement->execute([$login,password_hash('TestPassword2026', PASSWORD_DEFAULT),'user',gmdate('c')]);
$pdo->beginTransaction();
$next = $record; $next['number'] = 'EXISTING';
payout_stamp_record($pdo, $next, $record);
$pdo->commit();
check($pdo->query('SELECT qualified_at FROM manager_bonus_qualification')->fetchColumn() === '', 'Existing dates remain unknown');
check(count(payout_report($pdo, $admin, [])['entries']) === 2, 'Database report');
echo "MySQL migration, backup, idempotence and preservation passed\n";
