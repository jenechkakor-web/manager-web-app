<?php
// Copy to bitrix.local.php on the server. Never commit the populated file.
return [
    'webhookUrl' => 'https://verkup.bitrix24.ru/rest/USER_ID/INCOMING_TOKEN/',
    'eventToken' => 'OUTGOING_APPLICATION_TOKEN',
    // Portal rule: empty advance = full payment; equal to OPPORTUNITY = full payment.
    'paidAmountField' => 'UF_CRM_1547663414463',
    // Optional full-payment checkbox/list and its exact stored values.
    'fullPaymentField' => '',
    'fullPaymentValues' => ['Y', '1', 'Да'],
    // Empty means the Bitrix deal ID. The registry key is fixed on first import.
    'numberField' => '',
    // Default: match the user's full name in the admin Users page.
    // Optional precise bindings: 'Антон Исаков' => ['login' => 'anton', 'bitrixId' => '138'].
    'managers' => [],
    // Optional SOURCE_ID => registry source label. Otherwise preserve the Bitrix label.
    'sourceMap' => [],
];
