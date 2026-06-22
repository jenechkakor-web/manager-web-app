<?php

function find_dadata_party($token, $inn)
{
    if (!function_exists('curl_init')) {
        respond(['error' => 'Поиск по ИНН временно недоступен.'], 503);
    }

    $handle = curl_init('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party');
    curl_setopt_array($handle, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: Token ' . $token,
        ],
        CURLOPT_POSTFIELDS => json_encode(['query' => $inn]),
    ]);
    $response = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    $curlError = curl_error($handle);
    curl_close($handle);

    if ($response === false || $status < 200 || $status >= 300) {
        error_log('DaData request failed with status ' . $status . ($curlError !== '' ? ': ' . $curlError : ''));
        respond(['error' => 'Не удалось получить данные по ИНН. Заполните реквизиты вручную.'], 502);
    }

    $result = json_decode($response, true);
    if (!is_array($result)) {
        respond(['error' => 'DaData вернула некорректный ответ.'], 502);
    }
    $suggestions = isset($result['suggestions']) && is_array($result['suggestions']) ? $result['suggestions'] : [];
    return isset($suggestions[0]) && is_array($suggestions[0]) ? $suggestions[0] : null;
}
