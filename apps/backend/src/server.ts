import { buildApp } from "./app.js";
import { openPostgresAuthSessionStore } from "./auth-sessions.js";
import { openPostgresLobbyStore } from "./lobbies.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL;
const originServiceToken = process.env.ORIGIN_SERVICE_TOKEN;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;

if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is required");
}
if (originServiceToken === undefined) {
  throw new Error("ORIGIN_SERVICE_TOKEN is required");
}
if (telegramBotToken === undefined) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

const authSessions = await openPostgresAuthSessionStore(databaseUrl);
const lobbies = await openPostgresLobbyStore(databaseUrl);
const app = buildApp({
  authSessions,
  lobbies,
  logger: true,
  originServiceToken,
  telegramBotToken
});

await app.listen({
  host,
  port
});

const sweepStaleWaitingLobbies = () => {
  void lobbies.sweepStaleWaitingLobbies().then(
    (deleted) => {
      if (deleted > 0) {
        app.log.info({ deleted }, "Swept stale waiting lobbies");
      }
    },
    (error: unknown) => {
      app.log.error({ error }, "Failed to sweep stale waiting lobbies");
    }
  );
};
sweepStaleWaitingLobbies();
setInterval(sweepStaleWaitingLobbies, 60 * 60 * 1000);

const close = async () => {
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => {
  void close();
});
process.once("SIGTERM", () => {
  void close();
});
