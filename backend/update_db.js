const mysql = require('mysql2/promise');

async function updateDB() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '1234',
        database: 'kanban_db'
    });

    try {
        console.log('Updating existing columns...');
        await connection.query('UPDATE columns SET order_index = 10 WHERE title = "To Do"');
        await connection.query('UPDATE columns SET order_index = 20 WHERE title = "Doing"');
        await connection.query('UPDATE columns SET order_index = 50 WHERE title = "Done"');
        
        console.log('Inserting new columns...');
        // Use INSERT IGNORE in case this script is run multiple times
        await connection.query(`
            INSERT IGNORE INTO columns (title, order_index) 
            SELECT "Backlog", 0 
            WHERE NOT EXISTS (SELECT 1 FROM columns WHERE title = "Backlog");
        `);
        await connection.query(`
            INSERT IGNORE INTO columns (title, order_index) 
            SELECT "Blocked", 30 
            WHERE NOT EXISTS (SELECT 1 FROM columns WHERE title = "Blocked");
        `);
        await connection.query(`
            INSERT IGNORE INTO columns (title, order_index) 
            SELECT "In Review", 40 
            WHERE NOT EXISTS (SELECT 1 FROM columns WHERE title = "In Review");
        `);

        console.log('Done.');
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await connection.end();
    }
}

updateDB();
