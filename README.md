# Manager Web App

Web application for manager workflows.

## Запуск

```bash
npm start
```

Справочник технических описаний хранится в `templates/tech-presets.json`.
Редактирование доступно через приложение под логином `admin` и паролем `admin2026`.

## Продолжить разработку с другого ПК

1. Установить Node.js.
2. Склонировать репозиторий:

```bash
git clone https://github.com/jenechkakor-web/manager-web-app.git
cd manager-web-app
```

3. Запустить приложение:

```bash
npm start
```

4. Открыть `http://127.0.0.1:4173/`.

Перед началом работы забрать последние изменения:

```bash
git pull
```

После правок:

```bash
git add .
git commit -m "Описание изменений"
git push
```

## Публикация

Для общего редактируемого справочника нужен запуск через Node-сервер (`server.js`).
GitHub Pages подходит только для статической версии и не сможет сохранять изменения справочника.
