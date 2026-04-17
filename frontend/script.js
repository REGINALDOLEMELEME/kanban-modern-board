const API_URL = (() => {
    const path = window.location.pathname || '';
    const appBase = path.includes('/frontend/')
        ? path.slice(0, path.indexOf('/frontend/')) + '/'
        : path.replace(/[^/]*$/, '');
    return `${window.location.origin}${appBase}api/index.php?route=`;
})();

let draggedCard = null;
let dragOriginParent = null;
let dragOriginNextSibling = null;
let dragOriginColumnId = null;
const collapsedCardIds = new Set();
const logsState = {
    page: 1,
    perPage: 10,
    totalPages: 1,
    lastFilters: {}
};

function showToast(message, type = 'error') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}

document.addEventListener('DOMContentLoaded', () => {
    setupBoardNameEditor();
    setupPdfExport();
    setupArchivedMenu();
    setupLogsMenu();
    setupGlobalCollapseControl();
    loadBoardName();
    loadBoard();
});

document.addEventListener('click', async event => {
    const logsBtn = event.target.closest('#logs-menu-btn');
    if (!logsBtn) return;

    const logsModal = document.getElementById('logs-modal');
    if (!logsModal) return;

    logsModal.classList.remove('hidden');
    await loadLogs(readLogFilters());
});

function setupBoardNameEditor() {
    const input = document.getElementById('board-name-input');

    input.addEventListener('keydown', async event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            await saveBoardName(input.value);
        }
    });

    input.addEventListener('blur', async () => {
        await saveBoardName(input.value);
    });
}

function setupPdfExport() {
    const exportButton = document.getElementById('export-pdf-btn');
    if (!exportButton) return;

    exportButton.addEventListener('click', async () => {
        await exportBoardToPDF();
    });
}

function setupArchivedMenu() {
    const archivedMenuBtn = document.getElementById('archived-menu-btn');
    const archivedCloseBtn = document.getElementById('archived-close-btn');
    const archivedModal = document.getElementById('archived-modal');

    if (!archivedMenuBtn || !archivedCloseBtn || !archivedModal) return;

    archivedMenuBtn.addEventListener('click', async () => {
        archivedModal.classList.remove('hidden');
        await loadArchivedCards();
    });

    archivedCloseBtn.addEventListener('click', () => {
        archivedModal.classList.add('hidden');
    });
}

function setupLogsMenu() {
    const logsMenuBtn = document.getElementById('logs-menu-btn');
    const logsModal = document.getElementById('logs-modal');
    const logsCloseBtn = document.getElementById('logs-close-btn');
    const logsForm = document.getElementById('logs-search-form');
    const logsClearBtn = document.getElementById('logs-clear-btn');
    const logsPageSizeInput = document.getElementById('logs-page-size');
    const logsPrevPageBtn = document.getElementById('logs-prev-page-btn');
    const logsNextPageBtn = document.getElementById('logs-next-page-btn');

    if (!logsMenuBtn || !logsModal) return;

    logsMenuBtn.addEventListener('click', async () => {
        logsModal.classList.remove('hidden');
        logsState.page = 1;
        logsState.lastFilters = readLogFilters();
        logsState.perPage = Number(logsPageSizeInput?.value || logsState.perPage || 10);
        await loadLogs();
    });

    if (logsCloseBtn) {
        logsCloseBtn.addEventListener('click', () => {
            logsModal.classList.add('hidden');
        });
    }

    if (logsForm) {
        logsForm.addEventListener('submit', async event => {
            event.preventDefault();
            logsState.page = 1;
            logsState.lastFilters = readLogFilters();
            await loadLogs();
        });
    }

    if (logsClearBtn) {
        logsClearBtn.addEventListener('click', async () => {
            const queryInput = document.getElementById('logs-query-input');
            const actionInput = document.getElementById('logs-action-input');
            const fromInput = document.getElementById('logs-date-from-input');
            const toInput = document.getElementById('logs-date-to-input');

            if (queryInput) queryInput.value = '';
            if (actionInput) actionInput.value = '';
            if (fromInput) fromInput.value = '';
            if (toInput) toInput.value = '';
            logsState.page = 1;
            logsState.lastFilters = readLogFilters();
            await loadLogs();
        });
    }

    if (logsPageSizeInput) {
        logsPageSizeInput.addEventListener('change', async () => {
            const parsed = Number(logsPageSizeInput.value || '10');
            logsState.perPage = [5, 10, 30].includes(parsed) ? parsed : 10;
            logsState.page = 1;
            await loadLogs();
        });
    }

    if (logsPrevPageBtn) {
        logsPrevPageBtn.addEventListener('click', async () => {
            if (logsState.page <= 1) return;
            logsState.page -= 1;
            await loadLogs();
        });
    }

    if (logsNextPageBtn) {
        logsNextPageBtn.addEventListener('click', async () => {
            if (logsState.page >= logsState.totalPages) return;
            logsState.page += 1;
            await loadLogs();
        });
    }
}

function setupGlobalCollapseControl() {
    const button = document.getElementById('global-toggle-collapse-btn');
    if (!button) return;

    button.addEventListener('click', () => {
        const cards = [...document.querySelectorAll('#board .card')];
        const hasCards = cards.length > 0;
        const allCollapsed = hasCards && cards.every(card => card.classList.contains('card-collapsed'));
        const nextCollapsedState = !allCollapsed;

        cards.forEach(card => {
            setCardCollapsed(card, nextCollapsedState);
            const cardId = String(card.dataset.id || '');
            if (nextCollapsedState) {
                collapsedCardIds.add(cardId);
            } else {
                collapsedCardIds.delete(cardId);
            }
            applyCardVisuals(card);
        });

        document.querySelectorAll('.column').forEach(columnEl => {
            const list = columnEl.querySelector('.card-list');
            const columnButton = columnEl.querySelector('.column-toggle-collapse-btn');
            if (list && columnButton) {
                updateColumnCollapseButtonLabel(list, columnButton);
            }
        });

        updateGlobalCollapseButtonLabel();
    });

    updateGlobalCollapseButtonLabel();
}

