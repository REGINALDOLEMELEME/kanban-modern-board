# Deploy — Kanban Modern Board (release 2026-04-20)

Runbook para o desenvolvedor que vai subir as mudanças desta rodada
em um servidor que já está rodando uma versão anterior da aplicação.

> **Tempo estimado:** 10–15 min, quase tudo em upload de arquivo.
> **Downtime:** nenhum obrigatório. A sequência abaixo mantém o app
> funcional em todos os passos, mas o ideal é deployar em horário de
> baixa utilização.

---

## 0. Resumo do que muda

| Área | O que mudou | Exige migração? |
|---|---|---|
| Banco | Nova tabela `card_templates` (obrigatória). Tabela `change_logs` agora precisa existir no schema (antes era criada em runtime pelo PHP). | **Sim — passo 2** |
| Backend PHP | Novas rotas CRUD `/templates`, nova rota `/columns/:id/order`, `/cards/:id/move` agora reindexa `order_index`, CORS restringido por allow-list, `APP_DEBUG` opcional, `ensureChangeLogsTable()` removido. | Upload novo `api/index.php` |
| Frontend | Nova aba "Modelos", campo "Modelo" no formulário Novo card, modal moderno de confirmação substituindo `confirm()` nativo, botões de fechar padronizados em X vermelho, título da aba "Quadro Kanban", arrasto sideways com drop-zone completa da coluna. | Upload `index.html`, `script.js`, `style.css` |
| Config | `config.php` deixou de ser versionado. **Não subir o arquivo do repo** — o do servidor já existe e tem as credenciais certas. | — |

---

## 1. Pré-requisitos / checklist antes de começar

- [ ] Acesso ao **phpMyAdmin** (ou SSH com `mysql` CLI) no banco `kanban_db`.
- [ ] Acesso ao **FTP / SFTP / painel de arquivos** do servidor web.
- [ ] Backup recente do banco (ver passo 1.1).
- [ ] Ter em mãos, localmente, os 5 arquivos abaixo, todos vindos desta release:
  - `backend2/api/index.php`
  - `backend2/migrations/2026-04-20_templates_and_logs.sql`
  - `frontend/index.html`
  - `frontend/script.js`
  - `frontend/style.css`
- [ ] Saber a URL de produção (ex.: `https://quadro.empresa.com`).

### 1.1 Backup do banco

No phpMyAdmin, seleciona o banco `kanban_db` → aba **Exportar** → método
"Rápido" → formato SQL → **Executar**. Guarda o arquivo `.sql` localmente
com o nome `kanban_db_backup_2026-04-20.sql`. Se algo der errado, esse é
o ponto de volta.

> Via CLI, equivale a:
> `mysqldump -u USER -p kanban_db > kanban_db_backup_2026-04-20.sql`

---

## 2. Migração do banco (faz antes do deploy dos arquivos)

Rodar **primeiro o SQL**, depois subir o PHP. Se você subir o PHP antes,
o endpoint `/logs` e `/templates` vão responder 500 até a tabela existir.

1. Abre o phpMyAdmin → seleciona `kanban_db` na lateral esquerda.
2. Clica na aba **SQL**.
3. Cola o conteúdo de `backend2/migrations/2026-04-20_templates_and_logs.sql`
   (ou usa **Importar** e envia o arquivo).
4. Clica em **Executar**. Deve aparecer "A sua consulta foi executada com êxito".

O que o script faz:
- `CREATE TABLE IF NOT EXISTS card_templates (...)` — nova tabela.
- 3 `INSERT IGNORE` com modelos iniciais (Bug report, Nova feature, Reunião).
- `CREATE TABLE IF NOT EXISTS change_logs (...)` — só cria se ainda não
  existir; se já existir (ambiente antigo que já passou pela auto-criação),
  não mexe nos dados.

Verificação rápida (executa no phpMyAdmin SQL):

```sql
SHOW TABLES LIKE 'card_templates';
SHOW TABLES LIKE 'change_logs';
SELECT COUNT(*) AS modelos FROM card_templates;
```

Esperado: as duas linhas aparecendo em `SHOW TABLES` e `modelos = 3`
(ou mais, se já tinha algum antes).

---

