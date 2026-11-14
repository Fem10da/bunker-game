# Бункер

Повністю цифрова сценарно-рольова гра для Telegram Mini App зі спільним публічним екраном.

## Вимоги

- Node.js 24 LTS
- pnpm 11

## Локальна перевірка

```bash
nvm use
pnpm install
cp .env.example .env
pnpm check
```

## VPS

Production backend і PostgreSQL запускаються через Docker Compose, не через
PM2. Існуючі PM2-процеси VPS не змінюються. Підготовка, deploy, rollback, логи
та backup описані в [`infra/vps/README.md`](./infra/vps/README.md).

Локальна перевірка інфраструктурних файлів:

```bash
pnpm infra:check
```

`ORIGIN_SERVICE_TOKEN` має збігатися із секретом Cloudflare Worker. Backend
відхиляє прямі запити до `/api/*` без цього заголовка.

`TELEGRAM_BOT_TOKEN` використовується тільки backend для перевірки підпису
`Telegram.WebApp.initData` і не повинен потрапляти у web bundle.

## Поточний API

- `GET /health` — стан backend без авторизації.
- `POST /api/games/preview` — розрахунок кількості місць для beta.
- `POST /api/auth/telegram` — перевіряє HMAC-підпис і вік Telegram Mini App
  `initData`, після чого повертає лише нормалізовані дані користувача.
- `/api/lobbies/*` — авторитетні серверні лобі, готовність, порядок і запуск.
- `/api/games/:code/*` — вступ катастрофи, ходи, картки й реакції,
  голосування та фінальне рішення ведучого.

Авторизація створює хешовану серверну сесію в PostgreSQL і повертає лише
cookie з атрибутами `HttpOnly`, `Secure`, `SameSite=Lax`.

## Структура

- `apps/web` — Telegram Mini App, вкладка «Стіл» і shared display;
- `apps/edge-worker` — Cloudflare Worker gateway;
- `apps/backend` — HTTP API та майбутній real-time room;
- `packages/contracts` — спільні типи й команди;
- `packages/game-engine` — чисте серверне ігрове ядро;
- `packages/content` — TOON decode, schema та reference validation;
- `content` — version-controlled ігровий контент.