function updateGlobalCollapseButtonLabel() {
    const button = document.getElementById('global-toggle-collapse-btn');
    if (!button) return;

    const cards = [...document.querySelectorAll('#board .card')];
    const hasCards = cards.length > 0;
    const allCollapsed = hasCards && cards.every(card => card.classList.contains('card-collapsed'));

    button.disabled = !hasCards;
    button.textContent = allCollapsed ? 'Exibir todos' : 'Colapsar todos';
}
async function exportBoardToPDF() {
    try {
        const [boardNameResponse, boardResponse, archivedResponse] = await Promise.all([
            fetch(`${API_URL}/board-name`),
            fetch(`${API_URL}/board`),
            fetch(`${API_URL}/cards/archived`)
        ]);

        if (!boardNameResponse.ok || !boardResponse.ok || !archivedResponse.ok) {
            throw new Error('Falha ao carregar dados para exportacao.');
        }

        const boardNameData = await boardNameResponse.json();
        const columns = await boardResponse.json();
        const archivedCards = await archivedResponse.json();
        const boardName = boardNameData?.name || 'Meu Quadro';
        const generatedAt = new Date();
        const generatedAtText = `${String(generatedAt.getDate()).padStart(2, '0')}/${String(generatedAt.getMonth() + 1).padStart(2, '0')}/${generatedAt.getFullYear()} ${String(generatedAt.getHours()).padStart(2, '0')}:${String(generatedAt.getMinutes()).padStart(2, '0')}`;

        const content = columns.map(column => {
            const cards = Array.isArray(column.cards)
                ? [...column.cards].sort((a, b) => getPriorityRank(a.priority) - getPriorityRank(b.priority))
                : [];
            const cardsHtml = cards.length
                ? cards.map(card => {
                    const actions = normalizeActions(card.actions || []);
                    const actionsHtml = actions.length
                        ? `<ul>${actions.map(action => `<li>${action.done ? '✓' : '□'} ${escapeHtml(action.text)}</li>`).join('')}</ul>`
                        : '<p class=\"muted\">Sem acoes.</p>';

                    return `
                        <article class=\"card\">
                            <h4>${escapeHtml(card.content || '')}</h4>
                            <p><strong>Prioridade:</strong> ${escapeHtml(buildPriorityLabel(card.priority || 'normal'))}</p>
                            ${card.subject ? `<p><strong>Assunto:</strong> ${escapeHtml(card.subject)}</p>` : ''}
                            ${card.due_date ? `<p><strong>Prazo:</strong> ${escapeHtml(formatDateBR(card.due_date))}</p>` : ''}
                            ${card.blocked_reason ? `<p><strong>Bloqueio:</strong> ${escapeHtml(card.blocked_reason)}</p>` : ''}
                            ${card.blocked_until ? `<p><strong>Conclusao prevista:</strong> ${escapeHtml(formatDateBR(card.blocked_until))}</p>` : ''}
                            ${card.notes ? `<p><strong>Observacoes:</strong> ${escapeHtml(card.notes)}</p>` : ''}
                            <div class=\"actions\">
                                <p><strong>Acoes:</strong></p>
                                ${actionsHtml}
                            </div>
                        </article>
                    `;
                }).join('')
                : '<p class=\"muted\">Sem cards.</p>';

            return `
                <section class=\"column\">
                    <h3>${escapeHtml(column.title || '')}</h3>
                    ${cardsHtml}
                </section>
            `;
        }).join('');

        const archivedContent = Array.isArray(archivedCards) && archivedCards.length
            ? archivedCards.map(card => {
                const archivedAtText = card.archived_at ? formatDateTimeBR(card.archived_at) : '';
                return `
                    <article class=\"card archived-card\">
                        <h4>${escapeHtml(card.content || '')}</h4>
                        ${card.subject ? `<p><strong>Assunto:</strong> ${escapeHtml(card.subject)}</p>` : ''}
                        <p><strong>Coluna:</strong> ${escapeHtml(card.column_title || 'Done')}</p>
                        ${archivedAtText ? `<p><strong>Arquivado em:</strong> ${escapeHtml(archivedAtText)}</p>` : ''}
                        ${card.notes ? `<p><strong>Observacoes:</strong> ${escapeHtml(card.notes)}</p>` : ''}
                    </article>
                `;
            }).join('')
            : '<p class=\"muted\">Sem cards arquivados.</p>';

        const html = `
            <!DOCTYPE html>
            <html lang=\"pt-BR\">
            <head>
                <meta charset=\"UTF-8\" />
                <title>${escapeHtml(boardName)} - Exportacao</title>
                <style>
                    @page { margin: 14mm; }
                    body { font-family: Arial, sans-serif; color: #1e2f3d; }
                    h1 { margin: 0 0 4px; font-size: 24px; }
                    .meta { margin: 0 0 16px; color: #5b7286; font-size: 12px; }
                    .column { margin-bottom: 16px; border: 1px solid #d8e1e8; border-radius: 8px; padding: 10px; break-inside: avoid; }
                    .column h3 { margin: 0 0 8px; font-size: 18px; }
                    .card { margin-bottom: 10px; border: 1px solid #e3ebf1; border-radius: 8px; padding: 8px; break-inside: avoid; }
                    .card h4 { margin: 0 0 6px; font-size: 16px; }
                    .card p { margin: 3px 0; font-size: 13px; }
                    .section-title { margin: 18px 0 10px; font-size: 20px; }
                    .archived-card { border-style: dashed; }
                    .actions ul { margin: 4px 0 0 18px; padding: 0; }
                    .actions li { margin: 2px 0; font-size: 13px; }
                    .muted { color: #6c8498; }
                </style>
            </head>
            <body>
                <h1>${escapeHtml(boardName)}</h1>
                <p class=\"meta\">Gerado em ${escapeHtml(generatedAtText)}</p>
                <h2 class=\"section-title\">Cards ativos</h2>
                ${content}
                <h2 class=\"section-title\">Cards arquivados</h2>
                ${archivedContent}
            </body>
            </html>
        `;

        const existingFrame = document.getElementById('pdf-export-frame');
        if (existingFrame) {
            existingFrame.remove();
        }

        const iframe = document.createElement('iframe');
        iframe.id = 'pdf-export-frame';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.setAttribute('aria-hidden', 'true');
        document.body.appendChild(iframe);

        const frameDoc = iframe.contentWindow.document;
        frameDoc.open();
        frameDoc.write(html);
        frameDoc.close();

        setTimeout(() => {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            setTimeout(() => iframe.remove(), 1200);
        }, 250);
    } catch (error) {
        console.error('Error exporting PDF:', error);
        showToast('Falha ao exportar PDF.');
    }
}

async function loadBoardName() {
    const input = document.getElementById('board-name-input');

    try {
        const response = await fetch(`${API_URL}/board-name`);
        if (!response.ok) throw new Error('Failed to fetch board name');

        const data = await response.json();
        input.value = data.name || 'Meu Quadro';
    } catch (error) {
        console.error('Error loading board name:', error);
        input.value = 'Meu Quadro';
    }
}

