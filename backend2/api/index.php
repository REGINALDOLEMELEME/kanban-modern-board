<?php

header('Content-Type: application/json; charset=utf-8');
applyCorsHeaders();

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
    error_log('[kanban] DB connection failed: ' . $e->getMessage());
    respond(['error' => 'Database connection failed'], 500);
}

$route = getRoute();
$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($method === 'GET' && $route === '/logs') {
        $query = trim((string)($_GET['q'] ?? ''));
        $action = trim((string)($_GET['action'] ?? ''));
        $dateFrom = sanitizeDate($_GET['date_from'] ?? null);
        $dateTo = sanitizeDate($_GET['date_to'] ?? null);
        $perPage = (int)($_GET['per_page'] ?? ($_GET['limit'] ?? 10));
        if ($perPage < 1) {
            $perPage = 1;
        }
        if ($perPage > 100) {
            $perPage = 100;
        }
        $page = (int)($_GET['page'] ?? 1);
        if ($page < 1) {
            $page = 1;
        }
        $offset = ($page - 1) * $perPage;

        $whereSql = ' FROM change_logs WHERE 1 = 1';
        $params = [];

        if ($query !== '') {
            $whereSql .= ' AND (
                card_title LIKE :query
                OR details LIKE :query
                OR old_value LIKE :query
                OR new_value LIKE :query
                OR from_column LIKE :query
                OR to_column LIKE :query
            )';
            $params[':query'] = '%' . $query . '%';
        }

        if ($action !== '') {
            $whereSql .= ' AND action = :action';
            $params[':action'] = $action;
        }

        if ($dateFrom !== null) {
            $whereSql .= ' AND DATE(created_at) >= :date_from';
            $params[':date_from'] = $dateFrom;
        }

        if ($dateTo !== null) {
            $whereSql .= ' AND DATE(created_at) <= :date_to';
            $params[':date_to'] = $dateTo;
        }

        $countSql = 'SELECT COUNT(*) AS total_rows' . $whereSql;
        $countStmt = $pdo->prepare($countSql);
        foreach ($params as $key => $value) {
            $countStmt->bindValue($key, $value, PDO::PARAM_STR);
        }
        $countStmt->execute();
        $totalRows = (int)($countStmt->fetch()['total_rows'] ?? 0);
        $totalPages = max(1, (int)ceil($totalRows / $perPage));
        if ($page > $totalPages) {
            $page = $totalPages;
            $offset = ($page - 1) * $perPage;
        }

        $sql = 'SELECT id, card_id, card_title, action, field_name, old_value, new_value, from_column, to_column, details, created_at'
            . $whereSql
            . ' ORDER BY created_at DESC, id DESC LIMIT :limit_rows OFFSET :offset_rows';

        $stmt = $pdo->prepare($sql);
        foreach ($params as $key => $value) {
            $stmt->bindValue($key, $value, PDO::PARAM_STR);
        }
        $stmt->bindValue(':limit_rows', $perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset_rows', $offset, PDO::PARAM_INT);
        $stmt->execute();

        respond([
            'items' => $stmt->fetchAll(),
            'pagination' => [
                'page' => $page,
                'per_page' => $perPage,
                'total_rows' => $totalRows,
                'total_pages' => $totalPages,
            ],
        ]);
    }

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

    if ($method === 'GET' && $route === '/templates') {
        $rows = $pdo->query('SELECT id, name, content, subject, notes, priority, actions, created_at, updated_at FROM card_templates ORDER BY name ASC')->fetchAll();
        foreach ($rows as &$row) {
            $row['actions'] = decodeJsonList($row['actions'] ?? null, 'actions');
        }
        unset($row);
        respond($rows);
    }

    if ($method === 'POST' && $route === '/templates') {
        $body = getJsonBody();
        $name = trim((string)($body['name'] ?? ''));
        if ($name === '') {
            respond(['error' => 'Missing template name'], 400);
        }

        $content = normalizeNullableText($body['content'] ?? null);
        $subject = normalizeNullableText($body['subject'] ?? null);
        $notes = normalizeNullableText($body['notes'] ?? null);
        $priority = sanitizePriority($body['priority'] ?? null);
        $actions = sanitizeActions($body['actions'] ?? []);

        try {
            $stmt = $pdo->prepare(
                'INSERT INTO card_templates (name, content, subject, notes, priority, actions)
                 VALUES (?, ?, ?, ?, ?, ?)'
            );
            $stmt->execute([$name, $content, $subject, $notes, $priority, json_encode($actions, JSON_UNESCAPED_UNICODE)]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                respond(['error' => 'Já existe um modelo com esse nome.'], 409);
            }
            throw $e;
        }

        $id = (int)$pdo->lastInsertId();
        respond([
            'id' => $id,
            'name' => $name,
            'content' => $content,
            'subject' => $subject,
            'notes' => $notes,
            'priority' => $priority,
            'actions' => $actions,
        ], 201);
    }

    if ($method === 'PUT' && preg_match('#^/templates/(\d+)$#', $route, $m)) {
        $templateId = (int)$m[1];
        $body = getJsonBody();
        $name = trim((string)($body['name'] ?? ''));
        if ($name === '') {
            respond(['error' => 'Missing template name'], 400);
        }

        $stmt = $pdo->prepare('SELECT id FROM card_templates WHERE id = ? LIMIT 1');
        $stmt->execute([$templateId]);
        if (!$stmt->fetch()) {
            respond(['error' => 'Template not found'], 404);
        }

        $content = normalizeNullableText($body['content'] ?? null);
        $subject = normalizeNullableText($body['subject'] ?? null);
        $notes = normalizeNullableText($body['notes'] ?? null);
        $priority = sanitizePriority($body['priority'] ?? null);
        $actions = sanitizeActions($body['actions'] ?? []);

        try {
            $stmt = $pdo->prepare(
                'UPDATE card_templates SET name = ?, content = ?, subject = ?, notes = ?, priority = ?, actions = ? WHERE id = ?'
            );
            $stmt->execute([$name, $content, $subject, $notes, $priority, json_encode($actions, JSON_UNESCAPED_UNICODE), $templateId]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                respond(['error' => 'Já existe um modelo com esse nome.'], 409);
            }
            throw $e;
        }

        respond([
            'id' => $templateId,
            'name' => $name,
            'content' => $content,
            'subject' => $subject,
            'notes' => $notes,
            'priority' => $priority,
            'actions' => $actions,
        ]);
    }

    if ($method === 'DELETE' && preg_match('#^/templates/(\d+)$#', $route, $m)) {
        $templateId = (int)$m[1];
        $stmt = $pdo->prepare('DELETE FROM card_templates WHERE id = ?');
        $stmt->execute([$templateId]);
        respond(['success' => true]);
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

        $cardId = (int)$pdo->lastInsertId();
        $createdCard = getCardSnapshot($pdo, $cardId);
        if ($createdCard) {
            logCardChange($pdo, [
                'card_id' => $cardId,
                'card_title' => $createdCard['content'],
                'action' => 'card_created',
                'details' => 'Card criado em ' . ($createdCard['column_title'] ?? 'coluna desconhecida'),
            ]);
        }

        respond([
            'id' => $cardId,
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

    if ($method === 'PUT' && preg_match('#^/columns/(\d+)/order$#', $route, $m)) {
        $columnId = (int)$m[1];
        $body = getJsonBody();
        $cardIds = $body['card_ids'] ?? null;

        if (!is_array($cardIds)) {
            respond(['error' => 'Missing card_ids array'], 400);
        }

        $stmt = $pdo->prepare('SELECT id FROM `columns` WHERE id = ? LIMIT 1');
        $stmt->execute([$columnId]);
        if (!$stmt->fetch()) {
            respond(['error' => 'Column not found'], 404);
        }

        $pdo->beginTransaction();
        try {
            $update = $pdo->prepare('UPDATE cards SET order_index = ? WHERE id = ? AND column_id = ?');
            $index = 1;
            foreach ($cardIds as $rawId) {
                $id = (int)$rawId;
                if ($id <= 0) continue;
                $update->execute([$index, $id, $columnId]);
                $index++;
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        respond(['success' => true, 'column_id' => $columnId, 'count' => $index - 1]);
    }

    if ($method === 'PUT' && preg_match('#^/cards/(\d+)/move$#', $route, $m)) {
        $cardId = (int)$m[1];
        $body = getJsonBody();
        $columnId = (int)($body['column_id'] ?? 0);
        $beforeCard = getCardSnapshot($pdo, $cardId);

        if ($columnId <= 0) {
            respond(['error' => 'Missing column_id'], 400);
        }

        if (!$beforeCard) {
            respond(['error' => 'Card not found'], 404);
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

        $columnChanged = (int)$beforeCard['column_id'] !== $columnId;
        $newOrderIndex = null;
        if ($columnChanged) {
            $stmt = $pdo->prepare('SELECT COALESCE(MAX(order_index), 0) AS max_order FROM cards WHERE column_id = ?');
            $stmt->execute([$columnId]);
            $newOrderIndex = (int)($stmt->fetch()['max_order'] ?? 0) + 1;
        }

        if ($isBlocked) {
            if ($blockedReason && $blockedUntil) {
                if ($columnChanged) {
                    $stmt = $pdo->prepare('UPDATE cards SET column_id = ?, blocked_reason = ?, blocked_until = ?, order_index = ? WHERE id = ?');
                    $stmt->execute([$columnId, $blockedReason, $blockedUntil, $newOrderIndex, $cardId]);
                } else {
                    $stmt = $pdo->prepare('UPDATE cards SET column_id = ?, blocked_reason = ?, blocked_until = ? WHERE id = ?');
                    $stmt->execute([$columnId, $blockedReason, $blockedUntil, $cardId]);
                }
            } elseif ($blockedReason === null && $blockedUntil === null) {
                if ($columnChanged) {
                    $stmt = $pdo->prepare('UPDATE cards SET column_id = ?, order_index = ? WHERE id = ?');
                    $stmt->execute([$columnId, $newOrderIndex, $cardId]);
                } else {
                    $stmt = $pdo->prepare('UPDATE cards SET column_id = ? WHERE id = ?');
                    $stmt->execute([$columnId, $cardId]);
                }
            } else {
                respond(['error' => 'Missing blocked_reason or blocked_until for Blocked column'], 400);
            }
        } else {
            if ($columnChanged) {
                $stmt = $pdo->prepare('UPDATE cards SET column_id = ?, blocked_reason = NULL, blocked_until = NULL, order_index = ? WHERE id = ?');
                $stmt->execute([$columnId, $newOrderIndex, $cardId]);
            } else {
                $stmt = $pdo->prepare('UPDATE cards SET column_id = ?, blocked_reason = NULL, blocked_until = NULL WHERE id = ?');
                $stmt->execute([$columnId, $cardId]);
            }
        }

        $stmt = $pdo->prepare('SELECT blocked_reason, blocked_until FROM cards WHERE id = ? LIMIT 1');
        $stmt->execute([$cardId]);
        $card = $stmt->fetch() ?: [];

        $afterCard = getCardSnapshot($pdo, $cardId);
        if ($afterCard) {
            if ((int)$beforeCard['column_id'] !== (int)$afterCard['column_id']) {
                logCardChange($pdo, [
                    'card_id' => $cardId,
                    'card_title' => $afterCard['content'],
                    'action' => 'card_moved',
                    'field_name' => 'column_id',
                    'from_column' => $beforeCard['column_title'] ?? null,
                    'to_column' => $afterCard['column_title'] ?? null,
                    'details' => sprintf(
                        'Card movido de "%s" para "%s"',
                        (string)($beforeCard['column_title'] ?? 'desconhecida'),
                        (string)($afterCard['column_title'] ?? 'desconhecida')
                    ),
                ]);
            }

            foreach (['blocked_reason', 'blocked_until'] as $fieldName) {
                if (valuesDiffer($beforeCard[$fieldName] ?? null, $afterCard[$fieldName] ?? null)) {
                    logCardChange($pdo, [
                        'card_id' => $cardId,
                        'card_title' => $afterCard['content'],
                        'action' => 'card_updated',
                        'field_name' => $fieldName,
                        'old_value' => $beforeCard[$fieldName] ?? null,
                        'new_value' => $afterCard[$fieldName] ?? null,
                        'details' => sprintf('Campo "%s" alterado ao mover card', $fieldName),
                    ]);
                }
            }
        }

        respond([
            'success' => true,
            'blocked_reason' => $isBlocked ? ($card['blocked_reason'] ?? null) : null,
            'blocked_until' => $isBlocked ? ($card['blocked_until'] ?? null) : null,
        ]);
    }

    if ($method === 'PUT' && preg_match('#^/cards/(\d+)$#', $route, $m)) {
        $cardId = (int)$m[1];
        $body = getJsonBody();
        $beforeCard = getCardSnapshot($pdo, $cardId);

        if (!$beforeCard) {
            respond(['error' => 'Card not found'], 404);
        }

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

        $afterCard = getCardSnapshot($pdo, $cardId);
        if ($afterCard) {
            $fields = [
                'content' => 'card_updated',
                'subject' => 'card_updated',
                'notes' => 'card_updated',
                'priority' => 'card_updated',
                'blocked_reason' => 'card_updated',
                'blocked_until' => 'card_updated',
                'due_date' => 'due_date_changed',
            ];

            foreach ($fields as $fieldName => $actionName) {
                if (valuesDiffer($beforeCard[$fieldName] ?? null, $afterCard[$fieldName] ?? null)) {
                    logCardChange($pdo, [
                        'card_id' => $cardId,
                        'card_title' => $afterCard['content'],
                        'action' => $actionName,
                        'field_name' => $fieldName,
                        'old_value' => $beforeCard[$fieldName] ?? null,
                        'new_value' => $afterCard[$fieldName] ?? null,
                        'details' => sprintf('Campo "%s" alterado', $fieldName),
                    ]);
                }
            }

            $beforeActions = json_encode(decodeJsonList($beforeCard['actions'] ?? null, 'actions'), JSON_UNESCAPED_UNICODE);
            $afterActions = json_encode(decodeJsonList($afterCard['actions'] ?? null, 'actions'), JSON_UNESCAPED_UNICODE);
            if (valuesDiffer($beforeActions, $afterActions)) {
                logCardChange($pdo, [
                    'card_id' => $cardId,
                    'card_title' => $afterCard['content'],
                    'action' => 'card_updated',
                    'field_name' => 'actions',
                    'old_value' => $beforeActions,
                    'new_value' => $afterActions,
                    'details' => 'Acoes do card alteradas',
                ]);
            }
        }

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
        $beforeCard = getCardSnapshot($pdo, $cardId);

        if (!$beforeCard) {
            respond(['error' => 'Card not found'], 404);
        }

        $stmt = $pdo->prepare('UPDATE cards SET actions = ? WHERE id = ?');
        $stmt->execute([json_encode($actions), $cardId]);

        $newActions = json_encode($actions, JSON_UNESCAPED_UNICODE);
        $oldActions = json_encode(decodeJsonList($beforeCard['actions'] ?? null, 'actions'), JSON_UNESCAPED_UNICODE);
        if (valuesDiffer($oldActions, $newActions)) {
            logCardChange($pdo, [
                'card_id' => $cardId,
                'card_title' => $beforeCard['content'],
                'action' => 'card_updated',
                'field_name' => 'actions',
                'old_value' => $oldActions,
                'new_value' => $newActions,
                'details' => 'Acoes atualizadas',
            ]);
        }

        respond(['success' => true, 'actions' => $actions]);
    }

    if ($method === 'PUT' && preg_match('#^/cards/(\d+)/comments$#', $route, $m)) {
        $cardId = (int)$m[1];
        $body = getJsonBody();
        $comments = sanitizeComments($body['comments'] ?? []);
        $beforeCard = getCardSnapshot($pdo, $cardId);

        if (!$beforeCard) {
            respond(['error' => 'Card not found'], 404);
        }

        $stmt = $pdo->prepare('UPDATE cards SET comments = ? WHERE id = ?');
        $stmt->execute([json_encode($comments), $cardId]);

        $newComments = json_encode($comments, JSON_UNESCAPED_UNICODE);
        $oldComments = json_encode(decodeJsonList($beforeCard['comments'] ?? null, 'comments'), JSON_UNESCAPED_UNICODE);
        if (valuesDiffer($oldComments, $newComments)) {
            logCardChange($pdo, [
                'card_id' => $cardId,
                'card_title' => $beforeCard['content'],
                'action' => 'card_comment_updated',
                'field_name' => 'comments',
                'old_value' => $oldComments,
                'new_value' => $newComments,
                'details' => 'Comentarios atualizados',
            ]);
        }

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
            $snapshot = getCardSnapshot($pdo, $cardId);
            if ($snapshot) {
                logCardChange($pdo, [
                    'card_id' => $cardId,
                    'card_title' => $snapshot['content'],
                    'action' => 'card_archived',
                    'from_column' => $snapshot['column_title'] ?? null,
                    'to_column' => $snapshot['column_title'] ?? null,
                    'details' => 'Card arquivado',
                ]);
            }
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
        $beforeCard = getCardSnapshot($pdo, $cardId);

        $stmt = $pdo->query('SELECT id FROM columns WHERE LOWER(TRIM(title)) = "done" ORDER BY order_index ASC LIMIT 1');
        $done = $stmt->fetch();

        if (!$done) {
            respond(['error' => 'Done column not found'], 400);
        }

        $doneColumnId = (int)$done['id'];

        $stmt = $pdo->prepare('UPDATE cards SET archived = 0, archived_at = NULL, column_id = ? WHERE id = ?');
        $stmt->execute([$doneColumnId, $cardId]);

        $afterCard = getCardSnapshot($pdo, $cardId);
        if ($afterCard) {
            logCardChange($pdo, [
                'card_id' => $cardId,
                'card_title' => $afterCard['content'],
                'action' => 'card_unarchived',
                'from_column' => $beforeCard['column_title'] ?? null,
                'to_column' => $afterCard['column_title'] ?? null,
                'details' => 'Card desarquivado',
            ]);
        }

        respond(['success' => true, 'column_id' => $doneColumnId]);
    }

    if ($method === 'DELETE' && preg_match('#^/cards/(\d+)$#', $route, $m)) {
        $cardId = (int)$m[1];
        $beforeCard = getCardSnapshot($pdo, $cardId);

        $stmt = $pdo->prepare('DELETE FROM cards WHERE id = ?');
        $stmt->execute([$cardId]);

        if ($beforeCard) {
            logCardChange($pdo, [
                'card_id' => $cardId,
                'card_title' => $beforeCard['content'],
                'action' => 'card_deleted',
                'from_column' => $beforeCard['column_title'] ?? null,
                'details' => 'Card removido',
            ]);
        }

        respond(['success' => true]);
    }

    respond(['error' => 'Route not found'], 404);
} catch (Throwable $e) {
    error_log('[kanban] Unhandled: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $payload = ['error' => 'Internal server error'];
    if (isDebugMode()) {
        $payload['debug'] = [
            'message' => $e->getMessage(),
            'file' => $e->getFile(),
            'line' => $e->getLine(),
        ];
    }
    respond($payload, 500);
}

function isDebugMode(): bool
{
    return filter_var(getenv('APP_DEBUG') ?: '0', FILTER_VALIDATE_BOOLEAN);
}

function applyCorsHeaders(): void
{
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = [
        'http://127.0.0.1:8787',
        'http://localhost:8787',
    ];
    $extra = getenv('KANBAN_ALLOWED_ORIGINS');
    if (is_string($extra) && $extra !== '') {
        foreach (explode(',', $extra) as $entry) {
            $entry = trim($entry);
            if ($entry !== '') {
                $allowed[] = $entry;
            }
        }
    }

    if ($origin !== '' && in_array($origin, $allowed, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    } elseif ($origin === '') {
        // Same-origin requests (no Origin header) are always allowed.
        header('Access-Control-Allow-Origin: ' . ($allowed[0] ?? 'http://127.0.0.1:8787'));
    }
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

function getCardSnapshot(PDO $pdo, int $cardId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT cards.*, columns.title AS column_title
         FROM cards
         LEFT JOIN columns ON cards.column_id = columns.id
         WHERE cards.id = ?
         LIMIT 1'
    );
    $stmt->execute([$cardId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function valuesDiffer($oldValue, $newValue): bool
{
    return normalizeLogValue($oldValue) !== normalizeLogValue($newValue);
}

function normalizeLogValue($value): ?string
{
    if ($value === null) {
        return null;
    }

    if (is_bool($value)) {
        return $value ? '1' : '0';
    }

    if (is_scalar($value)) {
        $text = trim((string)$value);
        return $text === '' ? null : $text;
    }

    return json_encode($value, JSON_UNESCAPED_UNICODE);
}

function logCardChange(PDO $pdo, array $payload): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO change_logs (
            card_id, card_title, action, field_name, old_value, new_value, from_column, to_column, details
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    $stmt->execute([
        isset($payload['card_id']) ? (int)$payload['card_id'] : null,
        normalizeLogValue($payload['card_title'] ?? null),
        normalizeLogValue($payload['action'] ?? null),
        normalizeLogValue($payload['field_name'] ?? null),
        normalizeLogValue($payload['old_value'] ?? null),
        normalizeLogValue($payload['new_value'] ?? null),
        normalizeLogValue($payload['from_column'] ?? null),
        normalizeLogValue($payload['to_column'] ?? null),
        normalizeLogValue($payload['details'] ?? null),
    ]);
}

function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}
