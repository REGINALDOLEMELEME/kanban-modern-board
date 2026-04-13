const API_URL = 'http://localhost:3000/api';

document.addEventListener('DOMContentLoaded', () => {
    setupBoardNameEditor();
    setupPdfExport();
    loadBoardName();
    loadBoard();
});

function setupBoardNameEditor() {
    const input = document.getElementById('board-name-input');
    const saveButton = document.getElementById('save-board-name-btn');

    saveButton.addEventListener('click', () => saveBoardName(input.value));

    input.addEventListener('keydown', async event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            await saveBoardName(input.value);
        }
    });
}

function setupPdfExport() {
    const exportButton = document.getElementById('export-pdf-btn');
    if (!exportButton) return;

    exportButton.addEventListener('click', () => {
        window.print();
    });
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
        alert('Informe um nome para o quadro.');
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
        alert('Nao foi possivel salvar o nome do quadro.');
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
        alert('Could not load board. Is the backend running?');
    }
}

function renderBoard(columnsData) {
    const board = document.getElementById('board');
    board.innerHTML = '';
    const dueTodayCards = [];

    const columnTemplate = document.getElementById('column-template');
    const cardTemplate = document.getElementById('card-template');

    columnsData.forEach(columnData => {
        const columnClone = columnTemplate.content.cloneNode(true);
        const columnEl = columnClone.querySelector('.column');
        columnEl.dataset.id = columnData.id;

        columnClone.querySelector('.column-title').textContent = columnData.title;

        const cardList = columnClone.querySelector('.card-list');
        cardList.addEventListener('dragover', handleDragOver);
        cardList.addEventListener('drop', handleDrop);

        if (columnData.cards && columnData.cards.length > 0) {
            columnData.cards.forEach(cardData => {
                const cardEl = createCardElement(cardData, cardTemplate);
                cardList.appendChild(cardEl);
            });
        }

        const addBtn = columnClone.querySelector('.add-card-btn');
        const addForm = columnClone.querySelector('.add-card-form');
        const saveBtn = columnClone.querySelector('.save-card-btn');
        const cancelBtn = columnClone.querySelector('.cancel-card-btn');
        const titleInput = columnClone.querySelector('.new-card-title-input');
        const subjectInput = columnClone.querySelector('.new-card-subject-input');
        const dueDateInput = columnClone.querySelector('.new-card-due-date-input');
        const actionsInput = columnClone.querySelector('.new-card-actions-input');
        const priorityInput = columnClone.querySelector('.new-card-priority-input');

        addBtn.addEventListener('click', () => {
            addBtn.classList.add('hidden');
            addForm.classList.remove('hidden');
            titleInput.focus();
        });

        cancelBtn.addEventListener('click', () => {
            addForm.classList.add('hidden');
            addBtn.classList.remove('hidden');
            resetAddCardForm(titleInput, subjectInput, dueDateInput, actionsInput, priorityInput);
        });

        saveBtn.addEventListener('click', async () => {
            const title = titleInput.value.trim();
            const subject = subjectInput.value.trim();
            const dueDate = dueDateInput.value;
            const actions = parseActionsFromText(actionsInput.value);
            const priority = priorityInput.value;

            if (!title) {
                alert('Preencha o titulo do card.');
                return;
            }

            await addCard(columnData.id, { title, subject, dueDate, actions, priority }, cardList, cardTemplate);
            addForm.classList.add('hidden');
            addBtn.classList.remove('hidden');
            resetAddCardForm(titleInput, subjectInput, dueDateInput, actionsInput, priorityInput);
        });

        if (columnData.cards && columnData.cards.length > 0) {
            columnData.cards.forEach(cardData => {
                if (isDueToday(cardData.due_date)) {
                    dueTodayCards.push({
                        title: cardData.content,
                        columnTitle: columnData.title
                    });
                }
            });
        }

        board.appendChild(columnClone);
    });

    renderDueAlerts(dueTodayCards);
}