async function saveBoardName(name) {
    const trimmed = String(name || '').trim();

    if (!trimmed) {
        showToast('Informe um nome para o quadro.');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/board-name`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmed })
        });

        if (!response.ok) throw new Error('Failed to update board name');

        const data = await response.json();
        document.getElementById('board-name-input').value = data.name;
    } catch (error) {
        console.error('Error saving board name:', error);
        showToast('Nao foi possivel salvar o nome do quadro.');
    }
}

async function loadBoard() {
    try {
        const response = await fetch(`${API_URL}/board`);
        if (!response.ok) throw new Error('Failed to fetch board data');
        const columns = await response.json();
        renderBoard(columns);
    } catch (error) {
        console.error('Error loading board:', error);
        showToast('Nao foi possivel carregar o quadro. Verifique se o backend esta ativo.');
    }
}

function normalizeColumnTitle(title) {
    return String(title || '').trim().toLowerCase();
}

function isBlockedColumnTitle(title) {
    return normalizeColumnTitle(title) === 'blocked';
}

function isDoneColumnTitle(title) {
    return normalizeColumnTitle(title) === 'done';
}

function isDoneColumnElement(columnEl) {
    const title = columnEl?.querySelector('.column-title')?.textContent || '';
    return isDoneColumnTitle(title);
}

function getPriorityRank(priority) {
    const priorityOrder = {
        urgente: 0,
        ponderado: 1,
        normal: 2
    };

    return priorityOrder[priority] ?? 2;
}

function renderBoard(columnsData) {
    const board = document.getElementById('board');
    board.innerHTML = '';
    const dueTodayCards = [];

    const columnTemplate = document.getElementById('column-template');
    const cardTemplate = document.getElementById('card-template');

    const hiddenColumns = new Set(['backlog']);
    const visibleColumns = columnsData.filter(column => !hiddenColumns.has(normalizeColumnTitle(column.title)));

    visibleColumns.forEach(columnData => {
        const columnClone = columnTemplate.content.cloneNode(true);
        const columnEl = columnClone.querySelector('.column');
        columnEl.dataset.id = columnData.id;
        columnEl.dataset.isBlocked = String(isBlockedColumnTitle(columnData.title));

        columnClone.querySelector('.column-title').textContent = columnData.title;

        const cardList = columnClone.querySelector('.card-list');
        cardList.addEventListener('dragover', handleDragOver);
        cardList.addEventListener('drop', handleDrop);

        const sortedCards = Array.isArray(columnData.cards)
            ? [...columnData.cards].sort((a, b) => getPriorityRank(a.priority) - getPriorityRank(b.priority))
            : [];

        if (sortedCards.length > 0) {
            sortedCards.forEach(cardData => {
                const cardEl = createCardElement(cardData, cardTemplate, columnData.id);
                cardList.appendChild(cardEl);
                // Reapply visuals after attaching to DOM so Done-column checks work reliably.
                applyCardVisuals(cardEl);
            });
        }

        const addBtn = columnClone.querySelector('.add-card-btn');
        const addForm = columnClone.querySelector('.add-card-form');
        const saveBtn = columnClone.querySelector('.save-card-btn');
        const cancelBtn = columnClone.querySelector('.cancel-card-btn');
        const toggleCollapseBtn = columnClone.querySelector('.column-toggle-collapse-btn');
        const titleInput = columnClone.querySelector('.new-card-title-input');
        const subjectInput = columnClone.querySelector('.new-card-subject-input');
        const dueDateInput = columnClone.querySelector('.new-card-due-date-input');
        const notesInput = columnClone.querySelector('.new-card-notes-input');
        const actionsInput = columnClone.querySelector('.new-card-actions-input');
        const priorityInput = columnClone.querySelector('.new-card-priority-input');

        toggleCollapseBtn.addEventListener('click', () => {
            const cards = [...cardList.querySelectorAll('.card')];
            const allCollapsed = cards.length > 0 && cards.every(card => card.classList.contains('card-collapsed'));
            const nextCollapsedState = !allCollapsed;

            cards.forEach(card => {
                setCardCollapsed(card, nextCollapsedState);
                const cardId = String(card.dataset.id || '');
                if (nextCollapsedState) {
                    collapsedCardIds.add(cardId);
                } else {
                    collapsedCardIds.delete(cardId);
                }
                applyCardVisuals(card);
            });

            updateColumnCollapseButtonLabel(cardList, toggleCollapseBtn);
            updateGlobalCollapseButtonLabel();
        });

        addBtn.addEventListener('click', () => {
            addBtn.classList.add('hidden');
            addForm.classList.remove('hidden');
            titleInput.focus();
        });

        cancelBtn.addEventListener('click', () => {
            addForm.classList.add('hidden');
            addBtn.classList.remove('hidden');
            resetAddCardForm(titleInput, subjectInput, dueDateInput, notesInput, actionsInput, priorityInput);
        });

        saveBtn.addEventListener('click', async () => {
            const title = titleInput.value.trim();
            const subject = subjectInput.value.trim();
            const dueDate = dueDateInput.value;
            const notes = notesInput.value.trim();
            const actions = parseActionsFromText(actionsInput.value);
            const priority = priorityInput.value;

            if (!title) {
                showToast('Preencha o titulo do card.');
                return;
            }

            await addCard(columnData.id, { title, subject, dueDate, notes, actions, priority }, cardList, cardTemplate);
            addForm.classList.add('hidden');
            addBtn.classList.remove('hidden');
            resetAddCardForm(titleInput, subjectInput, dueDateInput, notesInput, actionsInput, priorityInput);
            updateColumnCollapseButtonLabel(cardList, toggleCollapseBtn);
            updateGlobalCollapseButtonLabel();
        });

        if (sortedCards.length > 0) {
            sortedCards.forEach(cardData => {
                if (isDueToday(cardData.due_date) && !isDoneColumnTitle(columnData.title)) {
                    dueTodayCards.push({
                        title: cardData.content,
                        columnTitle: columnData.title
                    });
                }
            });
        }

        board.appendChild(columnClone);
        updateColumnCollapseButtonLabel(cardList, toggleCollapseBtn);
    });

    renderDueAlerts(dueTodayCards);
    updateGlobalCollapseButtonLabel();
}

function resetAddCardForm(titleInput, subjectInput, dueDateInput, notesInput, actionsInput, priorityInput) {
    titleInput.value = '';
    subjectInput.value = '';
    dueDateInput.value = '';
    notesInput.value = '';
    actionsInput.value = '';
    priorityInput.value = 'normal';
}

function normalizeDateInput(value) {
    if (!value) return '';
    return String(value).slice(0, 10);
}

function isDueToday(dueDateValue) {
    const normalized = normalizeDateInput(dueDateValue);
    if (!normalized) return false;

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayString = `${yyyy}-${mm}-${dd}`;

    return normalized === todayString;
}

function formatDateBR(dueDateValue) {
    const normalized = normalizeDateInput(dueDateValue);
    if (!normalized) return '';

    const [year, month, day] = normalized.split('-');
    return `${day}/${month}/${year}`;
}

function renderDueAlerts(dueTodayCards) {
    const container = document.getElementById('due-alerts');
    if (!container) return;

    if (!dueTodayCards.length) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    const items = dueTodayCards
        .map(card => `<li><strong>${escapeHtml(card.title)}</strong> na coluna ${escapeHtml(card.columnTitle)}</li>`)
        .join('');

    container.innerHTML = `
        <p class="due-alerts-title">Alerta de prazo: ${dueTodayCards.length} card(s) vencem hoje.</p>
        <ul class="due-alerts-list">${items}</ul>
    `;
    container.classList.remove('hidden');
}

function escapeHtml(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function parseActionsFromText(actionsText, existingActions = []) {
    const normalizedExisting = normalizeActions(existingActions);
    const usedIndexes = new Set();

    const findByText = text => {
        for (let i = 0; i < normalizedExisting.length; i++) {
            if (usedIndexes.has(i)) continue;
            if (normalizedExisting[i].text !== text) continue;
            usedIndexes.add(i);
            return normalizedExisting[i];
        }

        return null;
    };

    return actionsText
        .split('\n')
        .map(action => action.trim())
        .filter(Boolean)
        .map((text, index) => {
            const previousByText = findByText(text);
            let previous = previousByText;

            if (!previous && normalizedExisting[index] && !usedIndexes.has(index)) {
                previous = normalizedExisting[index];
                usedIndexes.add(index);
            }

            return { text, done: previous ? previous.done : false };
        });
}

function actionsToText(actions) {
    const normalizedActions = normalizeActions(actions);
    return normalizedActions.map(action => action.text).join('\n');
}

function buildPriorityLabel(priority) {
    const labels = {
        normal: 'Normal',
        ponderado: 'Ponderado',
        urgente: 'Urgente'
    };

    return labels[priority] || 'Normal';
}

function buildPriorityShortLabel(priority) {
    const labels = {
        normal: 'N',
        ponderado: 'P',
        urgente: 'U'
    };

    return labels[priority] || 'N';
}

function normalizeActions(actions) {
    if (!Array.isArray(actions)) return [];

    return actions
        .map(action => {
            if (typeof action === 'string') {
                return { text: action, done: false };
            }

            if (action && typeof action.text === 'string') {
                return { text: action.text, done: Boolean(action.done) };
            }

            return null;
        })
        .filter(Boolean);
}

function normalizeComments(comments) {
    if (!Array.isArray(comments)) return [];

    return comments
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

function formatDateTimeBR(dateTimeValue) {
    if (!dateTimeValue) return '';

    const date = new Date(dateTimeValue);
    if (Number.isNaN(date.getTime())) return '';

    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function readLogFilters() {
    return {
        q: document.getElementById('logs-query-input')?.value?.trim() || '',
        action: document.getElementById('logs-action-input')?.value || '',
        date_from: document.getElementById('logs-date-from-input')?.value || '',
        date_to: document.getElementById('logs-date-to-input')?.value || ''
    };
}

function buildLogActionLabel(action) {
    const labels = {
        card_created: 'Card criado',
        card_moved: 'Card movido',
        card_updated: 'Card alterado',
        due_date_changed: 'Prazo alterado',
        card_comment_updated: 'Comentarios alterados',
        card_archived: 'Card arquivado',
        card_unarchived: 'Card desarquivado',
        card_deleted: 'Card removido'
    };

    return labels[action] || action || 'Alteracao';
}

function buildLogFieldLabel(fieldName) {
    const labels = {
        column_id: 'Coluna',
        content: 'Titulo',
        subject: 'Assunto',
        notes: 'Observacoes',
        priority: 'Prioridade',
        due_date: 'Prazo',
        blocked_reason: 'Motivo do bloqueio',
        blocked_until: 'Previsao de desbloqueio',
        actions: 'Lista de acoes',
        comments: 'Comentarios'
    };

    const key = String(fieldName || '').trim();
    return labels[key] || (key || '-');
}

function buildLogActionClass(action) {
    const classes = {
        card_created: 'log-badge-created',
        card_moved: 'log-badge-moved',
        card_updated: 'log-badge-updated',
        due_date_changed: 'log-badge-due',
        card_comment_updated: 'log-badge-comment',
        card_archived: 'log-badge-archived',
        card_unarchived: 'log-badge-unarchived',
        card_deleted: 'log-badge-deleted'
    };

    return classes[action] || 'log-badge-default';
}

function shortenLogText(value, max = 90) {
    const text = String(value || '').trim();
    if (!text) return '-';
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}...`;
}

function formatLogDetails(details) {
    const text = String(details || '').trim();
    if (!text) return '-';

    const fieldMatch = text.match(/^Campo "([^"]+)" alterado$/i);
    if (fieldMatch) {
        return `Campo "${buildLogFieldLabel(fieldMatch[1])}" alterado`;
    }

    const moveFieldMatch = text.match(/^Campo "([^"]+)" alterado ao mover card$/i);
    if (moveFieldMatch) {
        return `Campo "${buildLogFieldLabel(moveFieldMatch[1])}" alterado ao mover card`;
    }

    if (/^Acoes atualizadas$/i.test(text)) {
        return 'Checklist atualizado';
    }

    return text;
}

