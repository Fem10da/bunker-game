import postgres from "postgres";

import type { TelegramUser } from "@bunker/contracts";

export interface CreateAuthSessionInput {
  readonly expiresAt: Date;
  readonly initDataHash: string;
  readonly tokenHash: string;
  readonly user: TelegramUser;
}

export interface AuthSessionStore {
  readonly close: () => Promise<void>;
  readonly create: (input: CreateAuthSessionInput) => Promise<void>;
  readonly findUserByTokenHash: (
    tokenHash: string
  ) => Promise<TelegramUser | null>;
}

export class AuthSessionReplayError extends Error {
  constructor() {
    super("REPLAYED_TELEGRAM_INIT_DATA");
    this.name = "AuthSessionReplayError";
  }
}

interface TelegramUserRow {
  readonly first_name: string;
  readonly language_code: string | null;
  readonly last_name: string | null;
  readonly telegram_id: string;
  readonly username: string | null;
}

function toTelegramUser(row: TelegramUserRow): TelegramUser {
  return {
    firstName: row.first_name,
    id: row.telegram_id,
    ...(row.language_code === null
      ? {}
      : { languageCode: row.language_code }),
    ...(row.last_name === null ? {} : { lastName: row.last_name }),
    ...(row.username === null ? {} : { username: row.username })
  };
}

function isReplayConflict(error: unknown) {
  return (
    error instanceof postgres.PostgresError &&
    error.code === "23505" &&
    error.constraint_name === "auth_sessions_init_data_hash_unique"
  );
}

export async function openPostgresAuthSessionStore(
  databaseUrl: string
): Promise<AuthSessionStore> {
  const sql = postgres(databaseUrl, {
    max: 5
  });

  try {
    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(26072026)`;
      await transaction`
        CREATE TABLE IF NOT EXISTS telegram_users (
          telegram_id bigint PRIMARY KEY,
          first_name text NOT NULL,
          last_name text,
          username text,
          language_code text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await transaction`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token_hash char(64) PRIMARY KEY,
          init_data_hash char(64) NOT NULL,
          telegram_id bigint NOT NULL REFERENCES telegram_users(telegram_id)
            ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          CONSTRAINT auth_sessions_init_data_hash_unique UNIQUE (init_data_hash)
        )
      `;
      await transaction`
        CREATE INDEX IF NOT EXISTS auth_sessions_active_token_idx
        ON auth_sessions (token_hash, expires_at)
      `;
    });
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw error;
  }

  return {
    close: async () => {
      await sql.end({ timeout: 5 });
    },
    create: async (input) => {
      try {
        await sql.begin(async (transaction) => {
          await transaction`
            INSERT INTO telegram_users (
              telegram_id,
              first_name,
              last_name,
              username,
              language_code
            )
            VALUES (
              ${input.user.id},
              ${input.user.firstName},
              ${input.user.lastName ?? null},
              ${input.user.username ?? null},
              ${input.user.languageCode ?? null}
            )
            ON CONFLICT (telegram_id) DO UPDATE SET
              first_name = EXCLUDED.first_name,
              last_name = EXCLUDED.last_name,
              username = EXCLUDED.username,
              language_code = EXCLUDED.language_code,
              updated_at = now()
          `;
          await transaction`
            INSERT INTO auth_sessions (
              token_hash,
              init_data_hash,
              telegram_id,
              expires_at
            )
            VALUES (
              ${input.tokenHash},
              ${input.initDataHash},
              ${input.user.id},
              ${input.expiresAt}
            )
          `;
        });
      } catch (error) {
        if (isReplayConflict(error)) {
          throw new AuthSessionReplayError();
        }
        throw error;
      }
    },
    findUserByTokenHash: async (tokenHash) => {
      const [row] = await sql<TelegramUserRow[]>`
        SELECT
          users.telegram_id::text,
          users.first_name,
          users.last_name,
          users.username,
          users.language_code
        FROM auth_sessions AS sessions
        JOIN telegram_users AS users
          ON users.telegram_id = sessions.telegram_id
        WHERE sessions.token_hash = ${tokenHash}
          AND sessions.expires_at > now()
        LIMIT 1
      `;

      return row === undefined ? null : toTelegramUser(row);
    }
  };
}