function resetAddCardForm(titleInput, subjectInput, dueDateInput, actionsInput, priorityInput) {
    titleInput.value = '';
    subjectInput.value = '';
    dueDateInput.value = '';
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

function parseActionsFromText(actionsText) {
    return actionsText
        .split('\n')
        .map(action => action.trim())
        .filter(Boolean)
        .map(text => ({ text, done: false }));
}

function buildPriorityLabel(priority) {
    const labels = {
        normal: 'Normal',
        ponderado: 'Ponderado',
        urgente: 'Urgente'
    };

    return labels[priority] || 'Normal';
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

function createCardElement(cardData, template) {
    const clone = template.content.cloneNode(true);
    const cardEl = clone.querySelector('.card');
    const cardMain = clone.querySelector('.card-main');
    const titleEl = clone.querySelector('.card-title');
    const subjectEl = clone.querySelector('.card-subject');
    const deadlineEl = clone.querySelector('.card-deadline');
    const priorityChipEl = clone.querySelector('.priority-chip');
    const progressEl = clone.querySelector('.card-progress');
    const actionsListEl = clone.querySelector('.card-actions-list');

    cardEl.dataset.id = cardData.id;
    titleEl.textContent = cardData.content;

    if (cardData.subject) {
        subjectEl.textContent = cardData.subject;
        subjectEl.classList.remove('hidden');
    }

    if (cardData.due_date) {
        deadlineEl.textContent = `Prazo: ${formatDateBR(cardData.due_date)}`;
        deadlineEl.classList.remove('hidden');
        if (isDueToday(cardData.due_date)) {
            deadlineEl.classList.add('deadline-today');
        }
    }

    const priority = cardData.priority || 'normal';
    priorityChipEl.textContent = buildPriorityLabel(priority);
    priorityChipEl.classList.add(`priority-chip-${priority}`);

    const actions = normalizeActions(cardData.actions);

    if (actions.length > 0) {
        renderActions(actions, actionsListEl, progressEl, cardData.id);
    } else {
        actionsListEl.classList.add('hidden');
    }

    cardMain.addEventListener('mousedown', e => {
        if (e.target.tagName === 'INPUT') {
            e.stopPropagation();
        }
    });

    cardEl.addEventListener('dragstart', handleDragStart);
    cardEl.addEventListener('dragend', handleDragEnd);

    const deleteBtn = clone.querySelector('.delete-card-btn');
    deleteBtn.addEventListener('click', async () => {
        if (confirm('Tem certeza que deseja remover este card?')) {
            await deleteCard(cardData.id, cardEl);
        }
    });

    return cardEl;
}

function renderActions(actions, actionsListEl, progressEl, cardId) {
    actionsListEl.classList.remove('hidden');
    actionsListEl.innerHTML = '';

    const doneCount = actions.filter(action => action.done).length;
    progressEl.classList.remove('hidden');
    progressEl.textContent = `${doneCount}/${actions.length} acoes concluidas`;

    actions.forEach((action, index) => {
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
            actions[index].done = checkbox.checked;
            text.classList.toggle('done', checkbox.checked);
            await updateCardActions(cardId, actions);
            const doneNow = actions.filter(item => item.done).length;
            progressEl.textContent = `${doneNow}/${actions.length} acoes concluidas`;
        });

        row.appendChild(checkbox);
        row.appendChild(text);
        actionsListEl.appendChild(row);
    });
}

let draggedCard = null;

function handleDragStart(e) {
    draggedCard = this;
    setTimeout(() => this.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.id);
}

function handleDragEnd() {
    this.classList.remove('dragging');
    draggedCard = null;
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

async function handleDrop(e) {
    e.preventDefault();
    if (!draggedCard) return;

    const columnId = this.closest('.column').dataset.id;
    const cardId = draggedCard.dataset.id;

    try {
        const response = await fetch(`${API_URL}/cards/${cardId}/move`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ column_id: columnId })
        });

        if (!response.ok) throw new Error('Failed to move card in DB');
    } catch (err) {
        console.error('Failed to move card:', err);
        alert('Falha ao salvar nova coluna do card.');
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
            actions: cardData.actions || [],
            priority: cardData.priority || 'normal'
        };

        const response = await fetch(`${API_URL}/cards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to add card');

        const newCardData = await response.json();
        const cardEl = createCardElement(newCardData, template);
        container.appendChild(cardEl);
    } catch (err) {
        console.error('Error adding card:', err);
        alert('Falha ao criar card.');
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
        alert('Falha ao salvar estado dos checkboxes.');
    }
}

async function deleteCard(cardId, element) {
    try {
        const response = await fetch(`${API_URL}/cards/${cardId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete card');
        element.remove();
    } catch (err) {
        console.error('Error deleting card:', err);
        alert('Falha ao remover card.');
    }
}
