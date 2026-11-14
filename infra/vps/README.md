# VPS deployment runbook

Цей контур ізольований від наявних застосунків сервера:

- backend і PostgreSQL працюють у Docker Compose;
- PostgreSQL не має host-порту;
- backend доступний на VPS лише через `127.0.0.1:3301`;
- Nginx проксіює окремий технічний hostname до backend;
- PM2 та його процеси не змінюються.

До першого запуску потрібно перевірити, що порт `3301` і вибраний Nginx
`server_name` не зайняті іншими сервісами.

## 1. Дані доступу

Для віддаленого розгортання достатньо:

- SSH username;
- IP або hostname VPS;
- робочий вхід за локальним SSH-ключем.

Пароль VPS, приватний SSH-ключ, Telegram token та production secrets не
передаються в чат і не зберігаються в Git.

## 2. Одноразова підготовка VPS

Команди виконуються після read-only аудиту наявних Docker, Nginx, PM2 і портів:

```bash
sudo install -d -o bunker -g bunker -m 0750 /opt/bunker/repo
sudo install -d -o bunker -g bunker -m 0700 /opt/bunker/shared
git clone https://github.com/Fem10da/bunker.git /opt/bunker/repo
cp /opt/bunker/repo/infra/vps/.env.production.example \
  /opt/bunker/shared/.env.production
chmod 600 /opt/bunker/shared/.env.production
```

Якщо репозиторій стане приватним, на VPS використовується окремий read-only
GitHub deploy key.

Секрети генеруються безпосередньо на VPS:

```bash
openssl rand -hex 32
```


У `/opt/bunker/shared/.env.production` потрібно замінити:

- `POSTGRES_PASSWORD` і ту саму частину пароля у `DATABASE_URL`;
- `ORIGIN_SERVICE_TOKEN`;
- `TELEGRAM_BOT_TOKEN`.

Значення рекомендується залишати hex-рядками без пробілів і shell-символів.

## 3. Перший запуск та оновлення

```bash
cd /opt/bunker/repo
./scripts/deploy-vps.sh
curl --fail --show-error http://127.0.0.1:3301/health
```

Кожний наступний deploy виконується тією самою командою. Скрипт:

1. відмовляється працювати з dirty worktree;
2. оновлює `main` тільки fast-forward;
3. збирає image із тегом commit SHA;
4. запускає PostgreSQL і backend;
5. чекає Docker health check;
6. повертає backend на попередній image, якщо новий контейнер не став healthy.

Git checkout після невдалого deploy не відмотується, але робочий backend
автоматично повертається на попередній image. Перший deploy не має попереднього
image для rollback.

## 4. Nginx і HTTPS без власного домену

До придбання домену можна використати технічний hostname виду
`bunker-origin.<VPS-IP-with-dashes>.sslip.io`. Він має резолвитися на публічну
IP-адресу VPS. Остаточний hostname вибирається лише після аудиту чинних Nginx
конфігів.

```bash
sudo cp /opt/bunker/repo/infra/vps/nginx/bunker-origin.conf.template \
  /etc/nginx/sites-available/bunker-origin.conf
sudo editor /etc/nginx/sites-available/bunker-origin.conf
sudo ln -s /etc/nginx/sites-available/bunker-origin.conf \
  /etc/nginx/sites-enabled/bunker-origin.conf
sudo nginx -t
sudo systemctl reload nginx
```

У скопійованому файлі потрібно замінити `BUNKER_ORIGIN_HOSTNAME`. Після
успішної HTTP-перевірки TLS додається Certbot Nginx plugin:

```bash
sudo certbot --nginx -d <technical-hostname>
sudo certbot renew --dry-run
```

Окремі `location /api/realtime/` і `/api/screens/:code/realtime` вимикають
Nginx buffering для SSE-потоків і тримають з'єднання відкритим до однієї
години. Після оновлення репозиторію
потрібно повторно перенести актуальний template або вручну синхронізувати цей
блок із чинним конфігом, а потім виконати `nginx -t` і reload.

