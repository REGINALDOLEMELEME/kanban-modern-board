# backend2 (PHP API)

PHP replacement for the old Node backend. Single entry point at `backend2/api/index.php`.

## 1) Configure DB

Copy the template and fill in your MySQL credentials:

```bash
cp backend2/config.example.php backend2/config.php
```

Edit `backend2/config.php` — `config.php` is git-ignored, so real credentials
never land in the repo.

## 2) Create the database

```bash
mysql -u root -p < backend2/database_dump.sql
```

This drops and recreates `kanban_db` with schema + fake test data
(6 columns, 14 cards incl. 2 archived, 13 log entries, board name
"Quadro de Testes"). Safe to re-run.

## 3) Run locally

From the repo root (`kanban-modern-board/`):

```bash
php -S 127.0.0.1:8787
```

Then open:

- Frontend: http://127.0.0.1:8787/frontend/index.html
- API: http://127.0.0.1:8787/backend2/api/index.php?route=/board

The frontend auto-derives the API URL from `window.location`, so it always
points at `<host>/backend2/api/index.php?route=…`.

## 4) Routes

| Method | Route                          | Purpose                                            |
|--------|--------------------------------|----------------------------------------------------|
| GET    | `/board`                       | Columns with active (non-archived) cards           |
| GET    | `/board-name`                  | Board title                                        |
| PUT    | `/board-name`                  | Update board title                                 |
| POST   | `/cards`                       | Create card                                        |
| PUT    | `/cards/:id`                   | Update card fields                                 |
| PUT    | `/cards/:id/move`              | Move card to another column (reassigns order)      |
| PUT    | `/cards/:id/actions`           | Replace action checklist                           |
| PUT    | `/cards/:id/comments`          | Replace comments                                   |
| PUT    | `/cards/:id/archive`           | Archive card (Done column only)                    |
| PUT    | `/cards/:id/unarchive`         | Restore archived card back to Done                 |
| DELETE | `/cards/:id`                   | Delete card                                        |
| GET    | `/cards/archived`              | List archived cards                                |
| PUT    | `/columns/:id/order`           | Rewrite `order_index` from `{card_ids: [int]}`     |
| GET    | `/logs`                        | Paginated change logs with filters `q/action/date_from/date_to/page/per_page` |

## 5) Debug mode

Export `APP_DEBUG=1` before starting `php -S` to include the exception
message, file, and line in 500 responses. Unhandled errors are written to
PHP's `error_log` regardless.

## 6) CORS

The API accepts requests from `http://127.0.0.1:8787` and
`http://localhost:8787` by default. Add more via comma-separated list:

```bash
export KANBAN_ALLOWED_ORIGINS="http://my.domain,http://other:9000"
```

## 7) Migrating existing data from the old Node backend

```bash
mysqldump -u YOUR_USER -p kanban_db > kanban_data_full.sql
mysql -u YOUR_USER -p kanban_db < kanban_data_full.sql
```
