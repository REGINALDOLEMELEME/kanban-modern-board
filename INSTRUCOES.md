# Como iniciar o projeto

## Fluxo oficial: via CLI (sem .bat)

Este projeto deve ser iniciado pelo terminal.
Nao vamos usar `iniciar-kanban.bat`.

## 1) Iniciar o backend (Node)

No terminal, entre na pasta `backend` e rode:

```bash
cd backend
npm install
npm start
```

O backend deve ficar disponivel em `http://localhost:3000`.

## 2) Abrir o frontend

Com o backend rodando, abra o arquivo:

- `frontend/index.html`

## 3) Verificar se backend esta no ar

No navegador, teste:

- `http://localhost:3000/api/board`

Se retornar JSON, esta funcionando.

## 4) Comando rapido (PowerShell)

Da raiz do projeto, voce pode iniciar o backend com:

```powershell
cd backend; npm start
```
