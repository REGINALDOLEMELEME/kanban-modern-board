-- Kanban Modern Board — local test database
-- Target: MySQL 8 / MariaDB 10.6+
-- Usage: mysql -u root -p < database_dump.sql

-- Force UTF-8 for this session so accented text (ç, ã, õ, é, …) round-trips
-- correctly. Without this, the mysql CLI on Windows falls back to latin1 and
-- mojibakes all multi-byte characters at INSERT time.
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

DROP DATABASE IF EXISTS kanban_db;
CREATE DATABASE kanban_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kanban_db;

-- ---------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------

CREATE TABLE `columns` (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    order_index INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE cards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    column_id INT NOT NULL,
    content TEXT NOT NULL,
    subject VARCHAR(255) NULL,
    notes TEXT NULL,
    comments JSON NULL,
    due_date DATE NULL,
    actions JSON NULL,
    priority ENUM('normal','ponderado','urgente') NOT NULL DEFAULT 'normal',
    blocked_reason TEXT NULL,
    blocked_until DATE NULL,
    archived TINYINT(1) NOT NULL DEFAULT 0,
    archived_at DATETIME NULL,
    order_index INT NOT NULL,
    CONSTRAINT fk_cards_column FOREIGN KEY (column_id) REFERENCES `columns`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE board_settings (
    id TINYINT PRIMARY KEY,
    name VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE change_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    card_id INT NULL,
    card_title VARCHAR(255) NULL,
    action VARCHAR(64) NOT NULL,
    field_name VARCHAR(64) NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    from_column VARCHAR(255) NULL,
    to_column VARCHAR(255) NULL,
    details TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_change_logs_created_at (created_at),
    INDEX idx_change_logs_action (action),
    INDEX idx_change_logs_card_id (card_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------
-- Seed: board settings
-- ---------------------------------------------------------------
INSERT INTO board_settings (id, name) VALUES (1, 'Quadro de Testes');

-- ---------------------------------------------------------------
-- Seed: columns
-- ---------------------------------------------------------------
INSERT INTO `columns` (id, title, order_index) VALUES
    (1, 'Backlog',   0),
    (2, 'To Do',    10),
    (3, 'Doing',    20),
    (4, 'Blocked',  30),
    (5, 'In Review',40),
    (6, 'Done',     50);

-- ---------------------------------------------------------------
-- Seed: cards (fake data — varied priorities, due dates, actions, comments)
-- Today reference: 2026-04-20
-- ---------------------------------------------------------------

-- Backlog
INSERT INTO cards (id, column_id, content, subject, notes, comments, due_date, actions, priority, blocked_reason, blocked_until, archived, archived_at, order_index) VALUES
 (1, 1, 'Pesquisar biblioteca de drag-and-drop alternativa',
      'Investigação técnica',
      'Avaliar dnd-kit vs react-beautiful-dnd para substituir o sortable atual.',
      JSON_ARRAY(
        JSON_OBJECT('text','Ana: começa na próxima sprint','created_at','2026-04-10 09:12:00')
      ),
      '2026-05-15',
      JSON_ARRAY(
        JSON_OBJECT('text','Listar candidatos','done', true),
        JSON_OBJECT('text','Montar POC','done', false),
        JSON_OBJECT('text','Apresentar para o time','done', false)
      ),
      'normal', NULL, NULL, 0, NULL, 1),

 (2, 1, 'Redesenhar modal de edição de card',
      'UX',
      NULL,
      JSON_ARRAY(),
      NULL,
      JSON_ARRAY(
        JSON_OBJECT('text','Coletar feedback de 3 usuários','done', false),
        JSON_OBJECT('text','Wireframe no Figma','done', false)
      ),
      'ponderado', NULL, NULL, 0, NULL, 2);

-- To Do
INSERT INTO cards (id, column_id, content, subject, notes, comments, due_date, actions, priority, blocked_reason, blocked_until, archived, archived_at, order_index) VALUES
 (3, 2, 'Corrigir filtro de data nos logs',
      'Bug #217',
      'Filtro date_to não está incluindo o último dia quando a timezone do servidor difere do cliente.',
      JSON_ARRAY(
        JSON_OBJECT('text','Reproduzido em HOM','created_at','2026-04-18 14:20:00'),
        JSON_OBJECT('text','Reginaldo: pode pegar ainda essa semana','created_at','2026-04-19 08:45:00')
      ),
      '2026-04-24',
      JSON_ARRAY(
        JSON_OBJECT('text','Escrever teste de regressão','done', false),
        JSON_OBJECT('text','Ajustar query no backend2','done', false)
      ),
      'urgente', NULL, NULL, 0, NULL, 1),

 (4, 2, 'Exportar relatório de cards por responsável',
      'Feature',
      'Gerar PDF agrupado por pessoa, filtrando Done dos últimos 30 dias.',
      JSON_ARRAY(),
      '2026-05-02',
      JSON_ARRAY(
        JSON_OBJECT('text','Mockup aprovado','done', true),
        JSON_OBJECT('text','Implementar geração PDF','done', false)
      ),
      'normal', NULL, NULL, 0, NULL, 2),

 (5, 2, 'Adicionar tag de prioridade ponderada no mobile',
      'Frontend',
      NULL,
      JSON_ARRAY(),
      NULL,
      JSON_ARRAY(),
      'normal', NULL, NULL, 0, NULL, 3);

-- Doing
INSERT INTO cards (id, column_id, content, subject, notes, comments, due_date, actions, priority, blocked_reason, blocked_until, archived, archived_at, order_index) VALUES
 (6, 3, 'Migrar backend para PHP puro (backend2)',
      'Infra',
      'Finalizar endpoints /board, /cards, /logs antes do deploy de homolog.',
      JSON_ARRAY(
        JSON_OBJECT('text','Primeira leva de endpoints ok','created_at','2026-04-15 11:00:00'),
        JSON_OBJECT('text','Falta endpoint de unarchive','created_at','2026-04-19 16:30:00')
      ),
      '2026-04-30',
      JSON_ARRAY(
        JSON_OBJECT('text','Rotas CRUD de cards','done', true),
        JSON_OBJECT('text','Rotas de logs','done', true),
        JSON_OBJECT('text','Rotas de arquivamento','done', false),
        JSON_OBJECT('text','Documentar no README','done', false)
      ),
      'urgente', NULL, NULL, 0, NULL, 1),

 (7, 3, 'Implementar alerta de card com prazo estourado',
      'Feature',
      'Mostrar badge vermelho quando due_date < hoje e card não está em Done.',
      JSON_ARRAY(),
      '2026-04-27',
      JSON_ARRAY(
        JSON_OBJECT('text','Lógica de cálculo','done', true),
        JSON_OBJECT('text','Estilo CSS do badge','done', false)
      ),
      'ponderado', NULL, NULL, 0, NULL, 2);

-- Blocked (requires blocked_reason + blocked_until)
INSERT INTO cards (id, column_id, content, subject, notes, comments, due_date, actions, priority, blocked_reason, blocked_until, archived, archived_at, order_index) VALUES
 (8, 4, 'Integrar SSO com Azure AD',
      'Segurança',
      'Depende de liberação do time de TI corporativa.',
      JSON_ARRAY(
        JSON_OBJECT('text','Aguardando app registration','created_at','2026-04-12 10:00:00')
      ),
      '2026-05-10',
      JSON_ARRAY(
        JSON_OBJECT('text','Receber client_id/secret','done', false),
        JSON_OBJECT('text','Configurar redirect URIs','done', false)
      ),
      'urgente',
      'Aguardando provisionamento do app registration pelo time de TI.',
      '2026-04-30',
      0, NULL, 1);

-- In Review
INSERT INTO cards (id, column_id, content, subject, notes, comments, due_date, actions, priority, blocked_reason, blocked_until, archived, archived_at, order_index) VALUES
 (9, 5, 'PR #142 — paginação dos logs',
      'Code review',
      'Aberto por Reginaldo. Adiciona per_page e total_pages.',
      JSON_ARRAY(
        JSON_OBJECT('text','Claude pediu mais um teste','created_at','2026-04-18 17:10:00')
      ),
      '2026-04-22',
      JSON_ARRAY(
        JSON_OBJECT('text','Revisar SQL','done', true),
        JSON_OBJECT('text','Verificar com payload grande','done', false)
      ),
      'normal', NULL, NULL, 0, NULL, 1),

 (10, 5, 'Revisar copy do onboarding',
      'Conteúdo',
      NULL,
      JSON_ARRAY(),
      '2026-04-25',
      JSON_ARRAY(
        JSON_OBJECT('text','Ler textos atuais','done', true),
        JSON_OBJECT('text','Sugerir alternativas','done', true)
      ),
      'normal', NULL, NULL, 0, NULL, 2);

-- Done (not archived — visível na board)
INSERT INTO cards (id, column_id, content, subject, notes, comments, due_date, actions, priority, blocked_reason, blocked_until, archived, archived_at, order_index) VALUES
 (11, 6, 'Corrigir sobreposição do badge de ação',
      'Bug #209',
      'Fechado em 2026-04-17.',
      JSON_ARRAY(
        JSON_OBJECT('text','Testado em Chrome/Firefox','created_at','2026-04-17 15:00:00')
      ),
      '2026-04-17',
      JSON_ARRAY(
        JSON_OBJECT('text','Ajuste CSS','done', true),
        JSON_OBJECT('text','QA aprovou','done', true)
      ),
      'normal', NULL, NULL, 0, NULL, 1),

 (12, 6, 'Documentar fluxo de deploy no README',
      'Docs',
      NULL,
      JSON_ARRAY(),
      '2026-04-15',
      JSON_ARRAY(
        JSON_OBJECT('text','Esboço escrito','done', true),
        JSON_OBJECT('text','Revisado pelo time','done', true)
      ),
      'normal', NULL, NULL, 0, NULL, 2);

-- Done (archived — aparecem em /cards/archived, não na board)
INSERT INTO cards (id, column_id, content, subject, notes, comments, due_date, actions, priority, blocked_reason, blocked_until, archived, archived_at, order_index) VALUES
 (13, 6, 'Configurar pipeline de CI inicial',
      'DevOps',
      'Concluído e arquivado.',
      JSON_ARRAY(),
      '2026-03-28',
      JSON_ARRAY(
        JSON_OBJECT('text','Workflow de build','done', true),
        JSON_OBJECT('text','Cache de dependências','done', true)
      ),
      'normal', NULL, NULL, 1, '2026-04-02 10:15:00', 3),

 (14, 6, 'Protótipo inicial da UI',
      'Design',
      NULL,
      JSON_ARRAY(
        JSON_OBJECT('text','Entregue para o time em março','created_at','2026-03-20 09:00:00')
      ),
      '2026-03-20',
      JSON_ARRAY(
        JSON_OBJECT('text','Telas principais','done', true)
      ),
      'normal', NULL, NULL, 1, '2026-03-25 18:00:00', 4);

-- ---------------------------------------------------------------
-- Seed: change_logs (fake activity history so /logs has data)
-- ---------------------------------------------------------------
INSERT INTO change_logs (card_id, card_title, action, field_name, old_value, new_value, from_column, to_column, details, created_at) VALUES
 (1,  'Pesquisar biblioteca de drag-and-drop alternativa', 'card_created',      NULL,           NULL,         NULL,       NULL,        'Backlog',   'Card criado em Backlog',                                '2026-04-05 09:00:00'),
 (3,  'Corrigir filtro de data nos logs',                 'card_created',      NULL,           NULL,         NULL,       NULL,        'To Do',     'Card criado em To Do',                                  '2026-04-18 08:30:00'),
 (3,  'Corrigir filtro de data nos logs',                 'card_updated',      'priority',     'normal',     'urgente',  NULL,        NULL,        'Campo "priority" alterado',                             '2026-04-18 09:05:00'),
 (6,  'Migrar backend para PHP puro (backend2)',          'card_moved',        'column_id',    NULL,         NULL,       'To Do',     'Doing',     'Card movido de "To Do" para "Doing"',                   '2026-04-15 10:40:00'),
 (6,  'Migrar backend para PHP puro (backend2)',          'card_updated',      'actions',      '[]',         '[...]',    NULL,        NULL,        'Acoes do card alteradas',                               '2026-04-15 11:20:00'),
 (7,  'Implementar alerta de card com prazo estourado',   'due_date_changed',  'due_date',     '2026-04-25', '2026-04-27',NULL,       NULL,        'Campo "due_date" alterado',                             '2026-04-16 14:00:00'),
 (8,  'Integrar SSO com Azure AD',                        'card_moved',        'column_id',    NULL,         NULL,       'Doing',     'Blocked',   'Card movido de "Doing" para "Blocked"',                 '2026-04-12 10:10:00'),
 (8,  'Integrar SSO com Azure AD',                        'card_updated',      'blocked_reason',NULL,        'Aguardando provisionamento do app registration pelo time de TI.', NULL, NULL, 'Campo "blocked_reason" alterado ao mover card',         '2026-04-12 10:10:05'),
 (9,  'PR #142 — paginação dos logs',                     'card_moved',        'column_id',    NULL,         NULL,       'Doing',     'In Review', 'Card movido de "Doing" para "In Review"',               '2026-04-18 17:00:00'),
 (9,  'PR #142 — paginação dos logs',                     'card_comment_updated','comments',   '[]',         '[...]',    NULL,        NULL,        'Comentarios atualizados',                               '2026-04-18 17:10:00'),
 (11, 'Corrigir sobreposição do badge de ação',           'card_moved',        'column_id',    NULL,         NULL,       'In Review', 'Done',      'Card movido de "In Review" para "Done"',                '2026-04-17 15:05:00'),
 (13, 'Configurar pipeline de CI inicial',                'card_archived',     NULL,           NULL,         NULL,       'Done',      'Done',      'Card arquivado',                                        '2026-04-02 10:15:00'),
 (14, 'Protótipo inicial da UI',                          'card_archived',     NULL,           NULL,         NULL,       'Done',      'Done',      'Card arquivado',                                        '2026-03-25 18:00:00');

-- Keep AUTO_INCREMENT sane for subsequent inserts.
ALTER TABLE cards AUTO_INCREMENT = 100;
ALTER TABLE change_logs AUTO_INCREMENT = 100;
