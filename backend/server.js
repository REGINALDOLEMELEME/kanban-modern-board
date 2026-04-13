const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Database configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '1234'
};

let pool;

async function ensureColumnExists(tableName, columnName, columnDefinition) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS count
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'kanban_db'
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );

    if (rows[0].count === 0) {
        await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
    }
}

async function initDB() {
    try {
        // First, connect without specifying a database to create it if it doesn't exist
        const connection = await mysql.createConnection(dbConfig);
        await connection.query('CREATE DATABASE IF NOT EXISTS kanban_db');
        await connection.end();

        // Now connect with the database selected
        pool = mysql.createPool({
            ...dbConfig,
            database: 'kanban_db',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // Create tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS columns (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                order_index INT NOT NULL
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS cards (
                id INT AUTO_INCREMENT PRIMARY KEY,
                column_id INT NOT NULL,
                content TEXT NOT NULL,
                order_index INT NOT NULL,
                FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS board_settings (
                id TINYINT PRIMARY KEY,
                name VARCHAR(255) NOT NULL
            )
        `);

        // Keep schema compatible with older DBs.
        await ensureColumnExists('cards', 'subject', 'VARCHAR(255) NULL');
        await ensureColumnExists('cards', 'notes', 'TEXT NULL');
        await ensureColumnExists('cards', 'comments', 'JSON NULL');
        await ensureColumnExists('cards', 'due_date', 'DATE NULL');
        await ensureColumnExists('cards', 'actions', 'JSON NULL');
        await ensureColumnExists('cards', 'priority', "ENUM('normal', 'ponderado', 'urgente') NOT NULL DEFAULT 'normal'");
        await ensureColumnExists('cards', 'blocked_reason', 'TEXT NULL');
        await ensureColumnExists('cards', 'blocked_until', 'DATE NULL');

        // Insert default columns if they don't exist
        const [rows] = await pool.query('SELECT COUNT(*) as count FROM columns');
        if (rows[0].count === 0) {
            await pool.query('INSERT INTO columns (title, order_index) VALUES ("Backlog", 0), ("To Do", 10), ("Doing", 20), ("Blocked", 30), ("In Review", 40), ("Done", 50)');
            console.log('Inserted default columns.');
        }

        await pool.query(
            'INSERT INTO board_settings (id, name) VALUES (1, ?) ON DUPLICATE KEY UPDATE name = name',
            ['Meu Quadro']
        );

        console.log('Database initialized successfully.');
    } catch (err) {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    }
}

function sanitizePriority(priority) {
    const validPriorities = new Set(['normal', 'ponderado', 'urgente']);
    return validPriorities.has(priority) ? priority : 'normal';
}

function sanitizeDueDate(dueDateInput) {
    if (!dueDateInput) return null;
    const dateString = String(dueDateInput).slice(0, 10);

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return dateString;
    }

    return null;
}

function sanitizeBlockedText(blockedReasonInput) {
    const text = String(blockedReasonInput || '').trim();
    return text ? text : null;
}

function isBlockedColumnTitle(title) {
    return String(title || '').trim().toLowerCase() === 'blocked';
}

function parseActions(actionsInput) {
    if (!Array.isArray(actionsInput)) return [];

    return actionsInput
        .map(action => {
            if (typeof action === 'string') {
                return { text: action.trim(), done: false };
            }

            if (action && typeof action.text === 'string') {
                return {
                    text: action.text.trim(),
                    done: Boolean(action.done)
                };
            }

            return null;
        })
        .filter(action => action && action.text.length > 0);
}

function parseCardActionsFromDB(actionsValue) {
    if (Array.isArray(actionsValue)) return parseActions(actionsValue);
    if (typeof actionsValue !== 'string') return [];

    try {
        const parsed = JSON.parse(actionsValue);
        return parseActions(parsed);
    } catch {
        return [];
    }
}

function parseComments(commentsInput) {
    if (!Array.isArray(commentsInput)) return [];

    return commentsInput
        .map(comment => {
            if (typeof comment === 'string') {
                const text = comment.trim();
                return text ? { text, created_at: null } : null;
            }

            if (comment && typeof comment.text === 'string') {
                const text = comment.text.trim();
                if (!text) return null;
                return {
                    text,
                    created_at: comment.created_at ? String(comment.created_at) : null
                };
            }

            return null;
        })
        .filter(Boolean);
}

function parseCardCommentsFromDB(commentsValue) {
    if (Array.isArray(commentsValue)) return parseComments(commentsValue);
    if (typeof commentsValue !== 'string') return [];

    try {
        const parsed = JSON.parse(commentsValue);
        return parseComments(parsed);
    } catch {
        return [];
    }
}

// Routes
app.get('/api/board-name', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT name FROM board_settings WHERE id = 1 LIMIT 1');
        const name = rows[0]?.name || 'Meu Quadro';
        res.json({ name });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/board-name', async (req, res) => {
    const { name } = req.body;
    const trimmedName = String(name || '').trim();

    if (!trimmedName) {
        return res.status(400).json({ error: 'Missing board name' });
    }

    try {
        await pool.query(
            'INSERT INTO board_settings (id, name) VALUES (1, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
            [trimmedName]
        );

        res.json({ success: true, name: trimmedName });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 1. Get entire board (columns + cards)
app.get('/api/board', async (req, res) => {
    try {
        const [columns] = await pool.query('SELECT * FROM columns ORDER BY order_index ASC');
        const [cards] = await pool.query('SELECT * FROM cards ORDER BY order_index ASC');

        // Group cards by column
        const boardData = columns.map(col => ({
            ...col,
            cards: cards
                .filter(card => card.column_id === col.id)
                .map(card => ({
                    ...card,
                    actions: parseCardActionsFromDB(card.actions),
                    comments: parseCardCommentsFromDB(card.comments)
                }))
        }));

        res.json(boardData);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 2. Create a new card
app.post('/api/cards', async (req, res) => {
    const { column_id, content, subject, notes, comments, due_date, actions, priority, blocked_reason, blocked_until } = req.body;
    if (!column_id || !content) return res.status(400).json({ error: 'Missing column_id or content' });

    const sanitizedActions = parseActions(actions);
    const sanitizedComments = parseComments(comments);
    const sanitizedPriority = sanitizePriority(priority);
    const sanitizedDueDate = sanitizeDueDate(due_date);
    const sanitizedBlockedReason = sanitizeBlockedText(blocked_reason);
    const sanitizedBlockedUntil = sanitizeDueDate(blocked_until);

    try {
        // Get max order index for the column
        const [orderRows] = await pool.query('SELECT MAX(order_index) as max_order FROM cards WHERE column_id = ?', [column_id]);
        const orderIndex = (orderRows[0].max_order || 0) + 1;

        const [result] = await pool.query(
            'INSERT INTO cards (column_id, content, subject, notes, comments, due_date, actions, priority, blocked_reason, blocked_until, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [column_id, content, subject || null, notes ? String(notes).trim() : null, JSON.stringify(sanitizedComments), sanitizedDueDate, JSON.stringify(sanitizedActions), sanitizedPriority, sanitizedBlockedReason, sanitizedBlockedUntil, orderIndex]
        );

        res.status(201).json({
            id: result.insertId,
            column_id,
            content,
            subject: subject || null,
            notes: notes ? String(notes).trim() : null,
            comments: sanitizedComments,
            due_date: sanitizedDueDate,
            actions: sanitizedActions,
            priority: sanitizedPriority,
            blocked_reason: sanitizedBlockedReason,
            blocked_until: sanitizedBlockedUntil,
            order_index: orderIndex
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 3. Move a card (update its column)
app.put('/api/cards/:id/move', async (req, res) => {
    const cardId = req.params.id;
    const { column_id, blocked_reason, blocked_until } = req.body;

    if (!column_id) return res.status(400).json({ error: 'Missing column_id' });

    try {
        const [columnRows] = await pool.query('SELECT title FROM columns WHERE id = ? LIMIT 1', [column_id]);
        if (columnRows.length === 0) return res.status(404).json({ error: 'Column not found' });

        const isBlockedColumn = isBlockedColumnTitle(columnRows[0].title);
        const sanitizedBlockedReason = sanitizeBlockedText(blocked_reason);
        const sanitizedBlockedUntil = sanitizeDueDate(blocked_until);

        if (isBlockedColumn) {
            if (sanitizedBlockedReason && sanitizedBlockedUntil) {
                await pool.query(
                    'UPDATE cards SET column_id = ?, blocked_reason = ?, blocked_until = ? WHERE id = ?',
                    [column_id, sanitizedBlockedReason, sanitizedBlockedUntil, cardId]
                );
            } else if (!sanitizedBlockedReason && !sanitizedBlockedUntil) {
                await pool.query('UPDATE cards SET column_id = ? WHERE id = ?', [column_id, cardId]);
            } else {
                return res.status(400).json({ error: 'Missing blocked_reason or blocked_until for Blocked column' });
            }
        } else {
            await pool.query(
                'UPDATE cards SET column_id = ?, blocked_reason = NULL, blocked_until = NULL WHERE id = ?',
                [column_id, cardId]
            );
        }

        const [updatedRows] = await pool.query('SELECT blocked_reason, blocked_until FROM cards WHERE id = ? LIMIT 1', [cardId]);
        const updatedCard = updatedRows[0] || {};

        res.json({
            success: true,
            blocked_reason: isBlockedColumn ? updatedCard.blocked_reason || null : null,
            blocked_until: isBlockedColumn ? updatedCard.blocked_until || null : null
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/cards/:id', async (req, res) => {
    const cardId = req.params.id;
    const { content, subject, notes, due_date, actions, priority, blocked_reason, blocked_until } = req.body;

    const trimmedContent = String(content || '').trim();
    if (!trimmedContent) return res.status(400).json({ error: 'Missing content' });

    const sanitizedActions = parseActions(actions);
    const sanitizedPriority = sanitizePriority(priority);
    const sanitizedDueDate = sanitizeDueDate(due_date);
    const sanitizedBlockedReason = sanitizeBlockedText(blocked_reason);
    const sanitizedBlockedUntil = sanitizeDueDate(blocked_until);

    if (sanitizedBlockedReason && !sanitizedBlockedUntil) {
        return res.status(400).json({ error: 'Missing blocked_until when blocked_reason is provided' });
    }

    try {
        await pool.query(
            `UPDATE cards
             SET content = ?, subject = ?, due_date = ?, actions = ?, priority = ?, blocked_reason = ?, blocked_until = ?
             , notes = ?
             WHERE id = ?`,
            [
                trimmedContent,
                subject ? String(subject).trim() : null,
                sanitizedDueDate,
                JSON.stringify(sanitizedActions),
                sanitizedPriority,
                sanitizedBlockedReason,
                sanitizedBlockedUntil,
                notes ? String(notes).trim() : null,
                cardId
            ]
        );

        res.json({
            success: true,
            card: {
                id: Number(cardId),
                content: trimmedContent,
                subject: subject ? String(subject).trim() : null,
                notes: notes ? String(notes).trim() : null,
                due_date: sanitizedDueDate,
                actions: sanitizedActions,
                priority: sanitizedPriority,
                blocked_reason: sanitizedBlockedReason,
                blocked_until: sanitizedBlockedUntil
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 4. Update card actions (checkbox state)
app.put('/api/cards/:id/actions', async (req, res) => {
    const cardId = req.params.id;
    const { actions } = req.body;
    const sanitizedActions = parseActions(actions);

    try {
        await pool.query('UPDATE cards SET actions = ? WHERE id = ?', [JSON.stringify(sanitizedActions), cardId]);
        res.json({ success: true, actions: sanitizedActions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/cards/:id/comments', async (req, res) => {
    const cardId = req.params.id;
    const { comments } = req.body;
    const sanitizedComments = parseComments(comments);

    try {
        await pool.query('UPDATE cards SET comments = ? WHERE id = ?', [JSON.stringify(sanitizedComments), cardId]);
        res.json({ success: true, comments: sanitizedComments });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 5. Delete a card
app.delete('/api/cards/:id', async (req, res) => {
    const cardId = req.params.id;
    try {
        await pool.query('DELETE FROM cards WHERE id = ?', [cardId]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
initDB().then(() => {
    app.listen(port, () => {
        console.log(`Backend server listening at http://localhost:${port}`);
    });
});
