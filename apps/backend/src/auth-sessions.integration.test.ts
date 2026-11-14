import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AuthSessionReplayError,
  openPostgresAuthSessionStore
} from "./auth-sessions.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe.skipIf(databaseUrl === undefined)("PostgreSQL auth sessions", () => {
  it("migrates, restores active sessions and rejects initData replay", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }

    const store = await openPostgresAuthSessionStore(databaseUrl);
    const suffix = randomUUID();
    const input = {
      expiresAt: new Date(Date.now() + 60_000),
      initDataHash: hash(`init-data-${suffix}`),
      tokenHash: hash(`session-${suffix}`),
      user: {
        firstName: "Вадим",
        id: "424242",
        languageCode: "uk",
        username: "femida"
      }
    } as const;

    try {
      await store.create(input);
      await expect(
        store.findUserByTokenHash(input.tokenHash)
      ).resolves.toEqual(input.user);
      await expect(
        store.create({
          ...input,
          tokenHash: hash(`replayed-session-${suffix}`)
        })
      ).rejects.toBeInstanceOf(AuthSessionReplayError);
      await expect(
        store.findUserByTokenHash(hash(`missing-${suffix}`))
      ).resolves.toBeNull();
    } finally {
      await store.close();
    }
  });
});
