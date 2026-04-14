<?php

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$config = require dirname(__DIR__) . '/config.php';

try {
    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=%s',
        $config['db_host'],
        $config['db_name'],
        $config['db_charset']
    );

    $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (Throwable $e) {
    respond(['error' => 'Database connection failed'], 500);
}

$route = getRoute();
$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($method === 'GET' && $route === '/board-name') {
        $stmt = $pdo->query('SELECT name FROM board_settings WHERE id = 1 LIMIT 1');
        $row = $stmt->fetch();
        respond(['name' => $row['name'] ?? 'Meu Quadro']);
    }

    if ($method === 'PUT' && $route === '/board-name') {
        $body = getJsonBody();
        $name = trim((string)($body['name'] ?? ''));

        if ($name === '') {
            respond(['error' => 'Missing board name'], 400);
        }

        $stmt = $pdo->prepare(
            'INSERT INTO board_settings (id, name) VALUES (1, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)'
        );
        $stmt->execute([$name]);

        respond(['success' => true, 'name' => $name]);
    }

    if ($method === 'GET' && $route === '/board') {
        $columns = $pdo->query('SELECT * FROM columns ORDER BY order_index ASC')->fetchAll();
        $cards = $pdo->query('SELECT * FROM cards WHERE archived = 0 ORDER BY order_index ASC')->fetchAll();

        $cardsByColumn = [];
        foreach ($cards as $card) {
            $card['actions'] = decodeJsonList($card['actions'] ?? null, 'actions');
            $card['comments'] = decodeJsonList($card['comments'] ?? null, 'comments');
            $cardsByColumn[(string)$card['column_id']][] = $card;
        }

        $board = [];
        foreach ($columns as $column) {
            $column['cards'] = $cardsByColumn[(string)$column['id']] ?? [];
            $board[] = $column;
        }

        respond($board);
    }

    if ($method === 'POST' && $route === '/cards') {
        $body = getJsonBody();
        $columnId = (int)($body['column_id'] ?? 0);
        $content = trim((string)($body['content'] ?? ''));

        if ($columnId <= 0 || $content === '') {
            respond(['error' => 'Missing column_id or content'], 400);
        }

        $subject = normalizeNullableText($body['subject'] ?? null);
        $notes = normalizeNullableText($body['notes'] ?? null);
        $comments = sanitizeComments($body['comments'] ?? []);
        $actions = sanitizeActions($body['actions'] ?? []);
        $priority = sanitizePriority($body['priority'] ?? null);
        $dueDate = sanitizeDate($body['due_date'] ?? null);
        $blockedReason = sanitizeNullableText($body['blocked_reason'] ?? null);
        $blockedUntil = sanitizeDate($body['blocked_until'] ?? null);

        $stmt = $pdo->prepare('SELECT COALESCE(MAX(order_index), 0) AS max_order FROM cards WHERE column_id = ?');
        $stmt->execute([$columnId]);
        $maxOrder = (int)($stmt->fetch()['max_order'] ?? 0);
        $orderIndex = $maxOrder + 1;

        $stmt = $pdo->prepare(
            'INSERT INTO cards (column_id, content, subject, notes, comments, due_date, actions, priority, blocked_reason, blocked_until, archived, archived_at, order_index)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)'
        );
        $stmt->execute([
            $columnId,
            $content,
            $subject,
            $notes,
            json_encode($comments),
            $dueDate,
            json_encode($actions),
            $priority,
            $blockedReason,
            $blockedUntil,
            $orderIndex,
        ]);

        respond([
            'id' => (int)$pdo->lastInsertId(),
            'column_id' => $columnId,
            'content' => $content,
            'subject' => $subject,
            'notes' => $notes,
            'comments' => $comments,
            'due_date' => $dueDate,
            'actions' => $actions,
            'priority' => $priority,
            'blocked_reason' => $blockedReason,
            'blocked_until' => $blockedUntil,
            'order_index' => $orderIndex,
        ], 201);
    }

    if ($method === 'PUT' && preg_match('#^/cards/(\d+)/move$#', $route, $m)) {
        $cardId = (int)$m[1];
        $body = getJsonBody();
        $columnId = (int)($body['column_id'] ?? 0);

        if ($columnId <= 0) {
            respond(['error' => 'Missing column_id'], 400);
        }

        $stmt = $pdo->prepare('SELECT title FROM columns WHERE id = ? LIMIT 1');
        $stmt->execute([$columnId]);
        $column = $stmt->fetch();

        if (!$column) {
            respond(['error' => 'Column not found'], 404);
        }

        $isBlocked = strtolower(trim((string)$column['title'])) === 'blocked';
        $blockedReason = sanitizeNullableText($body['blocked_reason'] ?? null);
        $blockedUntil = sanitizeDate($body['blocked_until'] ?? null);

        if ($isBlocked) {
            if ($blockedReason && $blockedUntil) {
                $stmt = $pdo->prepare('UPDATE cards SET column_id = ?, blocked_reason = ?, blocked_until = ? WHERE id = ?');
                $stmt->execute([$columnId, $blockedReason, $blockedUntil, $cardId]);
            } elseif ($blockedReason === null && $blockedUntil === null) {
                $stmt = $pdo->prepare('UPDATE cards SET column_id = ? WHERE id = ?');
                $stmt->execute([$columnId, $cardId]);
            } else {
                respond(['error' => 'Missing blocked_reason or blocked_until for Blocked column'], 400);
            }
        } else {
            $stmt = $pdo->prepare('UPDATE cards SET column_id = ?, blocked_reason = NULL, blocked_until = NULL WHERE id = ?');
            $stmt->execute([$columnId, $cardId]);
        }

        $stmt = $pdo->prepare('SELECT blocked_reason, blocked_until FROM cards WHERE id = ? LIMIT 1');
        $stmt->execute([$cardId]);
        $card = $stmt->fetch() ?: [];

        respond([
            'success' => true,
            'blocked_reason' => $isBlocked ? ($card['blocked_reason'] ?? null) : null,
            'blocked_until' => $isBlocked ? ($card['blocked_until'] ?? null) : null,
        ]);
    }

    if ($method === 'PUT' && preg_match('#^/cards/(\d+)$#', $route, $m)) {
        $cardId = (int)$m[1];
        $body = getJsonBody();

        $content = trim((string)($body['content'] ?? ''));
        if ($content === '') {
            respond(['error' => 'Missing content'], 400);
        }

        $subject = normalizeNullableText($body['subject'] ?? null);
        $notes = normalizeNullableText($body['notes'] ?? null);
        $actions = sanitizeActions($body['actions'] ?? []);
        $priority = sanitizePriority($body['priority'] ?? null);
        $dueDate = sanitizeDate($body['due_date'] ?? null);
        $blockedReason = sanitizeNullableText($body['blocked_reason'] ?? null);
        $blockedUntil = sanitizeDate($body['blocked_until'] ?? null);

        if ($blockedReason && !$blockedUntil) {
            respond(['error' => 'Missing blocked_until when blocked_reason is provided'], 400);
        }

        $stmt = $pdo->prepare(
            'UPDATE cards
             SET content = ?, subject = ?, due_date = ?, actions = ?, priority = ?, blocked_reason = ?, blocked_until = ?, notes = ?
             WHERE id = ?'
        );
        $stmt->execute([
            $content,
            $subject,
            $dueDate,
            json_encode($actions),
            $priority,
            $blockedReason,
            $blockedUntil,
            $notes,
            $cardId,
        ]);

        respond([
            'success' => true,
            'card' => [
                'id' => $cardId,
                'content' => $content,
                'subject' => $subject,
                'notes' => $notes,
                'due_date' => $dueDate,
                'actions' => $actions,
                'priority' => $priority,
                'blocked_reason' => $blockedReason,
                'blocked_until' => $blockedUntil,
            ],
        ]);
    }

    if ($method === 'PUT' && preg_match('#^/cards/(\d+)/actions$#', $route, $m)) {
        $cardId = (int)$m[1];
        $body = getJsonBody();
        $actions = sanitizeActions($body['actions'] ?? []);

        $stmt = $pdo->prepare('UPDATE cards SET actions = ? WHERE id = ?');
        $stmt->execute([json_encode($actions), $cardId]);

        respond(['success' => true, 'actions' => $actions]);
    }

    if ($method === 'PUT' && preg_match('#^/cards/(\d+)/comments$#', $route, $m)) {
        $cardId = (int)$m[1];
        $body = getJsonBody();
        $comments = sanitizeComments($body['comments'] ?? []);

        $stmt = $pdo->prepare('UPDATE cards SET comments = ? WHERE id = ?');
        $stmt->execute([json_encode($comments), $cardId]);

        respond(['success' => true, 'comments' => $comments]);
    }

    if ($method === 'PUT' && preg_match('#^/cards/(\d+)/archive$#', $route, $m)) {
        $cardId = (int)$m[1];

        $stmt = $pdo->prepare(
            'SELECT cards.id, cards.archived, columns.title AS column_title
             FROM cards
             INNER JOIN columns ON cards.column_id = columns.id
             WHERE cards.id = ?
             LIMIT 1'
        );
        $stmt->execute([$cardId]);
        $card = $stmt->fetch();

        if (!$card) {
            respond(['error' => 'Card not found'], 404);
        }

        if (strtolower(trim((string)$card['column_title'])) !== 'done') {
            respond(['error' => 'Card can only be archived from Done column'], 400);
        }

        if ((int)$card['archived'] !== 1) {
            $stmt = $pdo->prepare('UPDATE cards SET archived = 1, archived_at = NOW() WHERE id = ?');
            $stmt->execute([$cardId]);
        }

        respond(['success' => true]);
    }

    if ($method === 'GET' && $route === '/cards/archived') {
        $rows = $pdo->query(
            'SELECT cards.*, columns.title AS column_title
             FROM cards
             INNER JOIN columns ON cards.column_id = columns.id
             WHERE cards.archived = 1
             ORDER BY cards.archived_at DESC, cards.id DESC'
        )->fetchAll();

        foreach ($rows as &$row) {
            $row['actions'] = decodeJsonList($row['actions'] ?? null, 'actions');
            $row['comments'] = decodeJsonList($row['comments'] ?? null, 'comments');
        }
        unset($row);

        respond($rows);
    }

    if ($method === 'PUT' && preg_match('#^/cards/(\d+)/unarchive$#', $route, $m)) {
        $cardId = (int)$m[1];

        $stmt = $pdo->query('SELECT id FROM columns WHERE LOWER(TRIM(title)) = "done" ORDER BY order_index ASC LIMIT 1');
        $done = $stmt->fetch();

        if (!$done) {
            respond(['error' => 'Done column not found'], 400);
        }

        $doneColumnId = (int)$done['id'];

        $stmt = $pdo->prepare('UPDATE cards SET archived = 0, archived_at = NULL, column_id = ? WHERE id = ?');
        $stmt->execute([$doneColumnId, $cardId]);

        respond(['success' => true, 'column_id' => $doneColumnId]);
    }

    if ($method === 'DELETE' && preg_match('#^/cards/(\d+)$#', $route, $m)) {
        $cardId = (int)$m[1];

        $stmt = $pdo->prepare('DELETE FROM cards WHERE id = ?');
        $stmt->execute([$cardId]);

        respond(['success' => true]);
    }

    respond(['error' => 'Route not found'], 404);
} catch (Throwable $e) {
    respond(['error' => 'Internal server error'], 500);
}