function parseActionsLogValue(value) {
    if (value === null || value === undefined) return null;

    if (Array.isArray(value)) {
        return normalizeActions(value);
    }

    const text = String(value).trim();
    if (!text || text === '-') return null;

    try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) return null;
        return normalizeActions(parsed);
    } catch {
        return null;
    }
}

function formatLogValueByField(rawValue, rawFieldName) {
    if (rawValue === null || rawValue === undefined || rawValue === '') {
        return '-';
    }

    if (rawFieldName === 'actions') {
        const actions = parseActionsLogValue(rawValue);
        if (!actions || actions.length === 0) return 'Sem acoes';

        const doneCount = actions.filter(action => action.done).length;
        const totalCount = actions.length;
        return `${doneCount}/${totalCount} concluidas`;
    }

    return String(rawValue);
}

async function loadLogs(filters = {}) {
    const listEl = document.getElementById('logs-list');
    const pageInfoEl = document.getElementById('logs-page-info');
    const prevBtn = document.getElementById('logs-prev-page-btn');
    const nextBtn = document.getElementById('logs-next-page-btn');
    if (!listEl) return;

    try {
        const mergedFilters = {
            ...logsState.lastFilters,
            ...filters
        };
        logsState.lastFilters = mergedFilters;

        const params = new URLSearchParams();
        if (mergedFilters.q) params.set('q', mergedFilters.q);
        if (mergedFilters.action) params.set('action', mergedFilters.action);
        if (mergedFilters.date_from) params.set('date_from', mergedFilters.date_from);
        if (mergedFilters.date_to) params.set('date_to', mergedFilters.date_to);
        params.set('page', String(logsState.page));
        params.set('per_page', String(logsState.perPage));

        let url = `${API_URL}/logs`;
        const queryString = params.toString();
        if (queryString) {
            url += `&${queryString}`;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error('Falha ao carregar logs');

        const payload = await response.json();
        const logs = Array.isArray(payload) ? payload : (payload.items || []);
        const pagination = Array.isArray(payload)
            ? { page: 1, total_pages: 1, total_rows: logs.length, per_page: logs.length || logsState.perPage }
            : (payload.pagination || {});

        logsState.page = Number(pagination.page || logsState.page || 1);
        logsState.totalPages = Math.max(1, Number(pagination.total_pages || 1));
        logsState.perPage = Number(pagination.per_page || logsState.perPage || 10);

        if (pageInfoEl) {
            const totalRows = Number(pagination.total_rows || logs.length || 0);
            pageInfoEl.textContent = `Pagina ${logsState.page} de ${logsState.totalPages} (${totalRows} registros)`;
        }
        if (prevBtn) prevBtn.disabled = logsState.page <= 1;
        if (nextBtn) nextBtn.disabled = logsState.page >= logsState.totalPages;

        if (!Array.isArray(logs) || logs.length === 0) {
            listEl.innerHTML = '<p class="logs-empty">Nenhum log encontrado.</p>';
            return;
        }

        listEl.innerHTML = `
            <div class="logs-table-wrap">
                <table class="logs-table">
                    <thead>
                        <tr>
                            <th class="log-th-date">Data</th>
                            <th class="log-th-action">Acao</th>
                            <th class="log-th-card">Card</th>
                            <th class="log-th-field">Campo</th>
                            <th class="log-th-old">De</th>
                            <th class="log-th-new">Para</th>
                            <th class="log-th-details">Detalhes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => {
                            const rawFieldName = String(log.field_name || '').trim();
                            const actionLabel = buildLogActionLabel(log.action);
                            const actionClass = buildLogActionClass(log.action);
                            const fromRawValue = (log.from_column ?? log.old_value ?? null);
                            const toRawValue = (log.to_column ?? log.new_value ?? null);
                            const fromValue = formatLogValueByField(fromRawValue, rawFieldName);
                            const toValue = formatLogValueByField(toRawValue, rawFieldName);
                            const detailsValue = formatLogDetails(log.details);
                            const cardTitle = log.card_title || 'Card sem titulo';
                            const fieldName = buildLogFieldLabel(rawFieldName);

                            return `
                                <tr>
                                    <td class="log-cell-date">${escapeHtml(formatDateTimeBR(log.created_at) || '-')}</td>
                                    <td class="log-col-action"><span class="log-badge ${actionClass}">${escapeHtml(actionLabel)}</span></td>
                                    <td class="log-col-card" title="${escapeHtml(cardTitle)}">${escapeHtml(shortenLogText(cardTitle, 72))}</td>
                                    <td class="log-col-field">${escapeHtml(fieldName)}</td>
                                    <td class="log-col-old" title="${escapeHtml(String(fromValue))}">${escapeHtml(shortenLogText(fromValue, 110))}</td>
                                    <td class="log-col-new" title="${escapeHtml(String(toValue))}">${escapeHtml(shortenLogText(toValue, 110))}</td>
                                    <td class="log-col-details" title="${escapeHtml(String(detailsValue))}">${escapeHtml(shortenLogText(detailsValue, 160))}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        console.error('Error loading logs:', error);
        listEl.innerHTML = '<p class="logs-empty">Falha ao carregar logs.</p>';
        if (pageInfoEl) pageInfoEl.textContent = 'Pagina 1 de 1';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
    }
}

function setCardDataset(cardEl, cardData, fallbackColumnId) {
    cardEl.dataset.id = cardData.id;
    cardEl.dataset.columnId = String(cardData.column_id || fallbackColumnId || '');
    cardEl.dataset.title = cardData.content || '';
    cardEl.dataset.subject = cardData.subject || '';
    cardEl.dataset.dueDate = normalizeDateInput(cardData.due_date);
    cardEl.dataset.notes = cardData.notes || '';
    cardEl.dataset.priority = cardData.priority || 'normal';
    cardEl.dataset.blockedReason = cardData.blocked_reason || '';
    cardEl.dataset.blockedUntil = normalizeDateInput(cardData.blocked_until);
    cardEl.dataset.actions = JSON.stringify(normalizeActions(cardData.actions));
    cardEl.dataset.comments = JSON.stringify(normalizeComments(cardData.comments));
}

function applyCardVisuals(cardEl) {
    const titleEl = cardEl.querySelector('.card-title');
    const subjectEl = cardEl.querySelector('.card-subject');
    const deadlineEl = cardEl.querySelector('.card-deadline');
    const notesEl = cardEl.querySelector('.card-notes');
    const blockedReasonEl = cardEl.querySelector('.card-blocked-reason');
    const blockedUntilEl = cardEl.querySelector('.card-blocked-until');
    const blockedChipEl = cardEl.querySelector('.blocked-chip');
    const priorityChipEl = cardEl.querySelector('.priority-chip');
    const archiveBtn = cardEl.querySelector('.archive-card-btn');
    const commentIndicatorEl = cardEl.querySelector('.comment-indicator-btn');
    const commentCountEl = cardEl.querySelector('.comment-count');
    const commentTooltipEl = cardEl.querySelector('.comment-tooltip');
    const progressEl = cardEl.querySelector('.card-progress');
    const actionsListEl = cardEl.querySelector('.card-actions-list');
    const isCollapsed = cardEl.classList.contains('card-collapsed');
    const comments = normalizeComments(JSON.parse(cardEl.dataset.comments || '[]'));

    titleEl.textContent = cardEl.dataset.title || '';

    if (cardEl.dataset.subject) {
        subjectEl.textContent = cardEl.dataset.subject;
        subjectEl.classList.remove('hidden');
    } else {
        subjectEl.classList.add('hidden');
        subjectEl.textContent = '';
    }

    if (cardEl.dataset.dueDate) {
        deadlineEl.textContent = `Prazo: ${formatDateBR(cardEl.dataset.dueDate)}`;
        deadlineEl.classList.remove('hidden');
        deadlineEl.classList.toggle('deadline-today', isDueToday(cardEl.dataset.dueDate));
    } else {
        deadlineEl.classList.add('hidden');
        deadlineEl.classList.remove('deadline-today');
        deadlineEl.textContent = '';
    }

    if (cardEl.dataset.notes) {
        notesEl.textContent = `Observacoes: ${cardEl.dataset.notes}`;
        notesEl.classList.remove('hidden');
    } else {
        notesEl.classList.add('hidden');
        notesEl.textContent = '';
    }

    if (cardEl.dataset.blockedReason) {
        blockedReasonEl.textContent = `Bloqueio: ${cardEl.dataset.blockedReason}`;
        blockedReasonEl.classList.remove('hidden');
        blockedChipEl.textContent = isCollapsed ? 'BLOQ' : 'Bloqueado';
        blockedChipEl.classList.remove('hidden');
        cardEl.classList.add('card-blocked');
    } else {
        blockedReasonEl.classList.add('hidden');
        blockedReasonEl.textContent = '';
        blockedChipEl.classList.add('hidden');
        cardEl.classList.remove('card-blocked');
    }

    if (cardEl.dataset.blockedUntil) {
        blockedUntilEl.textContent = `Conclusao prevista: ${formatDateBR(cardEl.dataset.blockedUntil)}`;
        blockedUntilEl.classList.remove('hidden');
    } else {
        blockedUntilEl.classList.add('hidden');
        blockedUntilEl.textContent = '';
    }

    const priority = cardEl.dataset.priority || 'normal';
    priorityChipEl.textContent = isCollapsed ? buildPriorityShortLabel(priority) : buildPriorityLabel(priority);
    priorityChipEl.className = 'priority-chip';
    priorityChipEl.classList.add(`priority-chip-${priority}`);
    cardEl.classList.remove('card-priority-normal', 'card-priority-ponderado', 'card-priority-urgente');
    cardEl.classList.add(`card-priority-${priority}`);

    if (comments.length > 0) {
        commentCountEl.textContent = String(comments.length);
        commentIndicatorEl.classList.remove('hidden');
        commentTooltipEl.innerHTML = comments
            .map(comment => {
                const timestamp = formatDateTimeBR(comment.created_at);
                const header = timestamp ? `${escapeHtml(timestamp)} - ` : '';
                return `<p class="comment-tooltip-item">${header}${escapeHtml(comment.text)}</p>`;
            })
            .join('');
        commentTooltipEl.classList.remove('hidden');
    } else {
        commentCountEl.textContent = '0';
        commentIndicatorEl.classList.add('hidden');
        commentTooltipEl.classList.add('hidden');
        commentTooltipEl.innerHTML = '';
    }

    renderActions(JSON.parse(cardEl.dataset.actions || '[]'), actionsListEl, progressEl, cardEl.dataset.id, cardEl);

    const inDoneColumn = isDoneColumnElement(cardEl.closest('.column'));
    cardEl.classList.toggle('card-done', inDoneColumn);
    archiveBtn.classList.toggle('hidden', !inDoneColumn);
}

function createCardElement(cardData, template, fallbackColumnId) {
    const clone = template.content.cloneNode(true);
    const cardEl = clone.querySelector('.card');
    const cardMain = clone.querySelector('.card-main');

    setCardDataset(cardEl, cardData, fallbackColumnId);
    if (collapsedCardIds.has(String(cardData.id))) {
        setCardCollapsed(cardEl, true);
    }
    applyCardVisuals(cardEl);

    cardMain.addEventListener('mousedown', event => {
        if (event.target.tagName === 'INPUT') {
            event.stopPropagation();
        }
    });

    cardMain.addEventListener('click', event => {
        if (
            event.target.tagName === 'INPUT' ||
            event.target.closest('.card-action-item') ||
            event.target.closest('.comment-indicator-btn')
        ) {
            return;
        }

        toggleCardCollapsed(cardEl);
    });

    const commentIndicatorBtn = clone.querySelector('.comment-indicator-btn');
    commentIndicatorBtn.addEventListener('click', async event => {
        event.stopPropagation();
        await openCommentsModal(cardEl);
    });

    const commentBtn = clone.querySelector('.comment-card-btn');
    commentBtn.addEventListener('click', async event => {
        event.stopPropagation();
        await openCommentsModal(cardEl);
    });

    const archiveBtn = clone.querySelector('.archive-card-btn');
    archiveBtn.addEventListener('click', async event => {
        event.stopPropagation();
        await archiveCard(cardEl);
    });

    const duplicateBtn = clone.querySelector('.duplicate-card-btn');
    duplicateBtn.addEventListener('click', async event => {
        event.stopPropagation();
        await duplicateCard(cardEl);
    });

    cardEl.addEventListener('dragstart', handleDragStart);
    cardEl.addEventListener('dragend', handleDragEnd);

    const editBtn = clone.querySelector('.edit-card-btn');
    editBtn.addEventListener('click', async event => {
        event.stopPropagation();
        await openEditCardModal(cardEl);
    });

    const deleteBtn = clone.querySelector('.delete-card-btn');
    deleteBtn.addEventListener('click', async event => {
        event.stopPropagation();
        if (confirm('Tem certeza que deseja remover este card?')) {
            await deleteCard(cardData.id, cardEl);
        }
    });

    return cardEl;
}

function toggleCardCollapsed(cardEl) {
    const cardId = String(cardEl.dataset.id || '');
    const isCollapsed = !cardEl.classList.contains('card-collapsed');
    setCardCollapsed(cardEl, isCollapsed);

    if (isCollapsed) {
        collapsedCardIds.add(cardId);
    } else {
        collapsedCardIds.delete(cardId);
    }

    applyCardVisuals(cardEl);

    const columnEl = cardEl.closest('.column');
    if (columnEl) {
        const list = columnEl.querySelector('.card-list');
        const btn = columnEl.querySelector('.column-toggle-collapse-btn');
        if (list && btn) {
            updateColumnCollapseButtonLabel(list, btn);
        }
    }

    updateGlobalCollapseButtonLabel();
}

function setCardCollapsed(cardEl, collapsed) {
    cardEl.classList.toggle('card-collapsed', collapsed);
}

function updateColumnCollapseButtonLabel(cardList, buttonEl) {
    const cards = [...cardList.querySelectorAll('.card')];
    const hasCards = cards.length > 0;
    const allCollapsed = hasCards && cards.every(card => card.classList.contains('card-collapsed'));

    buttonEl.disabled = !hasCards;
    buttonEl.textContent = allCollapsed ? 'Reexibir' : 'Colapsar tudo';
}

function renderActions(actions, actionsListEl, progressEl, cardId, cardEl) {
    const normalizedActions = normalizeActions(actions);

    actionsListEl.innerHTML = '';

    if (!normalizedActions.length) {
        actionsListEl.classList.add('hidden');
        progressEl.classList.add('hidden');
        progressEl.textContent = '';
        cardEl.dataset.actions = JSON.stringify([]);
        return;
    }

    actionsListEl.classList.remove('hidden');
    progressEl.classList.remove('hidden');

    const doneCount = normalizedActions.filter(action => action.done).length;
    progressEl.textContent = `${doneCount}/${normalizedActions.length} acoes concluidas`;

    normalizedActions.forEach((action, index) => {
        const row = document.createElement('label');
        row.className = 'card-action-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = action.done;

        const text = document.createElement('span');
        text.textContent = action.text;
        text.classList.toggle('done', action.done);

        checkbox.addEventListener('click', event => {
            event.stopPropagation();
        });

        checkbox.addEventListener('change', async event => {
            event.stopPropagation();
            normalizedActions[index].done = checkbox.checked;
            text.classList.toggle('done', checkbox.checked);
            cardEl.dataset.actions = JSON.stringify(normalizedActions);
            await updateCardActions(cardId, normalizedActions);
            const doneNow = normalizedActions.filter(item => item.done).length;
            progressEl.textContent = `${doneNow}/${normalizedActions.length} acoes concluidas`;
        });

        row.appendChild(checkbox);
        row.appendChild(text);
        actionsListEl.appendChild(row);
    });

    cardEl.dataset.actions = JSON.stringify(normalizedActions);
}

function handleDragStart(e) {
    draggedCard = this;
    dragOriginParent = this.parentElement;
    dragOriginNextSibling = this.nextElementSibling;
    dragOriginColumnId = this.closest('.column')?.dataset.id || null;

    setTimeout(() => this.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.id);
}

function handleDragEnd() {
    this.classList.remove('dragging');
    draggedCard = null;
}

function revertDraggedCardPosition() {
    if (!draggedCard || !dragOriginParent) return;

    if (dragOriginNextSibling && dragOriginNextSibling.parentElement === dragOriginParent) {
        dragOriginParent.insertBefore(draggedCard, dragOriginNextSibling);
    } else {
        dragOriginParent.appendChild(draggedCard);
    }
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const afterElement = getDragAfterElement(this, e.clientY);

    if (afterElement == null) {
        this.appendChild(draggedCard);
    } else {
        this.insertBefore(draggedCard, afterElement);
    }
}

function openBlockedModal(existing = {}) {
    const modal = document.getElementById('blocked-modal');
    const reasonInput = document.getElementById('blocked-reason-input');
    const untilInput = document.getElementById('blocked-until-input');
    const saveBtn = document.getElementById('blocked-save-btn');
    const cancelBtn = document.getElementById('blocked-cancel-btn');

    reasonInput.value = existing.reason || '';
    untilInput.value = normalizeDateInput(existing.until || '');

    modal.classList.remove('hidden');
    reasonInput.focus();

    return new Promise(resolve => {
        const cleanup = () => {
            saveBtn.removeEventListener('click', onSave);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const close = () => {
            modal.classList.add('hidden');
            cleanup();
        };

        const onSave = () => {
            const reason = reasonInput.value.trim();
            const until = normalizeDateInput(untilInput.value);

            if (!reason || !until) {
                showToast('Preencha o motivo do bloqueio e a data prevista de conclusao.');
                return;
            }

            close();
            resolve({ reason, until });
        };

        const onCancel = () => {
            close();
            resolve(null);
        };

        saveBtn.addEventListener('click', onSave);
        cancelBtn.addEventListener('click', onCancel);
    });
}

async function handleDrop(e) {
    e.preventDefault();
    if (!draggedCard) return;
    const movedCard = draggedCard;

    const targetColumnEl = this.closest('.column');
    const columnId = targetColumnEl.dataset.id;
    const cardId = movedCard.dataset.id;
    const isTargetBlocked = targetColumnEl.dataset.isBlocked === 'true';
    const isEnteringBlocked = isTargetBlocked && columnId !== dragOriginColumnId;

    let blockedPayload = null;

    if (isEnteringBlocked) {
        const details = await openBlockedModal({
            reason: movedCard.dataset.blockedReason,
            until: movedCard.dataset.blockedUntil
        });

        if (!details) {
            revertDraggedCardPosition();
            return;
        }

        blockedPayload = {
            blocked_reason: details.reason,
            blocked_until: details.until
        };
    }

    try {
        const movePayload = { column_id: columnId };
        if (blockedPayload) {
            movePayload.blocked_reason = blockedPayload.blocked_reason;
            movePayload.blocked_until = blockedPayload.blocked_until;
        }

        const response = await fetch(`${API_URL}/cards/${cardId}/move`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(movePayload)
        });

        if (!response.ok) {
            let backendMessage = 'Falha ao salvar nova coluna do card.';
            try {
                const errorBody = await response.json();
                if (errorBody?.error) backendMessage = errorBody.error;
            } catch {
                // ignore parse errors and keep default message
            }
            throw new Error(backendMessage);
        }

        const data = await response.json();
        movedCard.dataset.columnId = String(columnId);

        if (isTargetBlocked) {
            movedCard.dataset.blockedReason = data.blocked_reason || blockedPayload?.blocked_reason || '';
            movedCard.dataset.blockedUntil = normalizeDateInput(data.blocked_until || blockedPayload?.blocked_until || '');
        } else {
            // Defensive clear when leaving Blocked, even if API response shape changes.
            movedCard.dataset.blockedReason = '';
            movedCard.dataset.blockedUntil = '';
        }

        applyCardVisuals(movedCard);
        await loadBoard();
    } catch (err) {
        console.error('Failed to move card:', err);
        revertDraggedCardPosition();
        showToast(err.message || 'Falha ao salvar nova coluna do card.');
    }
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.card:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
        }

        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function addCard(columnId, cardData, container, template) {
    try {
        const payload = {
            column_id: columnId,
            content: cardData.title,
            subject: cardData.subject || null,
            due_date: cardData.dueDate || null,
            notes: cardData.notes || null,
            actions: cardData.actions || [],
            comments: [],
            priority: cardData.priority || 'normal',
            blocked_reason: null,
            blocked_until: null
        };

        const response = await fetch(`${API_URL}/cards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to add card');

        const newCardData = await response.json();
        const cardEl = createCardElement(newCardData, template, columnId);
        container.appendChild(cardEl);
        loadBoard();
    } catch (err) {
        console.error('Error adding card:', err);
        showToast('Falha ao criar card.');
    }
}

async function updateCardActions(cardId, actions) {
    try {
        const response = await fetch(`${API_URL}/cards/${cardId}/actions`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actions })
        });

        if (!response.ok) throw new Error('Failed to update card actions');
    } catch (err) {
        console.error('Error updating card actions:', err);
        showToast('Falha ao salvar estado dos checkboxes.');
    }
}

async function updateCardComments(cardId, comments) {
    try {
        const response = await fetch(`${API_URL}/cards/${cardId}/comments`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comments })
        });

        if (!response.ok) throw new Error('Failed to update card comments');

        const data = await response.json();
        return normalizeComments(data.comments || comments);
    } catch (err) {
        console.error('Error updating card comments:', err);
        showToast('Falha ao salvar comentarios.');
        return null;
    }
}

async function archiveCard(cardEl) {
    const inDoneColumn = isDoneColumnElement(cardEl.closest('.column'));
    if (!inDoneColumn) {
        showToast('Arquivamento permitido somente na coluna Done.');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/cards/${cardEl.dataset.id}/archive`, {
            method: 'PUT'
        });

        if (!response.ok) {
            let backendMessage = 'Falha ao arquivar card.';
            try {
                const body = await response.json();
                if (body?.error) backendMessage = body.error;
            } catch {
                // keep default
            }
            throw new Error(backendMessage);
        }

        await loadBoard();
    } catch (err) {
        console.error('Error archiving card:', err);
        showToast(err.message || 'Falha ao arquivar card.');
    }
}

async function loadArchivedCards() {
    const listEl = document.getElementById('archived-list');
    if (!listEl) return;

    try {
        const response = await fetch(`${API_URL}/cards/archived`);
        if (!response.ok) throw new Error('Failed to load archived cards');

        const cards = await response.json();
        if (!Array.isArray(cards) || cards.length === 0) {
            listEl.innerHTML = '<p class="archived-empty">Nenhum card arquivado.</p>';
            return;
        }

        listEl.innerHTML = cards
            .map(card => {
                const archivedAt = formatDateTimeBR(card.archived_at);
                const subjectText = card.subject ? `<p class="archived-item-subject">${escapeHtml(card.subject)}</p>` : '';
                const archivedAtText = archivedAt ? `<p class="archived-item-date">Arquivado em ${escapeHtml(archivedAt)}</p>` : '';

                return `
                    <div class="archived-item" data-card-id="${card.id}">
                        <div class="archived-item-main">
                            <p class="archived-item-title">${escapeHtml(card.content || '')}</p>
                            ${subjectText}
                            ${archivedAtText}
                        </div>
                        <button class="archived-unarchive-btn" type="button" data-card-id="${card.id}">Desarquivar</button>
                    </div>
                `;
            })
            .join('');

        listEl.querySelectorAll('.archived-unarchive-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const cardId = button.dataset.cardId;
                await unarchiveCard(cardId);
            });
        });
    } catch (err) {
        console.error('Error loading archived cards:', err);
        listEl.innerHTML = '<p class="archived-empty">Falha ao carregar cards arquivados.</p>';
    }
}