До порту `3301` не додається зовнішнє firewall-правило. Назовні залишаються
лише вже керовані Nginx порти `80/443`.

## 5. Cloudflare Worker → VPS

Лише після готового HTTPS origin:

```bash
pnpm --filter @bunker/edge-worker exec wrangler secret put \
  ORIGIN_HTTP_URL --env staging
pnpm --filter @bunker/edge-worker exec wrangler secret put \
  ORIGIN_SERVICE_TOKEN --env staging
```

`ORIGIN_HTTP_URL` отримує `https://<technical-hostname>`, а
`ORIGIN_SERVICE_TOKEN` має точно збігатися зі значенням на VPS. Команди
створюють нову версію Worker, тому після них обов'язкові `/health` і API smoke
tests через `workers.dev`.

## 5а. Публічний домен (production)

Після появи власного домену `bunker.f3mida.tech` веде на Worker, а не напряму
на VPS. Перед першим `deploy --env production` у зоні Cloudflare не повинно
лишатися конфліктного DNS-запису на цю саму назву (наприклад, зайвий ручний
A-запис на IP VPS) — інакше Cloudflare відмовить у прив'язці Custom Domain.

```bash
pnpm --filter @bunker/edge-worker exec wrangler secret put \
  ORIGIN_HTTP_URL --env production
pnpm --filter @bunker/edge-worker exec wrangler secret put \
  ORIGIN_SERVICE_TOKEN --env production
pnpm --filter @bunker/edge-worker exec wrangler deploy --env production
```

`routes` у `wrangler.jsonc` (`env.production`) уже містить
`bunker.f3mida.tech` як `custom_domain: true` — Cloudflare сам створює
проксійований DNS-запис і TLS-сертифікат під час цього деплою, вручну
записи додавати не треба. Технічний origin-hostname (VPS) лишається
окремим і публічно не показується.

## 6. Логи

```bash
cd /opt/bunker/repo
BUNKER_IMAGE_TAG="$(cat /opt/bunker/shared/current-image-tag)" \
  docker compose \
    --env-file /opt/bunker/shared/.env.production \
    --file infra/vps/compose.yaml \
    ps
BUNKER_IMAGE_TAG="$(cat /opt/bunker/shared/current-image-tag)" \
  docker compose \
    --env-file /opt/bunker/shared/.env.production \
    --file infra/vps/compose.yaml \
    logs --follow --tail 100 backend
sudo tail -f /var/log/nginx/bunker-origin.access.log
```

Backend пише структуровані JSON-логи Fastify у stdout. Docker обмежує локальну
історію п'ятьма файлами по 10 MB на контейнер. Nginx використовує системний
logrotate.

## 7. PostgreSQL backup

Одноразово встановити щоденний systemd timer:

```bash
sudo cp /opt/bunker/repo/infra/vps/systemd/bunker-postgres-backup.* \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bunker-postgres-backup.timer
sudo systemctl list-timers bunker-postgres-backup.timer
```

Ручна резервна копія та перевірка timer:

```bash
/opt/bunker/repo/scripts/backup-postgres.sh
sudo systemctl start bunker-postgres-backup.service
sudo journalctl -u bunker-postgres-backup.service --since today
```

Файл створюється з правами власника у `/opt/bunker/shared/backups`. До
публічної beta потрібно додати копію на інший фізичний носій або віддалене
сховище: backup лише на диску того самого VPS не захищає від втрати сервера.

Restore є навмисно ручною операцією. Перед ним контейнери застосунку
зупиняються, актуальна база додатково архівується, а команда перевіряється на
окремій тестовій базі.

## 8. Перевірка після deploy

```bash
curl --fail --show-error http://127.0.0.1:3301/health
curl --fail --show-error https://<technical-hostname>/health
curl --fail --show-error \
  https://<your-worker>.workers.dev/health
```

API smoke test виконується через Worker, не через публічний origin. Після
перевірки фіксуються commit SHA, Docker image tag, Worker version і час deploy.
