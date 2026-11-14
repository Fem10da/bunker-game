import { createHash, randomUUID } from "node:crypto";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { CHARACTERISTIC_CATEGORIES } from "@bunker/contracts";

import { openPostgresAuthSessionStore } from "./auth-sessions.js";
import { openPostgresLobbyStore } from "./lobbies.js";
import {
  FERTILITY_CAPABLE_SPECIAL_CONDITION,
  INSEMINATION_KIT_BAGGAGE
} from "./playtest-dossiers.js";
import { allPlaytestCards } from "./playtest-scenario.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe.skipIf(databaseUrl === undefined)("PostgreSQL lobbies", () => {
  it("starts a sixteen-player corporate lobby with unique dossiers and cards", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }

    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const suffix = randomUUID();
    const players = Array.from({ length: 16 }, (_, index) => ({
      firstName: `Гравець ${index + 1}`,
      id: String(940_000 + index),
      username: `corporate_${index + 1}`
    }));
    const host = players[0];
    if (host === undefined) {
      throw new Error("Expected a corporate lobby host");
    }

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`corporate-init-${user.id}-${suffix}`),
          tokenHash: hash(`corporate-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );

      await expect(lobbies.start(lobby.code, host.id)).resolves.toMatchObject({
        status: "started"
      });
      const views = await Promise.all(
        players.map((player) => lobbies.findGame(lobby.code, player.id))
      );
      expect(views.every((view) => view?.bunkerCapacity === 8)).toBe(true);
      expect(new Set(views.map((view) => view?.card.id)).size).toBe(16);
      for (const category of CHARACTERISTIC_CATEGORIES) {
        const values = views.map(
          (view) =>
            view?.characteristics.find(
              (characteristic) => characteristic.id === category.id
            )?.value
        );
        expect(new Set(values).size).toBe(16);
      }
    } finally {
      await Promise.all([authSessions.close(), lobbies.close()]);
    }
  });

  it("applies complex card effect families transactionally", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const directSql = postgres(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "834242", username: "cards_olena" },
      { firstName: "Максим", id: "835252", username: "cards_maksym" },
      { firstName: "Ірина", id: "836262", username: "cards_iryna" },
      { firstName: "Данило", id: "837272", username: "cards_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`cards-init-${user.id}-${suffix}`),
          tokenHash: hash(`cards-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      const setPlayerCard = async (playerId: string, cardId: string) => {
        const card = allPlaytestCards.find(({ id }) => id === cardId);
        if (card === undefined) {
          throw new Error(`Missing test card: ${cardId}`);
        }
        await directSql`
          UPDATE lobby_players AS player
          SET
            special_card = ${directSql.json(card)},
            card_used = false
          FROM lobbies
          WHERE lobbies.lobby_id = player.lobby_id
            AND lobbies.code = ${lobby.code}
            AND player.telegram_id = ${playerId}
        `;
      };
      const setHostCard = (cardId: string) =>
        setPlayerCard(host.id, cardId);
      const play = async (
        cardId: string,
        selection: Parameters<typeof lobbies.useCard>[2]
      ) => {
        await setHostCard(cardId);
        await lobbies.useCard(lobby.code, host.id, selection);
        await directSql`
          UPDATE lobbies
          SET reaction_deadline = now() - interval '1 second'
          WHERE code = ${lobby.code}
        `;
        const view = await lobbies.findGame(lobby.code, host.id);
        if (view === null) {
          throw new Error("Expected a running card test game");
        }
        return view;
      };

      await setHostCard("forced-disclosure");
      await setPlayerCard(players[1].id, "countermeasure");
      await setPlayerCard(players[2].id, "redirect");
      await lobbies.useCard(lobby.code, host.id, {
        characteristicId: "health",
        targetPlayerId: players[3].id
      });
      await lobbies.reactCard(lobby.code, players[1].id, {}, 0);
      const counteredReaction = await lobbies.reactCard(
        lobby.code,
        players[2].id,
        {},
        1
      );
      expect(counteredReaction.phase).toBe("revealing");
      expect(
        (await lobbies.findGame(lobby.code, host.id))?.players.find(
          ({ id }) => id === players[3].id
        )?.characteristics.health
      ).toBeDefined();

      const inspected = await play("private-review", {
        characteristicId: "hobby",
        targetPlayerId: players[1].id
      });
      expect(inspected.cardResult).toContain("Хобі:");

      const hostBeforeSwap = inspected.characteristics.find(
        ({ id }) => id === "profession"
      )?.value;
      const targetBeforeSwap = (
        await lobbies.findGame(lobby.code, players[1].id)
      )?.characteristics.find(({ id }) => id === "profession")?.value;
      await play("profession-exchange", {
        targetPlayerId: players[1].id
      });
      expect(
        (await lobbies.findGame(lobby.code, host.id))?.characteristics.find(
          ({ id }) => id === "profession"
        )?.value
      ).toBe(targetBeforeSwap);
      expect(
        (await lobbies.findGame(lobby.code, players[1].id))?.characteristics.find(
          ({ id }) => id === "profession"
        )?.value
      ).toBe(hostBeforeSwap);

      await play("public-accusation", {
        targetPlayerId: players[1].id
      });
      const [voteState] = await directSql<{ readonly card_state: unknown }[]>`
        SELECT card_state
        FROM lobbies
        WHERE code = ${lobby.code}
      `;
      expect(voteState?.card_state).toMatchObject({
        bonusVotes: [{ targetPlayerId: players[1].id, votes: 1 }]
      });

      await play("time-pressure", {
        targetPlayerId: players[1].id
      });
      const [turnState] = await directSql<{ readonly card_state: unknown }[]>`
        SELECT card_state
        FROM lobbies
        WHERE code = ${lobby.code}
      `;
      expect(turnState?.card_state).toMatchObject({
        turnAdjustments: [{ playerId: players[1].id, seconds: -30 }]
      });

      await directSql`
        UPDATE lobby_players AS player
        SET game_status = 'eliminated'
        FROM lobbies
        WHERE lobbies.lobby_id = player.lobby_id
          AND lobbies.code = ${lobby.code}
          AND player.telegram_id = ${players[2].id}
      `;
      const revived = await play("first-aid", {
        targetPlayerId: players[2].id
      });
      expect(
        revived.players.find(({ id }) => id === players[2].id)?.status
      ).toBe("active");

      const reordered = await play("change-order", {
        targetPlayerId: players[3].id
      });
      expect(
        reordered.players.find(({ id }) => id === players[3].id)?.position
      ).toBe(2);

      const redrawn = await play("second-copy", {});
      expect(redrawn.card.id).not.toBe("second-copy");
      expect(redrawn.card.used).toBe(false);
      expect(redrawn.cardResult).toContain(redrawn.card.title);
      expect(redrawn.lastEvent).not.toContain(redrawn.card.title);

      const otherView = await lobbies.findGame(lobby.code, players[1].id);
      expect(otherView?.cardResult).toBeNull();
      expect(otherView?.lastEvent).not.toContain(redrawn.card.title);

      const publicView = await lobbies.findPublicGame(lobby.code);
      expect(publicView?.lastEvent).not.toContain(redrawn.card.title);
    } finally {
      await Promise.allSettled([
        authSessions.close(),
        lobbies.close(),
        directSql.end({ timeout: 5 })
      ]);
    }
  });

  it("rejects a concurrent first reaction instead of auto-countering it", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const directSql = postgres(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "841242", username: "race_olena" },
      { firstName: "Максим", id: "841252", username: "race_maksym" },
      { firstName: "Ірина", id: "841262", username: "race_iryna" },
      { firstName: "Данило", id: "841272", username: "race_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`race-init-${user.id}-${suffix}`),
          tokenHash: hash(`race-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      const setPlayerCard = async (playerId: string, cardId: string) => {
        const card = allPlaytestCards.find(({ id }) => id === cardId);
        if (card === undefined) {
          throw new Error(`Missing test card: ${cardId}`);
        }
        await directSql`
          UPDATE lobby_players AS player
          SET
            special_card = ${directSql.json(card)},
            card_used = false
          FROM lobbies
          WHERE lobbies.lobby_id = player.lobby_id
            AND lobbies.code = ${lobby.code}
            AND player.telegram_id = ${playerId}
        `;
      };
      await setPlayerCard(host.id, "forced-disclosure");
      await setPlayerCard(players[1].id, "countermeasure");
      await setPlayerCard(players[2].id, "redirect");
      await lobbies.useCard(lobby.code, host.id, {
        characteristicId: "health",
        targetPlayerId: players[3].id
      });

      const [first, second] = await Promise.allSettled([
        lobbies.reactCard(lobby.code, players[1].id, {}, 0),
        lobbies.reactCard(
          lobby.code,
          players[2].id,
          { targetPlayerId: players[3].id },
          0
        )
      ]);
      const outcomes = [first, second];
      const fulfilled = outcomes.filter(
        (outcome) => outcome.status === "fulfilled"
      );
      const rejected = outcomes.filter(
        (outcome) => outcome.status === "rejected"
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({
        code: "REACTION_CHAIN_CHANGED"
      });
      expect(
        fulfilled[0]?.status === "fulfilled"
          ? fulfilled[0].value.cardChain?.reactions
          : undefined
      ).toHaveLength(1);

      const loserId =
        first.status === "rejected" ? players[1].id : players[2].id;
      const loserView = await lobbies.findGame(lobby.code, loserId);
      expect(loserView?.card.used).toBe(false);
    } finally {
      await Promise.allSettled([
        authSessions.close(),
        lobbies.close(),
        directSql.end({ timeout: 5 })
      ]);
    }
  });

  it("rejects a reaction redirect that breaks the action card's own rules", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const directSql = postgres(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "839242", username: "redirect_olena" },
      { firstName: "Максим", id: "839252", username: "redirect_maksym" },
      { firstName: "Ірина", id: "839262", username: "redirect_iryna" },
      { firstName: "Данило", id: "839272", username: "redirect_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`redirect-init-${user.id}-${suffix}`),
          tokenHash: hash(`redirect-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      await lobbies.reveal(lobby.code, host.id, "profession");
      await lobbies.finishTurn(lobby.code, host.id);
      await lobbies.reveal(lobby.code, players[1].id, "profession");
      await lobbies.finishTurn(lobby.code, players[1].id);

      const setPlayerCard = async (playerId: string, cardId: string) => {
        const card = allPlaytestCards.find(({ id }) => id === cardId);
        if (card === undefined) {
          throw new Error(`Missing test card: ${cardId}`);
        }
        await directSql`
          UPDATE lobby_players AS player
          SET
            special_card = ${directSql.json(card)},
            card_used = false
          FROM lobbies
          WHERE lobbies.lobby_id = player.lobby_id
            AND lobbies.code = ${lobby.code}
            AND player.telegram_id = ${playerId}
        `;
      };
      await setPlayerCard(players[2].id, "change-order");
      await setPlayerCard(host.id, "redirect");

      await lobbies.useCard(lobby.code, players[2].id, {
        targetPlayerId: players[3].id
      });
      await lobbies.reactCard(
        lobby.code,
        host.id,
        { targetPlayerId: players[1].id },
        0
      );
      await directSql`
        UPDATE lobbies
        SET reaction_deadline = now() - interval '1 second'
        WHERE code = ${lobby.code}
      `;

      const resolved = await lobbies.findGame(lobby.code, host.id);
      expect(resolved?.lastEvent).toContain("недопустима ціль");
      expect(
        resolved?.players.find(({ id }) => id === players[1].id)?.position
      ).toBe(2);
      expect(
        resolved?.players.find(({ id }) => id === players[3].id)?.position
      ).toBe(4);

      await expect(
        lobbies.findGame(lobby.code, players[3].id)
      ).resolves.toMatchObject({ phase: "revealing" });
    } finally {
      await Promise.allSettled([
        authSessions.close(),
        lobbies.close(),
        directSql.end({ timeout: 5 })
      ]);
    }
  });

  it("keeps the round-1 auto-skip on the profession-only rule", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const directSql = postgres(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "839342", username: "autoskip_olena" },
      { firstName: "Максим", id: "839352", username: "autoskip_maksym" },
      { firstName: "Ірина", id: "839362", username: "autoskip_iryna" },
      { firstName: "Данило", id: "839372", username: "autoskip_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`autoskip-init-${user.id}-${suffix}`),
          tokenHash: hash(`autoskip-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      const forcedDisclosureCard = allPlaytestCards.find(
        ({ id }) => id === "forced-disclosure"
      );
      if (forcedDisclosureCard === undefined) {
        throw new Error("Missing test card: forced-disclosure");
      }
      await directSql`
        UPDATE lobby_players AS player
        SET special_card = ${directSql.json(forcedDisclosureCard)}, card_used = false
        FROM lobbies
        WHERE lobbies.lobby_id = player.lobby_id
          AND lobbies.code = ${lobby.code}
          AND player.telegram_id = ${host.id}
      `;
      await lobbies.useCard(lobby.code, host.id, {
        characteristicId: "profession",
        targetPlayerId: players[1].id
      });
      await directSql`
        UPDATE lobbies
        SET reaction_deadline = now() - interval '1 second'
        WHERE code = ${lobby.code}
      `;
      const afterForcedReveal = await lobbies.findGame(lobby.code, host.id);
      expect(
        afterForcedReveal?.players.find(({ id }) => id === players[1].id)
          ?.characteristics.profession
      ).toBeDefined();

      await directSql`
        UPDATE lobbies
        SET turn_deadline = now() - interval '1 second'
        WHERE code = ${lobby.code}
      `;
      const afterHostTimeout = await lobbies.findGame(
        lobby.code,
        players[1].id
      );
      expect(afterHostTimeout?.currentTurnPlayerId).toBe(players[1].id);
      expect(
        afterHostTimeout?.players.find(({ id }) => id === host.id)
          ?.characteristics.profession
      ).toBeDefined();
      expect(
        afterHostTimeout?.players.find(({ id }) => id === host.id)
          ?.characteristics.health
      ).toBeUndefined();

      await directSql`
        UPDATE lobbies
        SET turn_deadline = now() - interval '1 second'
        WHERE code = ${lobby.code}
      `;
      const afterSecondTimeout = await lobbies.findGame(
        lobby.code,
        players[2].id
      );
      expect(afterSecondTimeout?.currentTurnPlayerId).toBe(players[2].id);
      expect(
        Object.keys(
          afterSecondTimeout?.players.find(
            ({ id }) => id === players[1].id
          )?.characteristics ?? {}
        )
      ).toEqual(["profession"]);
    } finally {
      await Promise.allSettled([
        authSessions.close(),
        lobbies.close(),
        directSql.end({ timeout: 5 })
      ]);
    }
  });

  it("lets a player speak immediately when their turn starts with nothing left to reveal", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const directSql = postgres(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "844442", username: "speak_olena" },
      { firstName: "Максим", id: "844452", username: "speak_maksym" },
      { firstName: "Ірина", id: "844462", username: "speak_iryna" },
      { firstName: "Данило", id: "844472", username: "speak_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`speak-init-${user.id}-${suffix}`),
          tokenHash: hash(`speak-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      const forcedDisclosureCard = allPlaytestCards.find(
        ({ id }) => id === "forced-disclosure"
      );
      if (forcedDisclosureCard === undefined) {
        throw new Error("Missing test card: forced-disclosure");
      }
      await directSql`
        UPDATE lobby_players AS player
        SET special_card = ${directSql.json(forcedDisclosureCard)}, card_used = false
        FROM lobbies
        WHERE lobbies.lobby_id = player.lobby_id
          AND lobbies.code = ${lobby.code}
          AND player.telegram_id = ${host.id}
      `;
      await lobbies.useCard(lobby.code, host.id, {
        characteristicId: "profession",
        targetPlayerId: players[1].id
      });
      await directSql`
        UPDATE lobbies
        SET reaction_deadline = now() - interval '1 second'
        WHERE code = ${lobby.code}
      `;

      await lobbies.reveal(lobby.code, host.id, "profession");
      const afterHostSpeaks = await lobbies.finishTurn(
        lobby.code,
        host.id
      );

      expect(afterHostSpeaks.currentTurnPlayerId).toBe(players[1].id);
      expect(afterHostSpeaks.turnStage).toBe("speaking");
      expect(afterHostSpeaks.turnRevealedCharacteristicId).toBeNull();

      const afterSecondSpeaks = await lobbies.finishTurn(
        lobby.code,
        players[1].id
      );
      expect(afterSecondSpeaks.currentTurnPlayerId).toBe(players[2].id);
      expect(
        Object.keys(
          afterSecondSpeaks.players.find(({ id }) => id === players[1].id)
            ?.characteristics ?? {}
        )
      ).toEqual(["profession"]);
    } finally {
      await Promise.allSettled([
        authSessions.close(),
        lobbies.close(),
        directSql.end({ timeout: 5 })
      ]);
    }
  });

  it("does not let a stale bonus vote resurrect a candidate the revote already excluded", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const directSql = postgres(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "845442", username: "bonus_olena" },
      { firstName: "Максим", id: "845452", username: "bonus_maksym" },
      { firstName: "Ірина", id: "845462", username: "bonus_iryna" },
      { firstName: "Данило", id: "845472", username: "bonus_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`bonus-init-${user.id}-${suffix}`),
          tokenHash: hash(`bonus-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      // Host adds a bonus vote against players[3] with a card, well
      // before any voting starts.
      const accusationCard = allPlaytestCards.find(
        ({ id }) => id === "public-accusation"
      );
      if (accusationCard === undefined) {
        throw new Error("Missing test card: public-accusation");
      }
      await directSql`
        UPDATE lobby_players AS player
        SET special_card = ${directSql.json(accusationCard)}, card_used = false
        FROM lobbies
        WHERE lobbies.lobby_id = player.lobby_id
          AND lobbies.code = ${lobby.code}
          AND player.telegram_id = ${host.id}
      `;
      await lobbies.useCard(lobby.code, host.id, {
        targetPlayerId: players[3].id
      });
      await directSql`
        UPDATE lobbies
        SET reaction_deadline = now() - interval '1 second'
        WHERE code = ${lobby.code}
      `;

      for (let round = 0; round < 2; round += 1) {
        for (const player of players) {
          const game = await lobbies.findGame(lobby.code, player.id);
          const hidden = game?.characteristics.find(
            (characteristic) => !characteristic.revealed
          );
          if (hidden === undefined) {
            throw new Error("Expected a hidden characteristic");
          }
          await lobbies.reveal(lobby.code, player.id, hidden.id);
          await lobbies.finishTurn(lobby.code, player.id);
        }
      }
      await lobbies.finishDiscussion(lobby.code, host.id);

      // Attempt 1: host and players[1] each collect 2 real votes;
      // players[3] only has the 1 stale bonus vote, so they are not part
      // of the tie even though they have a nonzero tally.
      await lobbies.vote(lobby.code, host.id, players[1].id, 1);
      await lobbies.vote(lobby.code, players[1].id, host.id, 1);
      await lobbies.vote(lobby.code, players[2].id, host.id, 1);
      const tied = await lobbies.vote(
        lobby.code,
        players[3].id,
        players[1].id,
        1
      );
      expect(tied.voting?.attempt).toBe(2);
      expect(
        [...(tied.voting?.candidatePlayerIds ?? [])].sort()
      ).toEqual([host.id, players[1].id].sort());

      // Attempt 2: only players[2] and players[3] vote, split between the
      // two real candidates. Without the fix, players[3]'s leftover bonus
      // vote would tie all three again and resurrect them as a candidate.
      await lobbies.vote(lobby.code, players[2].id, host.id, 2);
      await lobbies.vote(lobby.code, players[3].id, players[1].id, 2);
      const secondTied = await lobbies.finishVoting(lobby.code, host.id, 2);
      expect(secondTied.voting?.attempt).toBe(3);
      expect(
        [...(secondTied.voting?.candidatePlayerIds ?? [])].sort()
      ).toEqual([host.id, players[1].id].sort());
    } finally {
      await Promise.allSettled([
        authSessions.close(),
        lobbies.close(),
        directSql.end({ timeout: 5 })
      ]);
    }
  });

  it("resolves voting without waiting on an offline silenced player's ballot", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const directSql = postgres(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "846442", username: "silence_olena" },
      { firstName: "Максим", id: "846452", username: "silence_maksym" },
      { firstName: "Ірина", id: "846462", username: "silence_iryna" },
      { firstName: "Данило", id: "846472", username: "silence_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`silence-init-${user.id}-${suffix}`),
          tokenHash: hash(`silence-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      // Host silences players[3] with a card before voting begins.
      const discreditCard = allPlaytestCards.find(
        ({ id }) => id === "discredit"
      );
      if (discreditCard === undefined) {
        throw new Error("Missing test card: discredit");
      }
      await directSql`
        UPDATE lobby_players AS player
        SET special_card = ${directSql.json(discreditCard)}, card_used = false
        FROM lobbies
        WHERE lobbies.lobby_id = player.lobby_id
          AND lobbies.code = ${lobby.code}
          AND player.telegram_id = ${host.id}
      `;
      await lobbies.useCard(lobby.code, host.id, {
        targetPlayerId: players[3].id
      });
      await directSql`
        UPDATE lobbies
        SET reaction_deadline = now() - interval '1 second'
        WHERE code = ${lobby.code}
      `;

      for (let round = 0; round < 2; round += 1) {
        for (const player of players) {
          const game = await lobbies.findGame(lobby.code, player.id);
          const hidden = game?.characteristics.find(
            (characteristic) => !characteristic.revealed
          );
          if (hidden === undefined) {
            throw new Error("Expected a hidden characteristic");
          }
          await lobbies.reveal(lobby.code, player.id, hidden.id);
          await lobbies.finishTurn(lobby.code, player.id);
        }
      }
      await lobbies.finishDiscussion(lobby.code, host.id);

      const silencedView = await lobbies.findGame(lobby.code, players[3].id);
      expect(silencedView?.voting?.silenced).toBe(true);
      expect(silencedView?.voting?.expected).toBe(3);

      // players[3] never votes (offline); the other three active players
      // are the entire expected set and must resolve voting on their own.
      await lobbies.vote(lobby.code, host.id, players[3].id, 1);
      await lobbies.vote(lobby.code, players[1].id, players[3].id, 1);
      const resolved = await lobbies.vote(
        lobby.code,
        players[2].id,
        players[3].id,
        1
      );
      expect(resolved.phase).not.toBe("voting");
      expect(
        resolved.players.find(({ id }) => id === players[3].id)?.status
      ).toBe("eliminated");
    } finally {
      await Promise.allSettled([
        authSessions.close(),
        lobbies.close(),
        directSql.end({ timeout: 5 })
      ]);
    }
  });

  it("lets the host finish voting without an absent player's ballot", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "839442", username: "afk_olena" },
      { firstName: "Максим", id: "839452", username: "afk_maksym" },
      { firstName: "Ірина", id: "839462", username: "afk_iryna" },
      { firstName: "Данило", id: "839472", username: "afk_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`afk-init-${user.id}-${suffix}`),
          tokenHash: hash(`afk-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      for (let round = 0; round < 2; round += 1) {
        for (const player of players) {
          const game = await lobbies.findGame(lobby.code, player.id);
          const hidden = game?.characteristics.find(
            (characteristic) => !characteristic.revealed
          );
          if (hidden === undefined) {
            throw new Error("Expected a hidden characteristic");
          }
          await lobbies.reveal(lobby.code, player.id, hidden.id);
          await lobbies.finishTurn(lobby.code, player.id);
        }
      }
      await lobbies.finishDiscussion(lobby.code, host.id);

      await expect(
        lobbies.finishVoting(lobby.code, players[1].id, 1)
      ).rejects.toMatchObject({ code: "ONLY_HOST_CAN_FINISH_VOTING" });

      await lobbies.vote(lobby.code, host.id, players[2].id, 1);
      await lobbies.vote(lobby.code, players[1].id, players[3].id, 1);
      const afterTiedFinish = await lobbies.finishVoting(
        lobby.code,
        host.id,
        1
      );
      expect(afterTiedFinish.phase).toBe("voting");
      expect(afterTiedFinish.voting?.attempt).toBe(2);

      await lobbies.vote(lobby.code, host.id, players[2].id, 2);
      const afterRevoteFinish = await lobbies.finishVoting(
        lobby.code,
        host.id,
        2
      );
      expect(
        afterRevoteFinish.players.find(({ id }) => id === players[2].id)
          ?.status
      ).toBe("eliminated");
      expect(afterRevoteFinish.phase).toBe("revealing");
      expect(afterRevoteFinish.round).toBe(3);

      await expect(
        lobbies.finishVoting(lobby.code, host.id, 2)
      ).rejects.toMatchObject({ code: "GAME_NOT_IN_VOTING" });
    } finally {
      await Promise.all([authSessions.close(), lobbies.close()]);
    }
  });

  it("rejects a delayed vote or finish from a superseded voting attempt", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "843442", username: "stale_vote_olena" },
      { firstName: "Максим", id: "843452", username: "stale_vote_maksym" },
      { firstName: "Ірина", id: "843462", username: "stale_vote_iryna" },
      { firstName: "Данило", id: "843472", username: "stale_vote_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`stale-vote-init-${user.id}-${suffix}`),
          tokenHash: hash(`stale-vote-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      for (let round = 0; round < 2; round += 1) {
        for (const player of players) {
          const game = await lobbies.findGame(lobby.code, player.id);
          const hidden = game?.characteristics.find(
            (characteristic) => !characteristic.revealed
          );
          if (hidden === undefined) {
            throw new Error("Expected a hidden characteristic");
          }
          await lobbies.reveal(lobby.code, player.id, hidden.id);
          await lobbies.finishTurn(lobby.code, player.id);
        }
      }
      await lobbies.finishDiscussion(lobby.code, host.id);

      await lobbies.vote(lobby.code, host.id, players[2].id, 1);
      await lobbies.vote(lobby.code, players[1].id, players[3].id, 1);
      const afterTiedFinish = await lobbies.finishVoting(
        lobby.code,
        host.id,
        1
      );
      expect(afterTiedFinish.voting?.attempt).toBe(2);

      await expect(
        lobbies.vote(lobby.code, players[1].id, players[3].id, 1)
      ).rejects.toMatchObject({ code: "VOTING_ATTEMPT_CHANGED" });
      const afterStaleVote = await lobbies.findGame(lobby.code, host.id);
      expect(afterStaleVote?.voting).toMatchObject({
        attempt: 2,
        submitted: 0
      });

      await expect(
        lobbies.finishVoting(lobby.code, host.id, 1)
      ).rejects.toMatchObject({ code: "VOTING_ATTEMPT_CHANGED" });
      const afterStaleFinish = await lobbies.findGame(lobby.code, host.id);
      expect(afterStaleFinish?.phase).toBe("voting");
      expect(afterStaleFinish?.voting?.attempt).toBe(2);
    } finally {
      await Promise.all([authSessions.close(), lobbies.close()]);
    }
  });

  it("rejects an unsanctioned target on a self-only card", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const directSql = postgres(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "838242", username: "self_olena" },
      { firstName: "Максим", id: "838252", username: "self_maksym" },
      { firstName: "Ірина", id: "838262", username: "self_iryna" },
      { firstName: "Данило", id: "838272", username: "self_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`self-init-${user.id}-${suffix}`),
          tokenHash: hash(`self-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      const openFileCard = allPlaytestCards.find(
        ({ id }) => id === "open-file"
      );
      if (openFileCard === undefined) {
        throw new Error("Missing test card: open-file");
      }
      await directSql`
        UPDATE lobby_players AS player
        SET special_card = ${directSql.json(openFileCard)}, card_used = false
        FROM lobbies
        WHERE lobbies.lobby_id = player.lobby_id
          AND lobbies.code = ${lobby.code}
          AND player.telegram_id = ${host.id}
      `;

      const beforeAttack = await lobbies.findGame(lobby.code, players[1].id);
      const targetRevealedBefore = beforeAttack?.players.find(
        ({ id }) => id === players[1].id
      )?.characteristics.profession;

      await expect(
        lobbies.useCard(lobby.code, host.id, {
          characteristicId: "profession",
          targetPlayerId: players[1].id
        })
      ).rejects.toMatchObject({ code: "INVALID_CARD_SELECTION" });

      const afterAttack = await lobbies.findGame(lobby.code, players[1].id);
      expect(
        afterAttack?.players.find(({ id }) => id === players[1].id)
          ?.characteristics.profession
      ).toBe(targetRevealedBefore);
    } finally {
      await Promise.allSettled([
        authSessions.close(),
        lobbies.close(),
        directSql.end({ timeout: 5 })
      ]);
    }
  });

  it("rolls back to a host checkpoint through a majority vote", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }

    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "824242", username: "rollback_olena" },
      { firstName: "Максим", id: "825252", username: "rollback_maksym" },
      { firstName: "Ірина", id: "826262", username: "rollback_iryna" },
      { firstName: "Данило", id: "827272", username: "rollback_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`rollback-init-${user.id}-${suffix}`),
          tokenHash: hash(`rollback-token-${user.id}-${suffix}`),
          user
        });
      }

      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      const beforeReveal = await lobbies.findGame(lobby.code, host.id);
      const originalProfession = beforeReveal?.characteristics.find(
        (characteristic) => characteristic.id === "profession"
      )?.value;
      const afterReveal = await lobbies.reveal(
        lobby.code,
        host.id,
        "profession"
      );
      const checkpoint = afterReveal.rollback.checkpoints.find(
        (entry) => entry.label === "Перед відкриттям «Професія»"
      );
      expect(checkpoint).toBeDefined();
      expect(
        (await lobbies.findGame(lobby.code, players[1].id))?.rollback
          .checkpoints
      ).toEqual([]);

      const proposed = await lobbies.proposeRollback(
        lobby.code,
        host.id,
        checkpoint?.id ?? "missing",
        "Перевіряємо помилкове відкриття"
      );
      expect(proposed.rollback).toMatchObject({
        paused: true,
        proposal: {
          approvals: 1,
          hasVoted: true,
          requiredApprovals: 3
        }
      });
      const publicPaused = await lobbies.findPublicGame(lobby.code);
      expect(publicPaused).toMatchObject({
        activeDeadline: null,
        rollbackPaused: true
      });
      await expect(
        lobbies.finishTurn(lobby.code, host.id)
      ).rejects.toMatchObject({ code: "GAME_PAUSED_FOR_ROLLBACK" });

      const proposalId = proposed.rollback.proposal?.id ?? "missing";
      const rejectedVote = await lobbies.voteRollback(
        lobby.code,
        players[1].id,
        false,
        proposalId
      );
      expect(rejectedVote.rollback.proposal).toMatchObject({
        approvals: 1,
        rejections: 1
      });
      await lobbies.voteRollback(lobby.code, players[2].id, true, proposalId);
      const restored = await lobbies.voteRollback(
        lobby.code,
        players[3].id,
        true,
        proposalId
      );
      expect(restored).toMatchObject({
        phase: "revealing",
        rollback: {
          paused: true,
          proposal: null
        },
        turnRevealedCharacteristicId: null,
        turnStage: "choosing"
      });
      expect(restored.rollback.activeBranchId).not.toBe(
        afterReveal.rollback.activeBranchId
      );
      expect(
        restored.characteristics.find(
          (characteristic) => characteristic.id === "profession"
        )?.revealed
      ).toBe(false);
      expect(restored.turnDeadline).toBeNull();

      const resumed = await lobbies.resumeRollback(lobby.code, host.id);
      expect(resumed.rollback.paused).toBe(false);
      expect(resumed.turnDeadline).not.toBeNull();
      const publicResumed = await lobbies.findPublicGame(lobby.code);
      expect(publicResumed?.rollbackPaused).toBe(false);
      expect(publicResumed?.activeDeadline).not.toBeNull();

      const regenerated = await lobbies.reveal(
        lobby.code,
        host.id,
        "profession"
      );
      expect(
        regenerated.characteristics.find(
          (characteristic) => characteristic.id === "profession"
        )?.value
      ).not.toBe(originalProfession);
      expect(regenerated.lastEvent).toContain("перегенеровано після rollback");
      const professionsAfterRollback = await Promise.all(
        players.map(async (player) =>
          (
            await lobbies.findGame(lobby.code, player.id)
          )?.characteristics.find(
            (characteristic) => characteristic.id === "profession"
          )?.value
        )
      );
      expect(new Set(professionsAfterRollback).size).toBe(players.length);

      const directSql = postgres(databaseUrl);
      try {
        const branches = await directSql<
          { readonly active: boolean; readonly branch_id: string }[]
        >`
          SELECT
            branch_id::text,
            branch_id = (
              SELECT active_branch_id
              FROM lobbies
              WHERE code = ${lobby.code}
            ) AS active
          FROM game_branches
          WHERE lobby_id = (
            SELECT lobby_id
            FROM lobbies
            WHERE code = ${lobby.code}
          )
          ORDER BY created_at
        `;
        expect(branches).toHaveLength(2);
        expect(branches.filter((branch) => branch.active)).toHaveLength(1);

        const checksums = await directSql<
          { readonly checksum: string }[]
        >`
          SELECT checksum
          FROM game_checkpoints
          WHERE lobby_id = (
            SELECT lobby_id
            FROM lobbies
            WHERE code = ${lobby.code}
          )
        `;
        expect(checksums.length).toBeGreaterThan(2);
        expect(
          checksums.every((entry) => /^[0-9a-f]{64}$/u.test(entry.checksum))
        ).toBe(true);
      } finally {
        await directSql.end({ timeout: 5 });
      }
    } finally {
      await Promise.all([authSessions.close(), lobbies.close()]);
    }
  });

  it("rejects a stale vote or cancel against a superseded rollback proposal", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "842242", username: "stale_olena" },
      { firstName: "Максим", id: "842252", username: "stale_maksym" },
      { firstName: "Ірина", id: "842262", username: "stale_iryna" },
      { firstName: "Данило", id: "842272", username: "stale_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`stale-init-${user.id}-${suffix}`),
          tokenHash: hash(`stale-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      const afterReveal = await lobbies.reveal(
        lobby.code,
        host.id,
        "profession"
      );
      const checkpoint = afterReveal.rollback.checkpoints.find(
        (entry) => entry.label === "Перед відкриттям «Професія»"
      );
      expect(checkpoint).toBeDefined();

      const proposalA = await lobbies.proposeRollback(
        lobby.code,
        host.id,
        checkpoint?.id ?? "missing",
        "Пропозиція A"
      );
      const proposalIdA = proposalA.rollback.proposal?.id ?? "missing";

      await lobbies.cancelRollback(lobby.code, host.id, proposalIdA);
      const proposalB = await lobbies.proposeRollback(
        lobby.code,
        host.id,
        checkpoint?.id ?? "missing",
        "Пропозиція B"
      );
      const proposalIdB = proposalB.rollback.proposal?.id ?? "missing";
      expect(proposalIdB).not.toBe(proposalIdA);

      await expect(
        lobbies.voteRollback(lobby.code, players[1].id, true, proposalIdA)
      ).rejects.toMatchObject({ code: "ROLLBACK_NOT_PENDING" });

      const stillPending = await lobbies.findGame(lobby.code, players[1].id);
      expect(stillPending?.rollback.proposal).toMatchObject({
        approvals: 1,
        id: proposalIdB,
        reason: "Пропозиція B"
      });

      await expect(
        lobbies.cancelRollback(lobby.code, host.id, proposalIdA)
      ).rejects.toMatchObject({ code: "ROLLBACK_NOT_PENDING" });

      const stillUncancelled = await lobbies.findGame(
        lobby.code,
        players[1].id
      );
      expect(stillUncancelled?.rollback.proposal?.id).toBe(proposalIdB);
    } finally {
      await Promise.all([authSessions.close(), lobbies.close()]);
    }
  });

  it("keeps a value invalidated after reveal, hide, then rollback", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const directSql = postgres(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "839542", username: "hide_olena" },
      { firstName: "Максим", id: "839552", username: "hide_maksym" },
      { firstName: "Ірина", id: "839562", username: "hide_iryna" },
      { firstName: "Данило", id: "839572", username: "hide_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`hide-init-${user.id}-${suffix}`),
          tokenHash: hash(`hide-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      for (const player of players) {
        await lobbies.reveal(lobby.code, player.id, "profession");
        await lobbies.finishTurn(lobby.code, player.id);
      }
      const round2Host = await lobbies.findGame(lobby.code, host.id);
      const hostHiddenCharacteristic = round2Host?.characteristics.find(
        (characteristic) => !characteristic.revealed
      );
      if (hostHiddenCharacteristic === undefined) {
        throw new Error("Expected the host to have a hidden characteristic");
      }
      await lobbies.reveal(lobby.code, host.id, hostHiddenCharacteristic.id);
      await lobbies.finishTurn(lobby.code, host.id);

      const beforeHide = await lobbies.findGame(lobby.code, host.id);
      expect(beforeHide?.currentTurnPlayerId).toBe(players[1].id);

      const revealed = await lobbies.reveal(lobby.code, players[1].id, "health");
      const originalValue = revealed.players.find(
        ({ id }) => id === players[1].id
      )?.characteristics.health;
      expect(originalValue).toBeDefined();
      const hostViewAfterReveal = await lobbies.findGame(lobby.code, host.id);
      const checkpoint = hostViewAfterReveal?.rollback.checkpoints.find(
        (entry) => entry.label === "Перед відкриттям «Здоров’я»"
      );
      expect(checkpoint).toBeDefined();

      const sealedFileCard = allPlaytestCards.find(
        ({ id }) => id === "sealed-file"
      );
      if (sealedFileCard === undefined) {
        throw new Error("Missing test card: sealed-file");
      }
      await directSql`
        UPDATE lobby_players AS player
        SET special_card = ${directSql.json(sealedFileCard)}, card_used = false
        FROM lobbies
        WHERE lobbies.lobby_id = player.lobby_id
          AND lobbies.code = ${lobby.code}
          AND player.telegram_id = ${players[1].id}
      `;
      await lobbies.useCard(lobby.code, players[1].id, {
        characteristicId: "health"
      });
      await directSql`
        UPDATE lobbies
        SET reaction_deadline = now() - interval '1 second'
        WHERE code = ${lobby.code}
      `;
      const afterHide = await lobbies.findGame(lobby.code, host.id);
      expect(
        afterHide?.players.find(({ id }) => id === players[1].id)
          ?.characteristics.health
      ).toBeUndefined();

      const rollbackProposal = await lobbies.proposeRollback(
        lobby.code,
        host.id,
        checkpoint?.id ?? "missing",
        "Перевіряємо reveal -> hide -> rollback"
      );
      const proposalId = rollbackProposal.rollback.proposal?.id ?? "missing";
      await lobbies.voteRollback(lobby.code, players[2].id, true, proposalId);
      const restored = await lobbies.voteRollback(
        lobby.code,
        players[3].id,
        true,
        proposalId
      );
      expect(restored.rollback.proposal).toBeNull();
      expect(
        restored.characteristics.find(
          (characteristic) => characteristic.id === "health"
        )?.revealed
      ).toBe(false);
      await lobbies.resumeRollback(lobby.code, host.id);

      const revealedAgain = await lobbies.reveal(
        lobby.code,
        players[1].id,
        "health"
      );
      const newValue = revealedAgain.players.find(
        ({ id }) => id === players[1].id
      )?.characteristics.health;
      expect(newValue).toBeDefined();
      expect(newValue).not.toBe(originalValue);
    } finally {
      await Promise.allSettled([
        authSessions.close(),
        lobbies.close(),
        directSql.end({ timeout: 5 })
      ]);
    }
  });

  it("repeats the same reroll result after a rollback instead of re-rolling", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const directSql = postgres(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "839642", username: "reroll_olena" },
      { firstName: "Максим", id: "839652", username: "reroll_maksym" },
      { firstName: "Ірина", id: "839662", username: "reroll_iryna" },
      { firstName: "Данило", id: "839672", username: "reroll_danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`reroll-init-${user.id}-${suffix}`),
          tokenHash: hash(`reroll-token-${user.id}-${suffix}`),
          user
        });
      }
      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      for (const player of players) {
        await lobbies.reveal(lobby.code, player.id, "profession");
        await lobbies.finishTurn(lobby.code, player.id);
      }

      const newFileCard = allPlaytestCards.find(
        ({ id }) => id === "new-file"
      );
      if (newFileCard === undefined) {
        throw new Error("Missing test card: new-file");
      }
      await directSql`
        UPDATE lobby_players AS player
        SET special_card = ${directSql.json(newFileCard)}, card_used = false
        FROM lobbies
        WHERE lobbies.lobby_id = player.lobby_id
          AND lobbies.code = ${lobby.code}
          AND player.telegram_id = ${host.id}
      `;
      await lobbies.useCard(lobby.code, host.id, {
        characteristicId: "health"
      });
      await directSql`
        UPDATE lobbies
        SET reaction_deadline = now() - interval '1 second'
        WHERE code = ${lobby.code}
      `;
      const afterFirstReroll = await lobbies.findGame(lobby.code, host.id);
      const firstValue = afterFirstReroll?.characteristics.find(
        (characteristic) => characteristic.id === "health"
      )?.value;
      expect(firstValue).toBeDefined();
      const checkpoint = afterFirstReroll?.rollback.checkpoints.find(
        (entry) => entry.label === `Перед карткою «${newFileCard.title}»`
      );
      expect(checkpoint).toBeDefined();

      const rerollProposal = await lobbies.proposeRollback(
        lobby.code,
        host.id,
        checkpoint?.id ?? "missing",
        "Перевіряємо reroll -> rollback -> repeat"
      );
      const rerollProposalId =
        rerollProposal.rollback.proposal?.id ?? "missing";
      await lobbies.voteRollback(
        lobby.code,
        players[2].id,
        true,
        rerollProposalId
      );
      await lobbies.voteRollback(
        lobby.code,
        players[3].id,
        true,
        rerollProposalId
      );
      await lobbies.resumeRollback(lobby.code, host.id);

      const afterRestore = await lobbies.findGame(lobby.code, host.id);
      expect(afterRestore?.card.used).toBe(false);

      await lobbies.useCard(lobby.code, host.id, {
        characteristicId: "health"
      });
      await directSql`
        UPDATE lobbies
        SET reaction_deadline = now() - interval '1 second'
        WHERE code = ${lobby.code}
      `;
      const afterSecondReroll = await lobbies.findGame(lobby.code, host.id);
      const secondValue = afterSecondReroll?.characteristics.find(
        (characteristic) => characteristic.id === "health"
      )?.value;
      expect(secondValue).toBe(firstValue);
    } finally {
      await Promise.allSettled([
        authSessions.close(),
        lobbies.close(),
        directSql.end({ timeout: 5 })
      ]);
    }
  });

  it("plays a four-player game from a private lobby to the host verdict", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }

    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const suffix = randomUUID();
    const players = [
      { firstName: "Олена", id: "424242", username: "olena" },
      { firstName: "Максим", id: "525252", username: "maksym" },
      { firstName: "Ірина", id: "626262", username: "iryna" },
      { firstName: "Данило", id: "727272", username: "danylo" }
    ] as const;
    const host = players[0];

    try {
      for (const user of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`init-${user.id}-${suffix}`),
          tokenHash: hash(`token-${user.id}-${suffix}`),
          user
        });
      }

      const created = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(created.code, player.id);
      }
      const joined = await lobbies.findForPlayer(created.code, host.id);
      expect(joined?.players.map((player) => player.id)).toEqual(
        players.map((player) => player.id)
      );
      await expect(
        lobbies.start(created.code, host.id)
      ).rejects.toMatchObject({
        code: "PLAYERS_NOT_READY"
      });
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(created.code, player.id, true)
        )
      );
      await expect(
        lobbies.start(created.code, players[1].id)
      ).rejects.toMatchObject({
        code: "ONLY_HOST_CAN_START"
      });
      await expect(
        lobbies.start(created.code, host.id)
      ).resolves.toMatchObject({
        status: "started"
      });

      const introView = await lobbies.findGame(created.code, host.id);
      expect(introView).toMatchObject({
        bunkerCapacity: 2,
        currentTurnPlayerId: null,
        phase: "scenario_intro",
        round: 1
      });
      expect(introView?.scenario.bunker.rooms.length).toBeGreaterThan(4);
      expect(introView?.scenario.resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "energy", value: 6 }),
          expect.objectContaining({ id: "lab-data", value: 1 })
        ])
      );
      expect(introView?.card.used).toBe(false);
      await expect(
        lobbies.begin(created.code, players[1].id)
      ).rejects.toMatchObject({
        code: "ONLY_HOST_CAN_BEGIN"
      });
      const firstView = await lobbies.begin(created.code, host.id);
      expect(firstView).toMatchObject({
        currentTurnPlayerId: host.id,
        phase: "revealing",
        round: 1,
        turnStage: "choosing"
      });
      expect(firstView.turnDeadline).not.toBeNull();
      expect(
        firstView?.characteristics.every(
          (characteristic) => !characteristic.revealed
        )
      ).toBe(true);
      expect(
        firstView?.players.every(
          (player) => Object.keys(player.characteristics).length === 0
        )
      ).toBe(true);
      expect(
        (await lobbies.findGame(created.code, host.id))?.characteristics
      ).toEqual(firstView?.characteristics);
      await expect(
        lobbies.reveal(
          created.code,
          players[1].id,
          "profession"
        )
      ).rejects.toMatchObject({
        code: "NOT_YOUR_TURN"
      });

      const views = await Promise.all(
        players.map((player) =>
          lobbies.findGame(created.code, player.id)
        )
      );
      for (const category of CHARACTERISTIC_CATEGORIES) {
        const values = views.map(
          (view) =>
            view?.characteristics.find(
              (characteristic) => characteristic.id === category.id
            )?.value
        );
        expect(new Set(values).size).toBe(players.length);
      }
      const actionIndex = views.findIndex(
        (view) =>
          view?.card.kind === "action" &&
          (view.card.selection?.length ?? 0) === 0
      );
      const reactionIndex = views.findIndex(
        (view) =>
          view?.card.kind === "reaction" &&
          view.card.effectId !== "player.protect" &&
          (view.card.selection?.length ?? 0) === 0
      );
      expect(actionIndex).toBeGreaterThanOrEqual(0);
      expect(reactionIndex).toBeGreaterThanOrEqual(0);
      for (const player of players.slice(0, actionIndex)) {
        const speaking = await lobbies.reveal(
          created.code,
          player.id,
          "profession"
        );
        expect(speaking).toMatchObject({
          currentTurnPlayerId: player.id,
          turnRevealedCharacteristicId: "profession",
          turnStage: "speaking"
        });
        await lobbies.finishTurn(created.code, player.id);
      }
      const actionPlayer = players[actionIndex];
      const reactionPlayer = players[reactionIndex];
      if (actionPlayer === undefined || reactionPlayer === undefined) {
        throw new Error("Expected action and reaction card holders");
      }
      const reactionWindow = await lobbies.useCard(
        created.code,
        actionPlayer.id,
        {}
      );
      expect(reactionWindow).toMatchObject({
        cardChain: {
          actorPlayerId: actionPlayer.id,
          reactions: []
        },
        phase: "reaction"
      });
      await expect(
        lobbies.reactCard(created.code, actionPlayer.id, {}, 0)
      ).rejects.toMatchObject({
        code: "CARD_NOT_AVAILABLE"
      });
      const reacted = await lobbies.reactCard(
        created.code,
        reactionPlayer.id,
        {},
        0
      );
      expect(reacted.cardChain?.reactions).toHaveLength(1);
      const directSql = postgres(databaseUrl);
      try {
        await directSql`
          UPDATE lobbies
          SET reaction_deadline = now() - interval '1 second'
          WHERE code = ${created.code}
        `;
      } finally {
        await directSql.end({ timeout: 5 });
      }
      const resolvedReaction = await lobbies.findGame(
        created.code,
        actionPlayer.id
      );
      expect(resolvedReaction).toMatchObject({
        phase: "revealing"
      });
      expect(resolvedReaction?.lastEvent).toContain(
        reactionWindow.cardChain?.action.title ?? "missing action"
      );

      for (const player of players.slice(actionIndex)) {
        const beforeReveal = await lobbies.findGame(created.code, player.id);
        const afterReveal = await lobbies.reveal(
          created.code,
          player.id,
          "profession"
        );
        expect(afterReveal.turnDeadline).toBe(beforeReveal?.turnDeadline);
        await lobbies.finishTurn(created.code, player.id);
      }
      expect(await lobbies.findGame(created.code, host.id)).toMatchObject({
        currentTurnPlayerId: host.id,
        phase: "revealing",
        round: 2,
        turnStage: "choosing"
      });

      const directTimerSql = postgres(databaseUrl);
      try {
        await directTimerSql`
          UPDATE lobbies
          SET turn_deadline = now() - interval '1 second'
          WHERE code = ${created.code}
        `;
      } finally {
        await directTimerSql.end({ timeout: 5 });
      }
      const afterTimeout = await lobbies.findGame(created.code, host.id);
      expect(afterTimeout).toMatchObject({
        currentTurnPlayerId: players[1].id,
        phase: "revealing",
        round: 2
      });
      expect(afterTimeout?.lastEvent).toContain("виступ пропущено");
      expect(
        afterTimeout?.players.find((player) => player.id === host.id)
          ?.characteristics
      ).toHaveProperty(
        afterTimeout?.characteristics.find(
          (characteristic) =>
            characteristic.revealed &&
            characteristic.id !== "profession"
        )?.id ?? "missing"
      );

      const revealRound = async (finishDiscussionEarly = true) => {
        for (const player of players) {
          const game = await lobbies.findGame(created.code, player.id);
          if (
            game?.players.find((entry) => entry.id === player.id)?.status ===
            "active"
          ) {
            expect(game.currentTurnPlayerId).toBe(player.id);
            const hidden = game.characteristics.find(
              (characteristic) => !characteristic.revealed
            );
            if (hidden === undefined) {
              throw new Error("Expected a hidden characteristic");
            }
            await lobbies.reveal(
              created.code,
              player.id,
              hidden.id
            );
            await lobbies.finishTurn(created.code, player.id);
          }
        }
        if (finishDiscussionEarly) {
          await lobbies.finishDiscussion(created.code, host.id);
        }
      };

      for (const player of players.slice(1)) {
        const game = await lobbies.findGame(created.code, player.id);
        const hidden = game?.characteristics.find(
          (characteristic) => !characteristic.revealed
        );
        if (hidden === undefined) {
          throw new Error("Expected a hidden characteristic");
        }
        await lobbies.reveal(created.code, player.id, hidden.id);
        await lobbies.finishTurn(created.code, player.id);
      }
      expect(await lobbies.findGame(created.code, host.id)).toMatchObject({
        currentTurnPlayerId: null,
        phase: "discussion",
        turnStage: null,
        voting: null
      });
      await expect(
        lobbies.finishDiscussion(created.code, players[1].id)
      ).rejects.toMatchObject({
        code: "ONLY_HOST_CAN_END_DISCUSSION"
      });
      expect(
        await lobbies.finishDiscussion(created.code, host.id)
      ).toMatchObject({
        phase: "voting",
        voting: {
          expected: 4,
          submitted: 0
        }
      });

      await expect(
        lobbies.vote(created.code, host.id, host.id, 1)
      ).rejects.toMatchObject({
        code: "INVALID_VOTE_TARGET"
      });
      await lobbies.vote(created.code, host.id, players[3].id, 1);
      await expect(
        lobbies.vote(created.code, host.id, players[2].id, 1)
      ).rejects.toMatchObject({
        code: "ALREADY_VOTED"
      });
      await lobbies.vote(created.code, players[1].id, players[3].id, 1);
      await lobbies.vote(created.code, players[2].id, host.id, 1);
      const tiedVote = await lobbies.vote(
        created.code,
        players[3].id,
        host.id,
        1
      );
      expect(tiedVote).toMatchObject({
        phase: "voting",
        voting: {
          attempt: 2,
          submitted: 0
        }
      });
      expect(tiedVote.voting?.candidatePlayerIds).toEqual([
        host.id,
        players[3].id
      ]);
      await lobbies.vote(created.code, host.id, players[3].id, 2);
      await lobbies.vote(created.code, players[1].id, players[3].id, 2);
      await lobbies.vote(created.code, players[2].id, players[3].id, 2);
      await lobbies.vote(created.code, players[3].id, host.id, 2);
      expect(await lobbies.findGame(created.code, host.id)).toMatchObject({
        currentTurnPlayerId: host.id,
        phase: "revealing",
        players: [
          { id: host.id, status: "active" },
          { id: players[1].id, status: "active" },
          { id: players[2].id, status: "active" },
          { id: players[3].id, status: "eliminated" }
        ],
        round: 3
      });

      await revealRound(false);
      const discussionTimerSql = postgres(databaseUrl);
      try {
        await discussionTimerSql`
          UPDATE lobbies
          SET turn_deadline = now() - interval '1 second'
          WHERE code = ${created.code}
        `;
      } finally {
        await discussionTimerSql.end({ timeout: 5 });
      }
      expect(await lobbies.findGame(created.code, host.id)).toMatchObject({
        phase: "voting"
      });
      await lobbies.vote(created.code, host.id, players[2].id, 1);
      await lobbies.vote(created.code, players[1].id, players[2].id, 1);
      const finalCheck = await lobbies.vote(
        created.code,
        players[2].id,
        host.id,
        1
      );
      expect(finalCheck).toMatchObject({
        finalOutcome: null,
        phase: "final_check"
      });
      expect(
        finalCheck.players
          .filter((player) => player.status === "active")
          .map((player) => player.id)
      ).toEqual([host.id, players[1].id]);

      const demographySql = postgres(databaseUrl);
      try {
        await demographySql`
          UPDATE lobby_players
          SET character_profile = jsonb_set(
            jsonb_set(
              jsonb_set(
                character_profile,
                '{age-gender}',
                to_jsonb('Жінка, 58 років'::text),
                true
              ),
              '{special-condition}',
              to_jsonb('Знає пароль від Wi-Fi, якого не існує'::text),
              true
            ),
            '{baggage}',
            to_jsonb('Подушка'::text),
            true
          )
          WHERE lobby_id = (
            SELECT lobby_id FROM lobbies WHERE code = ${created.code}
          )
            AND game_status = 'active'
        `;
        expect(
          await lobbies.findGame(created.code, host.id)
        ).toMatchObject({
          demography: {
            eligibleMen: 0,
            eligibleWomen: 0,
            preserved: false
          }
        });
        await expect(
          lobbies.submitFinalOutcome(
            created.code,
            host.id,
            "all_survive"
          )
        ).rejects.toMatchObject({
          code: "DEMOGRAPHY_NOT_PRESERVED"
        });

        await demographySql`
          UPDATE lobby_players
          SET character_profile = jsonb_set(
            character_profile,
            '{age-gender}',
            to_jsonb(
              CASE
                WHEN telegram_id = ${host.id} THEN 'Жінка, 27 років'
                ELSE 'Чоловік, 31 рік'
              END::text
            ),
            true
          )
          WHERE lobby_id = (
            SELECT lobby_id FROM lobbies WHERE code = ${created.code}
          )
            AND game_status = 'active'
        `;
      } finally {
        await demographySql.end({ timeout: 5 });
      }
      expect(await lobbies.findGame(created.code, host.id)).toMatchObject({
        demography: {
          eligibleMen: 1,
          eligibleWomen: 1,
          preserved: true
        }
      });

      const fertilityAssistSql = postgres(databaseUrl);
      try {
        await fertilityAssistSql`
          UPDATE lobby_players
          SET character_profile = jsonb_set(
            character_profile,
            '{age-gender}',
            to_jsonb('Жінка, 58 років'::text),
            true
          )
          WHERE lobby_id = (
            SELECT lobby_id FROM lobbies WHERE code = ${created.code}
          )
            AND game_status = 'active'
        `;
        expect(
          await lobbies.findGame(created.code, host.id)
        ).toMatchObject({
          demography: { preserved: false }
        });

        await fertilityAssistSql`
          UPDATE lobby_players
          SET character_profile = jsonb_set(
            character_profile,
            '{special-condition}',
            to_jsonb(${FERTILITY_CAPABLE_SPECIAL_CONDITION}::text),
            true
          )
          WHERE lobby_id = (
            SELECT lobby_id FROM lobbies WHERE code = ${created.code}
          )
            AND telegram_id = ${host.id}::bigint
        `;
        expect(
          await lobbies.findGame(created.code, host.id)
        ).toMatchObject({
          demography: { preserved: false }
        });

        await fertilityAssistSql`
          UPDATE lobby_players
          SET character_profile = jsonb_set(
            character_profile,
            '{baggage}',
            to_jsonb(${INSEMINATION_KIT_BAGGAGE}::text),
            true
          )
          WHERE lobby_id = (
            SELECT lobby_id FROM lobbies WHERE code = ${created.code}
          )
            AND telegram_id = ${players[1].id}::bigint
        `;
        expect(
          await lobbies.findGame(created.code, host.id)
        ).toMatchObject({
          demography: { preserved: true }
        });

        await fertilityAssistSql`
          UPDATE lobby_players
          SET character_profile = jsonb_set(
            character_profile,
            '{age-gender}',
            to_jsonb(
              CASE
                WHEN telegram_id = ${host.id}::bigint THEN 'Жінка, 27 років'
                ELSE 'Чоловік, 31 рік'
              END::text
            ),
            true
          )
          WHERE lobby_id = (
            SELECT lobby_id FROM lobbies WHERE code = ${created.code}
          )
            AND game_status = 'active'
        `;
      } finally {
        await fertilityAssistSql.end({ timeout: 5 });
      }
      expect(await lobbies.findGame(created.code, host.id)).toMatchObject({
        demography: {
          eligibleMen: 1,
          eligibleWomen: 1,
          preserved: true
        }
      });

      await expect(
        lobbies.submitFinalOutcome(
          created.code,
          players[1].id,
          "all_survive"
        )
      ).rejects.toMatchObject({
        code: "ONLY_HOST_CAN_FINALIZE"
      });
      await expect(
        lobbies.submitFinalOutcome(
          created.code,
          host.id,
          "team_loss"
        )
      ).resolves.toMatchObject({
        finalOutcome: "team_loss",
        phase: "completed"
      });

      await expect(
        lobbies.leave(created.code, players[1].id)
      ).resolves.toEqual({ cancelled: false });
      await expect(lobbies.findCurrent(players[1].id)).resolves.toBeNull();

      await expect(lobbies.leave(created.code, host.id)).resolves.toEqual({
        cancelled: true
      });
      await expect(lobbies.findCurrent(host.id)).resolves.toBeNull();
    } finally {
      await Promise.all([authSessions.close(), lobbies.close()]);
    }
  });

  it("sweeps waiting lobbies abandoned for more than six hours", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }

    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const suffix = randomUUID();
    const staleHost = {
      firstName: "Стейл",
      id: String(950_001),
      username: "stale_host"
    };
    const freshHost = {
      firstName: "Фреш",
      id: String(950_002),
      username: "fresh_host"
    };

    try {
      for (const user of [staleHost, freshHost]) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`sweep-init-${user.id}-${suffix}`),
          tokenHash: hash(`sweep-token-${user.id}-${suffix}`),
          user
        });
      }

      const staleLobby = await lobbies.create(staleHost.id);
      const freshLobby = await lobbies.create(freshHost.id);

      const directSweepSql = postgres(databaseUrl);
      try {
        await directSweepSql`
          UPDATE lobbies
          SET created_at = now() - interval '7 hours'
          WHERE code = ${staleLobby.code}
        `;
      } finally {
        await directSweepSql.end({ timeout: 5 });
      }

      await expect(lobbies.sweepStaleWaitingLobbies()).resolves.toBe(1);
      await expect(lobbies.findCurrent(staleHost.id)).resolves.toBeNull();
      await expect(
        lobbies.findCurrent(freshHost.id)
      ).resolves.toMatchObject({
        code: freshLobby.code
      });

      await lobbies.leave(freshLobby.code, freshHost.id);
    } finally {
      await Promise.all([authSessions.close(), lobbies.close()]);
    }
  });

  it("restores a checkpoint even when position 10 is already occupied", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }

    const authSessions = await openPostgresAuthSessionStore(databaseUrl);
    const lobbies = await openPostgresLobbyStore(databaseUrl);
    const suffix = randomUUID();
    const players = Array.from({ length: 10 }, (_, index) => ({
      firstName: `Гравець ${index + 1}`,
      id: String(960_000 + index),
      username: `position10_${index + 1}`
    }));
    const host = players[0];
    if (host === undefined) {
      throw new Error("Expected a position-10 rollback host");
    }

    try {
      for (const player of players) {
        await authSessions.create({
          expiresAt: new Date(Date.now() + 90_000),
          initDataHash: hash(`position10-init-${player.id}-${suffix}`),
          tokenHash: hash(`position10-token-${player.id}-${suffix}`),
          user: player
        });
      }

      const lobby = await lobbies.create(host.id);
      for (const player of players.slice(1)) {
        await lobbies.join(lobby.code, player.id);
      }
      await Promise.all(
        players.map((player) =>
          lobbies.setReady(lobby.code, player.id, true)
        )
      );
      await lobbies.start(lobby.code, host.id);
      await lobbies.begin(lobby.code, host.id);

      const afterReveal = await lobbies.reveal(
        lobby.code,
        host.id,
        "profession"
      );
      const checkpoint = afterReveal.rollback.checkpoints.find(
        (entry) => entry.label === "Перед відкриттям «Професія»"
      );
      expect(checkpoint).toBeDefined();

      const swapPlayer = players[1];
      if (swapPlayer === undefined) {
        throw new Error("Expected a second player to swap positions with");
      }
      const directPositionSql = postgres(databaseUrl);
      try {
        await directPositionSql`
          UPDATE lobby_players
          SET position = 16
          WHERE lobby_id = (SELECT lobby_id FROM lobbies WHERE code = ${lobby.code})
            AND telegram_id = ${host.id}
        `;
        await directPositionSql`
          UPDATE lobby_players
          SET position = 1
          WHERE lobby_id = (SELECT lobby_id FROM lobbies WHERE code = ${lobby.code})
            AND telegram_id = ${swapPlayer.id}
        `;
        await directPositionSql`
          UPDATE lobby_players
          SET position = 2
          WHERE lobby_id = (SELECT lobby_id FROM lobbies WHERE code = ${lobby.code})
            AND telegram_id = ${host.id}
        `;
      } finally {
        await directPositionSql.end({ timeout: 5 });
      }

      const positionProposal = await lobbies.proposeRollback(
        lobby.code,
        host.id,
        checkpoint?.id ?? "missing",
        "Перевіряємо колізію позиції 10"
      );
      const positionProposalId =
        positionProposal.rollback.proposal?.id ?? "missing";
      for (const player of players.slice(1, 5)) {
        await lobbies.voteRollback(
          lobby.code,
          player.id,
          true,
          positionProposalId
        );
      }
      const restored = await lobbies.voteRollback(
        lobby.code,
        players[5]?.id ?? "missing",
        true,
        positionProposalId
      );
      expect(restored.rollback.proposal).toBeNull();

      const directCheckSql = postgres(databaseUrl);
      try {
        const restoredPositions = await directCheckSql<
          { readonly player_id: string; readonly position: number }[]
        >`
          SELECT telegram_id::text AS player_id, position::integer
          FROM lobby_players
          WHERE lobby_id = (SELECT lobby_id FROM lobbies WHERE code = ${lobby.code})
          ORDER BY position
        `;
        expect(restoredPositions.map((entry) => entry.player_id)).toEqual(
          players.map((player) => player.id)
        );
      } finally {
        await directCheckSql.end({ timeout: 5 });
      }
    } finally {
      await Promise.all([authSessions.close(), lobbies.close()]);
    }
  });
});