function getRoute(): string
{
    if (isset($_GET['route'])) {
        $route = '/' . ltrim((string)$_GET['route'], '/');
        return normalizeRoute($route);
    }

    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $script = $_SERVER['SCRIPT_NAME'] ?? '';

    if ($path !== false && $script && strpos($path, $script) === 0) {
        $path = substr($path, strlen($script));
    }

    return normalizeRoute((string)$path);
}

function normalizeRoute(string $route): string
{
    $route = trim($route);
    if ($route === '') {
        return '/';
    }

    return '/' . trim($route, '/');
}

function getJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function sanitizePriority($priority): string
{
    $valid = ['normal', 'ponderado', 'urgente'];
    $value = strtolower(trim((string)$priority));
    return in_array($value, $valid, true) ? $value : 'normal';
}

function sanitizeDate($value): ?string
{
    if ($value === null) {
        return null;
    }

    $date = substr(trim((string)$value), 0, 10);
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) === 1) {
        return $date;
    }

    return null;
}

function sanitizeNullableText($value): ?string
{
    $text = trim((string)$value);
    return $text === '' ? null : $text;
}

function normalizeNullableText($value): ?string
{
    if ($value === null) {
        return null;
    }

    return sanitizeNullableText($value);
}

function sanitizeActions($actions): array
{
    if (!is_array($actions)) {
        return [];
    }

    $out = [];
    foreach ($actions as $action) {
        if (is_string($action)) {
            $text = trim($action);
            if ($text !== '') {
                $out[] = ['text' => $text, 'done' => false];
            }
            continue;
        }

        if (is_array($action) && isset($action['text'])) {
            $text = trim((string)$action['text']);
            if ($text !== '') {
                $out[] = ['text' => $text, 'done' => !empty($action['done'])];
            }
        }
    }

    return $out;
}

function sanitizeComments($comments): array
{
    if (!is_array($comments)) {
        return [];
    }

    $out = [];
    foreach ($comments as $comment) {
        if (is_string($comment)) {
            $text = trim($comment);
            if ($text !== '') {
                $out[] = ['text' => $text, 'created_at' => null];
            }
            continue;
        }

        if (is_array($comment) && isset($comment['text'])) {
            $text = trim((string)$comment['text']);
            if ($text !== '') {
                $out[] = [
                    'text' => $text,
                    'created_at' => isset($comment['created_at']) ? (string)$comment['created_at'] : null,
                ];
            }
        }
    }

    return $out;
}

function decodeJsonList($value, string $type): array
{
    if ($value === null || $value === '') {
        return [];
    }

    if (is_array($value)) {
        return $type === 'comments' ? sanitizeComments($value) : sanitizeActions($value);
    }

    if (!is_string($value)) {
        return [];
    }

    $decoded = json_decode($value, true);
    if (!is_array($decoded)) {
        return [];
    }

    return $type === 'comments' ? sanitizeComments($decoded) : sanitizeActions($decoded);
}

function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}