async function unarchiveCard(cardId) {
    try {
        const response = await fetch(`${API_URL}/cards/${cardId}/unarchive`, {
            method: 'PUT'
        });

        if (!response.ok) throw new Error('Failed to unarchive card');

        await Promise.all([
            loadArchivedCards(),
            loadBoard()
        ]);
    } catch (err) {
        console.error('Error unarchiving card:', err);
        showToast('Falha ao desarquivar card.');
    }
}

async function openCommentsModal(cardEl) {
    const modal = document.getElementById('comments-modal');
    const titleEl = document.getElementById('comments-modal-card-title');
    const listEl = document.getElementById('comments-list');
    const inputEl = document.getElementById('new-comment-input');
    const saveBtn = document.getElementById('comments-save-btn');
    const cancelBtn = document.getElementById('comments-cancel-btn');

    let currentComments = normalizeComments(JSON.parse(cardEl.dataset.comments || '[]'));
    titleEl.textContent = `Card: ${cardEl.dataset.title || ''}`;
    inputEl.value = '';

    const renderComments = comments => {
        if (!comments.length) {
            listEl.innerHTML = '<p class="comments-empty">Sem comentarios ainda.</p>';
            return;
        }

        listEl.innerHTML = comments
            .map((comment, index) => {
                const timestamp = formatDateTimeBR(comment.created_at);
                return `
                    <div class="comment-item">
                        <div class="comment-item-header">
                            ${timestamp ? `<p class="comment-item-date">${escapeHtml(timestamp)}</p>` : '<p class="comment-item-date"></p>'}
                            <button class="comment-delete-btn" type="button" data-index="${index}" aria-label="Excluir comentario">&times;</button>
                        </div>
                        <p class="comment-item-text">${escapeHtml(comment.text)}</p>
                    </div>
                `;
            })
            .join('');
    };

    renderComments(currentComments);
    modal.classList.remove('hidden');
    inputEl.focus();

    await new Promise(resolve => {
        const cleanup = () => {
            saveBtn.removeEventListener('click', onSave);
            cancelBtn.removeEventListener('click', onCancel);
            listEl.removeEventListener('click', onDeleteComment);
        };

        const close = () => {
            modal.classList.add('hidden');
            cleanup();
            resolve();
        };

        const onSave = async () => {
            const newCommentText = inputEl.value.trim();
            if (!newCommentText) {
                showToast('Digite um comentario antes de salvar.');
                return;
            }

            const nextComments = [
                ...currentComments,
                { text: newCommentText, created_at: new Date().toISOString() }
            ];

            const savedComments = await updateCardComments(cardEl.dataset.id, nextComments);
            if (!savedComments) return;

            currentComments = savedComments;
            cardEl.dataset.comments = JSON.stringify(currentComments);
            applyCardVisuals(cardEl);
            renderComments(currentComments);
            inputEl.value = '';
        };

        const onDeleteComment = async event => {
            const btn = event.target.closest('.comment-delete-btn');
            if (!btn) return;

            event.stopPropagation();
            const index = Number(btn.dataset.index);
            if (Number.isNaN(index) || index < 0 || index >= currentComments.length) return;

            const nextComments = currentComments.filter((_, i) => i !== index);
            const savedComments = await updateCardComments(cardEl.dataset.id, nextComments);
            if (!savedComments) return;

            currentComments = savedComments;
            cardEl.dataset.comments = JSON.stringify(currentComments);
            applyCardVisuals(cardEl);
            renderComments(currentComments);
        };

        const onCancel = () => {
            close();
        };

        saveBtn.addEventListener('click', onSave);
        cancelBtn.addEventListener('click', onCancel);
        listEl.addEventListener('click', onDeleteComment);
    });
}

