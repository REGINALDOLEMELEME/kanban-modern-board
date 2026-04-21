-- =============================================================
--  Kanban Modern Board — migração 2026-04-20
--  Objetivo: adicionar tabelas usadas pelos novos recursos
--  (Modelos de card + Log de alterações) sem tocar nos dados
--  existentes.
--
--  Execute este script UMA vez via phpMyAdmin (aba "SQL"),
--  já com o banco `kanban_db` selecionado à esquerda. As
--  instruções são idempotentes (IF NOT EXISTS / INSERT IGNORE),
--  então rodar duas vezes não quebra nada.
-- =============================================================

SET NAMES utf8mb4;

-- -------------------------------------------------------------
-- 1) card_templates — novos modelos reutilizáveis
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS card_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    content TEXT NULL,
    subject VARCHAR(255) NULL,
    notes TEXT NULL,
    priority ENUM('normal','ponderado','urgente') NOT NULL DEFAULT 'normal',
    actions JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_card_templates_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Modelos iniciais (opcional, mas útil para o usuário ter exemplos).
INSERT IGNORE INTO card_templates (name, content, subject, notes, priority, actions) VALUES
 ('Bug report',
  'Descrever o bug',
  'Bug',
  'Passos para reproduzir:\n1.\n2.\n3.\n\nResultado esperado:\nResultado atual:',
  'urgente',
  JSON_ARRAY(
    JSON_OBJECT('text','Reproduzir em ambiente limpo','done', false),
    JSON_OBJECT('text','Escrever teste de regressão','done', false),
    JSON_OBJECT('text','Abrir PR com correção','done', false),
    JSON_OBJECT('text','QA valida em HOM','done', false)
  )),
 ('Nova feature',
  'Nome da feature',
  'Feature',
  'Problema que resolve:\nPúblico alvo:\nCritérios de aceitação:',
  'ponderado',
  JSON_ARRAY(
    JSON_OBJECT('text','Brainstorm / design','done', false),
    JSON_OBJECT('text','Implementar','done', false),
    JSON_OBJECT('text','Escrever testes','done', false),
    JSON_OBJECT('text','Documentar no README','done', false),
    JSON_OBJECT('text','Revisão de código','done', false)
  )),
 ('Reunião / follow-up',
  'Reunião com ',
  'Reunião',
  'Pauta:\nParticipantes:\nDecisões:\nPróximos passos:',
  'normal',
  JSON_ARRAY(
    JSON_OBJECT('text','Enviar ata para os participantes','done', false),
    JSON_OBJECT('text','Agendar follow-up','done', false)
  ));

-- -------------------------------------------------------------
-- 2) change_logs — a versão anterior criava esta tabela sob
--    demanda dentro do PHP (ensureChangeLogsTable). A versão
--    nova não faz mais isso, então se por acaso a tabela não
--    existir no servidor ela precisa ser criada aqui.
--    Se já existir, o IF NOT EXISTS mantém os dados intactos.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_logs (
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

-- Pronto. Volte para o runbook (DEPLOY.md) e siga para o próximo passo.
