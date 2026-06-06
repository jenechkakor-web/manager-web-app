# Manager Web App

Web application for manager workflows.

## Запуск

```bash
npm start
```

Справочник технических описаний хранится в `templates/tech-presets.json`.
Редактирование доступно через приложение под логином `admin` и паролем `admin2026`.

Выгрузка поддерживает два шаблона: `Договор подряда` и `Счет-договор`.

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

## Общий справочник

Публичная версия читает справочник из `templates/tech-presets.json` в ветке `main`.
Чтобы сохранить изменения для всех:

1. Открыть справочник в приложении.
2. Войти под логином `admin` и паролем `admin2026`.
3. Вставить GitHub token с доступом `Contents: Read and write` к репозиторию `jenechkakor-web/manager-web-app`.
4. Нажать `Сохранить`.

Token хранится только в браузере администратора и не добавляется в код приложения.