async function openEditCardModal(cardEl) {
    const modal = document.getElementById('edit-card-modal');
    const titleInput = document.getElementById('edit-title-input');
    const subjectInput = document.getElementById('edit-subject-input');
    const dueDateInput = document.getElementById('edit-due-date-input');
    const notesInput = document.getElementById('edit-notes-input');
    const actionsInput = document.getElementById('edit-actions-input');
    const priorityInput = document.getElementById('edit-priority-input');
    const blockedSection = document.getElementById('edit-blocked-section');
    const blockedReasonInput = document.getElementById('edit-blocked-reason-input');
    const blockedUntilInput = document.getElementById('edit-blocked-until-input');
    const saveBtn = document.getElementById('edit-card-save-btn');
    const cancelBtn = document.getElementById('edit-card-cancel-btn');

    const isCardInBlocked = cardEl.closest('.column')?.dataset.isBlocked === 'true';

    titleInput.value = cardEl.dataset.title || '';
    subjectInput.value = cardEl.dataset.subject || '';
    dueDateInput.value = normalizeDateInput(cardEl.dataset.dueDate || '');
    notesInput.value = cardEl.dataset.notes || '';
    actionsInput.value = actionsToText(JSON.parse(cardEl.dataset.actions || '[]'));
    priorityInput.value = cardEl.dataset.priority || 'normal';
    blockedReasonInput.value = cardEl.dataset.blockedReason || '';
    blockedUntilInput.value = normalizeDateInput(cardEl.dataset.blockedUntil || '');

    blockedSection.classList.toggle('hidden', !isCardInBlocked);

    modal.classList.remove('hidden');
    titleInput.focus();

    await new Promise(resolve => {
        const cleanup = () => {
            saveBtn.removeEventListener('click', onSave);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const close = () => {
            modal.classList.add('hidden');
            cleanup();
            resolve();
        };

        const onSave = async () => {
            const title = titleInput.value.trim();
            if (!title) {
                showToast('Preencha o titulo do card.');
                return;
            }

            const payload = {
                content: title,
                subject: subjectInput.value.trim() || null,
                due_date: normalizeDateInput(dueDateInput.value) || null,
                notes: notesInput.value.trim() || null,
                actions: parseActionsFromText(
                    actionsInput.value,
                    JSON.parse(cardEl.dataset.actions || '[]')
                ),
                priority: priorityInput.value || 'normal',
                blocked_reason: null,
                blocked_until: null
            };

            if (isCardInBlocked) {
                const blockedReason = blockedReasonInput.value.trim();
                const blockedUntil = normalizeDateInput(blockedUntilInput.value);

                if (!blockedReason || !blockedUntil) {
                    showToast('Em Blocked, informe o motivo e a data prevista de conclusao.');
                    return;
                }

                payload.blocked_reason = blockedReason;
                payload.blocked_until = blockedUntil;
            }

            const success = await updateCard(cardEl.dataset.id, payload);
            if (success) {
                close();
                await loadBoard();
            }
        };

        const onCancel = () => {
            close();
        };

        saveBtn.addEventListener('click', onSave);
        cancelBtn.addEventListener('click', onCancel);
    });
}

async function updateCard(cardId, payload) {
    try {
        const response = await fetch(`${API_URL}/cards/${cardId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to update card');
        return true;
    } catch (err) {
        console.error('Error updating card:', err);
        showToast('Falha ao salvar alteracoes do card.');
        return false;
    }
}

async function duplicateCard(cardEl) {
    try {
        const payload = {
            column_id: Number(cardEl.dataset.columnId || cardEl.closest('.column')?.dataset.id),
            content: String(cardEl.dataset.title || '').trim(),
            subject: String(cardEl.dataset.subject || '').trim() || null,
            notes: String(cardEl.dataset.notes || '').trim() || null,
            due_date: normalizeDateInput(cardEl.dataset.dueDate) || null,
            actions: normalizeActions(JSON.parse(cardEl.dataset.actions || '[]')),
            comments: normalizeComments(JSON.parse(cardEl.dataset.comments || '[]')),
            priority: cardEl.dataset.priority || 'normal',
            blocked_reason: String(cardEl.dataset.blockedReason || '').trim() || null,
            blocked_until: normalizeDateInput(cardEl.dataset.blockedUntil) || null
        };

        if (!payload.column_id || !payload.content) {
            showToast('Nao foi possivel copiar o card.');
            return;
        }

        const response = await fetch(`${API_URL}/cards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to duplicate card');
        await loadBoard();
    } catch (err) {
        console.error('Error duplicating card:', err);
        showToast('Falha ao copiar card.');
    }
}

async function deleteCard(cardId, element) {
    try {
        const response = await fetch(`${API_URL}/cards/${cardId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete card');
        element.remove();
        const columnEl = element.closest('.column');
        if (columnEl) {
            const list = columnEl.querySelector('.card-list');
            const btn = columnEl.querySelector('.column-toggle-collapse-btn');
            if (list && btn) {
                updateColumnCollapseButtonLabel(list, btn);
            }
        }
        updateGlobalCollapseButtonLabel();
    } catch (err) {
        console.error('Error deleting card:', err);
        showToast('Falha ao remover card.');
    }
}