## 3. Upload dos arquivos (ordem recomendada)

A ordem importa: subir o PHP primeiro, depois os estáticos do frontend.
Fazendo assim, um usuário que abre o navegador no meio do deploy não
pega uma página nova apontando para rotas que ainda não existem.

### 3.1 Backend PHP — **1 arquivo**

Sobe por cima, preservando o resto:

| Substituir no servidor | Pelo arquivo local |
|---|---|
| `backend2/api/index.php` | `backend2/api/index.php` |

> **Não subir** `backend2/config.php` — o do servidor já está configurado
> com as credenciais do banco de produção. Se por engano subir, a app
> para imediatamente porque as credenciais vão ser as do dev.
>
> **Não subir** `backend2/database_dump.sql` nem `backend2/README.md` —
> são artefatos de desenvolvimento.

### 3.2 Frontend — **3 arquivos**

| Substituir no servidor | Pelo arquivo local |
|---|---|
| `frontend/index.html` | `frontend/index.html` |
| `frontend/script.js`  | `frontend/script.js`  |
| `frontend/style.css`  | `frontend/style.css`  |

O `index.html` referencia `script.js?v=20260420-3`. Esse sufixo de
querystring força o browser a baixar a versão nova mesmo com cache
agressivo — não precisa limpar nada no servidor.

### 3.3 (Opcional) Arquivos de apoio

Estes **não são necessários** para funcionar, mas se o servidor tiver
uma pasta de documentação do projeto e você quiser manter a paridade
com o repo, pode subir também:

- `backend2/README.md`
- `backend2/config.example.php`
- `backend2/migrations/2026-04-20_templates_and_logs.sql`

---

## 4. Pós-deploy — smoke test

Tudo pode ser feito em uma janela anônima no navegador (Ctrl+Shift+N)
para evitar cache antigo.

1. Abre a URL de produção. A aba do navegador deve mostrar **"Quadro Kanban"**.
2. O quadro carrega normalmente? Cards ainda aparecem nas colunas corretas?
   Se sim, o PHP novo continua compatível com os dados antigos.
3. No topo, aparecem os botões **Modelos**, **Logs**, **Arquivados**,
   **Exportar PDF**, **Colapsar todos**. Clica em **Modelos** — abre um
   painel com os 3 modelos seed.
4. Em qualquer coluna, clica em **+ Novo card**. O formulário agora
   começa com **"Modelo (opcional)"**. Seleciona "Bug report" — os
   campos se preenchem sozinhos. Cria o card → aparece na coluna.
5. Tenta arrastar um card para outra coluna **andando só de lado**,
   sem precisar subir/descer a página — deve cair na coluna destino.
6. Arrasta um card para a coluna **Blocked**; o modal de bloqueio
   abre. Clica em **Cancelar (X vermelho)**. O card volta sozinho
   para a coluna de origem, sem reload.
7. No card criado no passo 4, clica no **×** do canto. Abre o modal
   moderno "Remover card" com botão **Remover** vermelho e X vermelho
   de cancelar. Confirma → o card some.
8. Em **Modelos**, cria um modelo novo, edita, e **Excluir** (botão
   vermelho) → modal de confirmação moderno, sem `confirm()` nativo.
9. Em **Logs**, verifica que a listagem aparece e a paginação funciona.

Se algum passo falhar, pula para a seção 6 (Rollback).

### 4.1 Monitorar erros

Durante a primeira hora, deixa aberto o **error log do PHP** do servidor
(cPanel → "Errors" ou `tail -f` em `error_log`). Qualquer 500 imprevisto
vai aparecer lá com o prefixo `[kanban]` — o código novo escreve no
error_log toda exceção não tratada.

> **Dica de debug:** se aparecerem 500s misteriosos, pode ligar
> temporariamente o modo debug definindo a variável de ambiente
> `APP_DEBUG=1` (no `.htaccess`: `SetEnv APP_DEBUG 1`). Nesse modo a
> API passa a devolver `message/file/line` dentro do JSON de erro.
> **Desliga de novo** assim que identificar o problema — essas
> informações não devem ficar expostas em produção.

---

## 5. Observações importantes

### 5.1 CORS restringido

A versão nova **não** usa mais `Access-Control-Allow-Origin: *`. Ela
mantém uma allow-list fixa (`http://127.0.0.1:8787`, `http://localhost:8787`)
mais o que estiver na env var `KANBAN_ALLOWED_ORIGINS`.

- **Se a UI e a API estão no mesmo domínio** (caso normal em produção),
  o browser não envia o header `Origin` em GETs, então o CORS não é
  aplicado e não precisa configurar nada. **Caso mais comum.**
- **Se a UI e a API ficam em domínios diferentes** (ex.: frontend em
  `app.empresa.com` consumindo `api.empresa.com`), configura no
  servidor web do backend:
  ```apache
  SetEnv KANBAN_ALLOWED_ORIGINS "https://app.empresa.com"
  ```
  ou múltiplos separados por vírgula:
  ```apache
  SetEnv KANBAN_ALLOWED_ORIGINS "https://app.empresa.com,https://admin.empresa.com"
  ```
  Reinicia o Apache/PHP-FPM depois.

### 5.2 URL da API resolvida no cliente

O `script.js` monta a URL da API a partir de `window.location`:

```js
`${origin}${appBase}backend2/api/index.php?route=...`
```

Onde `appBase` é o pedaço do caminho antes de `/frontend/`. Isso
significa que a estrutura de pastas no servidor precisa ser a mesma
que no repo (pasta `frontend/` e pasta `backend2/` irmãs dentro da
raiz do site). Se a hospedagem servir o app em outro layout
(ex.: frontend direto na raiz, backend em `/api/`), o endpoint vai
ficar com path errado e tudo retorna 404.

Para conferir, abre o DevTools → aba **Network** → clica numa ação
(ex.: criar card) → a request deve bater em
`https://seu-dominio/.../backend2/api/index.php?route=/cards`.

### 5.3 Browser cache

Se algum usuário relatar que "nada mudou" depois do deploy, peça para
ele dar **Ctrl+F5** (ou Cmd+Shift+R no Mac). O `?v=20260420-3` do
`index.html` já força, mas alguns proxies corporativos teimam.

### 5.4 Compatibilidade com dados existentes

- Todos os cards antigos continuam funcionando — as mudanças de schema
  são **aditivas**.
- `order_index` nas cards antigas não precisa ser remapeado; o novo
  `/cards/:id/move` só mexe no `order_index` quando o card muda de
  coluna, e só na coluna destino. Qualquer colisão pré-existente de
  `order_index` na mesma coluna se resolve naturalmente na próxima
  reordenação por drag.
- A tabela `change_logs` preserva todo o histórico existente. Se a
  tabela já tinha sido criada automaticamente antes, o
  `CREATE TABLE IF NOT EXISTS` do passo 2 não a toca.

---

## 6. Rollback

Se algo grave aparecer nos primeiros minutos:

1. Volta os 4 arquivos (`api/index.php`, `frontend/index.html`,
   `script.js`, `style.css`) para a versão anterior. Tem que ter
   guardado cópias antes do upload — recomendo renomear os atuais
   para `.old` antes de substituir (ex.: `api/index.php.old`).
2. Se o banco ficou em estado estranho (raro, porque o SQL só adiciona
   tabelas novas):
   ```sql
   DROP TABLE IF EXISTS card_templates;
   -- NÃO dropar change_logs se ela já tinha dados antigos.
   ```
3. Se o banco estragou mesmo, restaura o backup do passo 1.1:
   ```bash
   mysql -u USER -p kanban_db < kanban_db_backup_2026-04-20.sql
   ```
4. Limpa o cache de browser com Ctrl+F5 para voltar a ver a versão antiga.

---

## 7. Lista rápida de commits inclusos nesta release

| Commit | Assunto |
|---|---|
| `efb88a0` | Seed local test DB, persist drag order, harden backend2 API |
| `641b459` | Revert cancelled blocked move and widen column drop zones |
| `128c360` | Add reusable card templates with Modelos page and prefill picker |
| `77888f6` | Standardize close/delete buttons and rename browser tab |
| `2581ca2` | Replace native confirm() with in-app confirmation modal |

Em caso de dúvida, este arquivo e o histórico acima têm todo o contexto
necessário. Boa deploy. 🚀
