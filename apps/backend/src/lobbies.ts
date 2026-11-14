import { randomInt, randomUUID } from "node:crypto";

import postgres from "postgres";

import {
  CHARACTERISTIC_CATEGORIES,
  MAX_GAME_PLAYERS,
  MIN_GAME_PLAYERS,
  type CharacteristicId,
  type Lobby,
  type LobbyPlayer,
  type MockGameView,
  type PlaytestCardSelection,
  type PlaytestResourceId,
  type PublicGameView,
  type TeamOutcome
} from "@bunker/contracts";
import { FERTILITY_SPECIALIST_PROFESSION_LABEL } from "@bunker/content";
import {
  assessDemography,
  calculateBunkerCapacity,
  type DemographyAssessment
} from "@bunker/game-engine";

import {
  appendGameEvent,
  cancelGameRollback,
  createGameCheckpoint,
  createInitialGameBranch,
  ensureGameNotRollbackPaused,
  isGameRollbackPaused,
  proposeGameRollback,
  readGameRollbackView,
  regenerateInvalidatedCharacteristic,
  resumeGameAfterRollback,
  setupGameRollbackSchema,
  voteForGameRollback
} from "./game-rollback.js";
import {
  createPlaytestDossiers,
  FERTILITY_CAPABLE_SPECIAL_CONDITION,
  INSEMINATION_KIT_BAGGAGE,
  parsePlaytestAgeGender,
  type PlaytestDossier
} from "./playtest-dossiers.js";
import {
  dealPlaytestCards,
  findPlaytestCardDefinition,
  initialScenarioResources,
  resolveOperationChalkScenario,
  parseStoredCard,
  parseStoredResources,
  type StoredPlaytestCard
} from "./playtest-scenario.js";
import {
  applyPlaytestCardEffect,
  PlaytestCardSelectionError,
  validatePlaytestCardSelection
} from "./playtest-card-runtime.js";
import {
  clearVoteEffects,
  consumeTurnAdjustment,
  emptyPlaytestCardState,
  parsePlaytestCardState,
  tallyPlaytestVotes,
  type PlaytestCardState
} from "./playtest-card-state.js";

export type LobbyStoreView = Lobby;

export interface LobbyStore {
  readonly begin: (
    code: string,
    playerId: string
  ) => Promise<MockGameView>;
  readonly close: () => Promise<void>;
  readonly create: (hostPlayerId: string) => Promise<LobbyStoreView>;
  readonly findCurrent: (
    playerId: string
  ) => Promise<LobbyStoreView | null>;
  readonly findForPlayer: (
    code: string,
    playerId: string
  ) => Promise<LobbyStoreView | null>;
  readonly join: (
    code: string,
    playerId: string
  ) => Promise<LobbyStoreView>;
  readonly cancelRollback: (
    code: string,
    playerId: string,
    proposalId: string
  ) => Promise<MockGameView>;
  readonly leave: (
    code: string,
    playerId: string
  ) => Promise<{ readonly cancelled: boolean }>;
  readonly findGame: (
    code: string,
    playerId: string
  ) => Promise<MockGameView | null>;
  readonly findPublicGame: (
    code: string
  ) => Promise<PublicGameView | null>;
  readonly finishDiscussion: (
    code: string,
    playerId: string
  ) => Promise<MockGameView>;
  readonly finishVoting: (
    code: string,
    playerId: string,
    votingAttempt: number
  ) => Promise<MockGameView>;
  readonly finishTurn: (
    code: string,
    playerId: string
  ) => Promise<MockGameView>;
  readonly reveal: (
    code: string,
    playerId: string,
    characteristicId: CharacteristicId
  ) => Promise<MockGameView>;
  readonly reactCard: (
    code: string,
    playerId: string,
    selection: PlaytestCardSelection,
    expectedReactionCount: number
  ) => Promise<MockGameView>;
  readonly proposeRollback: (
    code: string,
    playerId: string,
    checkpointId: string,
    reason: string
  ) => Promise<MockGameView>;
  readonly reorder: (
    code: string,
    playerId: string,
    orderedPlayerIds: readonly string[]
  ) => Promise<LobbyStoreView>;
  readonly submitFinalOutcome: (
    code: string,
    playerId: string,
    outcome: TeamOutcome
  ) => Promise<MockGameView>;
  readonly resumeRollback: (
    code: string,
    playerId: string
  ) => Promise<MockGameView>;
  readonly useCard: (
    code: string,
    playerId: string,
    selection: PlaytestCardSelection
  ) => Promise<MockGameView>;
  readonly vote: (
    code: string,
    playerId: string,
    targetPlayerId: string,
    votingAttempt: number
  ) => Promise<MockGameView>;
  readonly voteRollback: (
    code: string,
    playerId: string,
    approve: boolean,
    proposalId: string
  ) => Promise<MockGameView>;
  readonly setReady: (
    code: string,
    playerId: string,
    ready: boolean
  ) => Promise<LobbyStoreView>;
  readonly setSecretGoalsEnabled: (
    code: string,
    playerId: string,
    enabled: boolean
  ) => Promise<LobbyStoreView>;
  readonly start: (
    code: string,
    playerId: string
  ) => Promise<LobbyStoreView>;
  readonly sweepStaleWaitingLobbies: () => Promise<number>;
}

export type LobbyStoreErrorCode =
  | "ALREADY_IN_LOBBY"
  | "ALREADY_VOTED"
  | "CHARACTERISTIC_ALREADY_REVEALED"
  | "MUST_REVEAL_PROFESSION_FIRST"
  | "CARD_NOT_ALLOWED"
  | "CARD_NOT_AVAILABLE"
  | "INVALID_CARD_SELECTION"
  | "DEMOGRAPHY_NOT_PRESERVED"
  | "GAME_NOT_IN_INTRO"
  | "GAME_NOT_IN_FINAL"
  | "GAME_NOT_IN_DISCUSSION"
  | "GAME_NOT_IN_VOTING"
  | "INVALID_VOTE_TARGET"
  | "INVALID_PLAYER_ORDER"
  | "LOBBY_CLOSED"
  | "LOBBY_FULL"
  | "LOBBY_NOT_FOUND"
  | "NOT_A_LOBBY_MEMBER"
  | "NOT_YOUR_TURN"
  | "ONLY_HOST_CAN_BEGIN"
  | "ONLY_HOST_CAN_END_DISCUSSION"
  | "ONLY_HOST_CAN_FINALIZE"
  | "ONLY_HOST_CAN_FINISH_VOTING"
  | "ONLY_HOST_CAN_REORDER"
  | "ONLY_HOST_CAN_START"
  | "ONLY_HOST_CAN_TOGGLE_SECRET_GOALS"
  | "PLAYTEST_REQUIRES_FOUR_TO_SIXTEEN_PLAYERS"
  | "PLAYERS_NOT_READY"
  | "REACTION_CHAIN_CHANGED"
  | "TURN_NOT_READY_TO_FINISH"
  | "VOTING_ATTEMPT_CHANGED";

export class LobbyStoreError extends Error {
  readonly code: LobbyStoreErrorCode;

  constructor(code: LobbyStoreErrorCode) {
    super(code);
    this.name = "LobbyStoreError";
    this.code = code;
  }
}

interface LobbyRow {
  readonly code: string;
  readonly host_player_id: string;
  readonly scenario_id: string;
  readonly secret_goals_enabled: boolean;
  readonly status: string;
}

interface LobbyPlayerRow {
  readonly first_name: string;
  readonly is_host: boolean;
  readonly last_name: string | null;
  readonly player_id: string;
  readonly position: number;
  readonly ready: boolean;
  readonly username: string | null;
}

interface MockGamePlayerRow {
  readonly character_profile: unknown;
  readonly first_name: string;
  readonly last_name: string | null;
  readonly player_id: string;
  readonly position: number;
  readonly revealed_characteristics: readonly string[];
  readonly status: string;
  readonly vote_target_player_id: string | null;
}

interface PublicGamePlayerRow {
  readonly character_profile: unknown;
  readonly first_name: string;
  readonly last_name: string | null;
  readonly player_id: string;
  readonly position: number;
  readonly revealed_characteristics: readonly string[];
  readonly status: string;
}

const lobbyCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createLobbyCode() {
  return Array.from(
    { length: 6 },
    () => lobbyCodeAlphabet[randomInt(lobbyCodeAlphabet.length)]
  ).join("");
}

function toPlayer(row: LobbyPlayerRow): LobbyPlayer {
  return {
    firstName: row.first_name,
    id: row.player_id,
    isHost: row.is_host,
    ...(row.last_name === null ? {} : { lastName: row.last_name }),
    position: row.position,
    ready: row.ready,
    ...(row.username === null ? {} : { username: row.username })
  };
}

function isCharacteristicId(value: string): value is CharacteristicId {
  return CHARACTERISTIC_CATEGORIES.some(
    (category) => category.id === value
  );
}

async function resolveTurnStage(
  transaction: postgres.TransactionSql,
  input: {
    readonly lobbyId: string;
    readonly playerId: string;
    readonly round: number;
  }
): Promise<"choosing" | "speaking"> {
  const [player] = await transaction<{
    readonly revealed_characteristics: readonly string[];
  }[]>`
    SELECT revealed_characteristics
    FROM lobby_players
    WHERE lobby_id = ${input.lobbyId}
      AND telegram_id = ${input.playerId}
  `;
  const revealed = player?.revealed_characteristics ?? [];
  const hasHidden = CHARACTERISTIC_CATEGORIES.some(
    (category) =>
      (input.round !== 1 || category.id === "profession") &&
      !revealed.includes(category.id)
  );
  return hasHidden ? "choosing" : "speaking";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredCharacteristics(
  value: unknown
): PlaytestDossier["characteristics"] {
  if (!isRecord(value)) {
    throw new Error("Started game is missing a character dossier");
  }

  const characteristics = Object.fromEntries(
    CHARACTERISTIC_CATEGORIES.map((category) => {
      const characteristic = value[category.id];
      if (typeof characteristic !== "string" || characteristic.length === 0) {
        throw new Error("Started game contains an invalid character dossier");
      }
      return [category.id, characteristic];
    })
  );

  return characteristics as PlaytestDossier["characteristics"];
}

function assessActivePlayersDemography(
  players: readonly Pick<
    MockGamePlayerRow,
    "character_profile" | "status"
  >[]
): DemographyAssessment {
  const activeCharacteristics = players
    .filter((player) => player.status === "active")
    .map((player) => parseStoredCharacteristics(player.character_profile));

  return assessDemography(
    activeCharacteristics.map((characteristics) => ({
      ...parsePlaytestAgeGender(characteristics["age-gender"]),
      fertilityCapable:
        characteristics["special-condition"] ===
        FERTILITY_CAPABLE_SPECIAL_CONDITION
    })),
    undefined,
    activeCharacteristics.some(
      (characteristics) =>
        characteristics.baggage === INSEMINATION_KIT_BAGGAGE ||
        characteristics.profession === FERTILITY_SPECIALIST_PROFESSION_LABEL
    )
  );
}

interface StoredCardChain {
  readonly action: StoredPlaytestCard;
  readonly actionSelection: PlaytestCardSelection;
  readonly actorPlayerId: string;
  readonly reactions: readonly {
    readonly card: StoredPlaytestCard;
    readonly playerId: string;
    readonly selection: PlaytestCardSelection;
  }[];
}

const playtestResourceIds = new Set<PlaytestResourceId>(
  initialScenarioResources.map(({ id }) => id)
);

function parseStoredCardSelection(value: unknown): PlaytestCardSelection {
  if (!isRecord(value)) {
    return {};
  }
  const characteristicId =
    typeof value.characteristicId === "string" &&
    isCharacteristicId(value.characteristicId)
      ? value.characteristicId
      : undefined;
  const resourceId =
    typeof value.resourceId === "string" &&
    playtestResourceIds.has(value.resourceId as PlaytestResourceId)
      ? (value.resourceId as PlaytestResourceId)
      : undefined;
  return {
    ...(characteristicId === undefined ? {} : { characteristicId }),
    ...(resourceId === undefined ? {} : { resourceId }),
    ...(typeof value.targetPlayerId === "string"
      ? { targetPlayerId: value.targetPlayerId }
      : {})
  };
}

function parseStoredCardChain(value: unknown): StoredCardChain {
  if (
    !isRecord(value) ||
    typeof value.actorPlayerId !== "string" ||
    !Array.isArray(value.reactions) ||
    value.reactions.length > 2
  ) {
    throw new Error("Started game contains an invalid card chain");
  }

  const reactions = value.reactions.map((reaction) => {
    if (
      !isRecord(reaction) ||
      typeof reaction.playerId !== "string"
    ) {
      throw new Error("Started game contains an invalid card reaction");
    }
    return {
      card: parseStoredCard(reaction.card),
      playerId: reaction.playerId,
      selection: parseStoredCardSelection(reaction.selection)
    };
  });

  const action = parseStoredCard(value.action);
  if (
    action.kind !== "action" ||
    reactions.some((reaction) => reaction.card.kind !== "reaction") ||
    new Set(reactions.map((reaction) => reaction.playerId)).size !==
      reactions.length
  ) {
    throw new Error("Started game contains an invalid card chain");
  }

  return {
    action,
    actionSelection: parseStoredCardSelection(value.actionSelection),
    actorPlayerId: value.actorPlayerId,
    reactions
  };
}

const turnDurationSeconds = 90;
const discussionDurationSeconds = 180;
const reactionDurationSeconds = 15;

function isCodeConflict(error: unknown) {
  return (
    error instanceof postgres.PostgresError &&
    error.code === "23505" &&
    error.constraint_name === "lobbies_code_unique"
  );
}

export async function openPostgresLobbyStore(
  databaseUrl: string
): Promise<LobbyStore> {
  const sql = postgres(databaseUrl, {
    max: 5
  });

  try {
    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(26072026)`;
      await transaction`
        CREATE TABLE IF NOT EXISTS lobbies (
          lobby_id uuid PRIMARY KEY,
          code char(6) NOT NULL,
          host_telegram_id bigint NOT NULL REFERENCES telegram_users(telegram_id),
          scenario_id text NOT NULL,
          status text NOT NULL DEFAULT 'waiting',
          game_phase text NOT NULL DEFAULT 'revealing',
          round integer NOT NULL DEFAULT 1,
          current_turn_position smallint,
          voting_attempt smallint NOT NULL DEFAULT 1,
          voting_candidate_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
          final_outcome text,
          scenario_resources jsonb NOT NULL DEFAULT '[]'::jsonb,
          turn_deadline timestamptz,
          turn_stage text,
          turn_revealed_characteristic_id text,
          card_chain jsonb,
          card_state jsonb NOT NULL DEFAULT '{}'::jsonb,
          reaction_deadline timestamptz,
          reaction_turn_seconds integer,
          last_event text,
          secret_goals_enabled boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT lobbies_code_unique UNIQUE (code)
        )
      `;
      await transaction`
        CREATE TABLE IF NOT EXISTS lobby_players (
          lobby_id uuid NOT NULL REFERENCES lobbies(lobby_id) ON DELETE CASCADE,
          telegram_id bigint NOT NULL REFERENCES telegram_users(telegram_id),
          position smallint NOT NULL CONSTRAINT lobby_players_position_check
            CHECK (position BETWEEN 1 AND 16),
          ready boolean NOT NULL DEFAULT false,
          revealed_characteristics text[] NOT NULL
            DEFAULT ARRAY[]::text[],
          character_profile jsonb,
          secret_goal text,
          special_card jsonb,
          card_used boolean NOT NULL DEFAULT false,
          card_private_result text,
          inspected_characteristics text[] NOT NULL DEFAULT ARRAY[]::text[],
          game_status text NOT NULL DEFAULT 'active',
          vote_target_telegram_id bigint,
          joined_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (lobby_id, telegram_id),
          UNIQUE (lobby_id, position)
        )
      `;
      await transaction`
        ALTER TABLE lobby_players
        ADD COLUMN IF NOT EXISTS revealed_characteristics text[] NOT NULL
          DEFAULT ARRAY[]::text[]
      `;
      await transaction`
        ALTER TABLE lobby_players
        DROP CONSTRAINT IF EXISTS lobby_players_position_check
      `;
      await transaction`
        ALTER TABLE lobby_players
        ADD CONSTRAINT lobby_players_position_check
          CHECK (position BETWEEN 1 AND 16)
      `;
      await transaction`
        ALTER TABLE lobby_players
        DROP CONSTRAINT IF EXISTS lobby_players_lobby_id_position_key
      `;
      await transaction`
        ALTER TABLE lobby_players
        ADD CONSTRAINT lobby_players_lobby_id_position_key
          UNIQUE (lobby_id, position) DEFERRABLE INITIALLY IMMEDIATE
      `;
      await transaction`
        ALTER TABLE lobby_players
        ALTER COLUMN revealed_characteristics
          SET DEFAULT ARRAY[]::text[]
      `;
      await transaction`
        ALTER TABLE lobby_players
        ADD COLUMN IF NOT EXISTS character_profile jsonb
      `;
      await transaction`
        ALTER TABLE lobby_players
        ADD COLUMN IF NOT EXISTS secret_goal text
      `;
      await transaction`
        ALTER TABLE lobby_players
        ADD COLUMN IF NOT EXISTS special_card jsonb
      `;
      await transaction`
        ALTER TABLE lobby_players
        ADD COLUMN IF NOT EXISTS card_used boolean NOT NULL DEFAULT false
      `;
      await transaction`
        ALTER TABLE lobby_players
        ADD COLUMN IF NOT EXISTS card_private_result text
      `;
      await transaction`
        ALTER TABLE lobby_players
        ADD COLUMN IF NOT EXISTS inspected_characteristics text[] NOT NULL
          DEFAULT ARRAY[]::text[]
      `;
      await transaction`
        ALTER TABLE lobby_players
        ADD COLUMN IF NOT EXISTS game_status text NOT NULL DEFAULT 'active'
      `;
      await transaction`
        ALTER TABLE lobby_players
        ADD COLUMN IF NOT EXISTS vote_target_telegram_id bigint
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS game_phase text NOT NULL DEFAULT 'revealing'
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS round integer NOT NULL DEFAULT 1
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS current_turn_position smallint
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS voting_attempt smallint NOT NULL DEFAULT 1
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS voting_candidate_ids text[] NOT NULL
          DEFAULT ARRAY[]::text[]
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS final_outcome text
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS scenario_resources jsonb NOT NULL
          DEFAULT '[]'::jsonb
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS turn_deadline timestamptz
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS turn_stage text
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS turn_revealed_characteristic_id text
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS card_chain jsonb
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS card_state jsonb NOT NULL DEFAULT '{}'::jsonb
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS reaction_deadline timestamptz
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS reaction_turn_seconds integer
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS last_event text
      `;
      await transaction`
        ALTER TABLE lobbies
        ADD COLUMN IF NOT EXISTS secret_goals_enabled boolean NOT NULL
          DEFAULT true
      `;
      await setupGameRollbackSchema(transaction);
      await transaction`
        UPDATE lobbies
        SET
          status = 'waiting',
          game_phase = 'revealing',
          round = 1,
          current_turn_position = NULL,
          voting_attempt = 1,
          voting_candidate_ids = ARRAY[]::text[],
          final_outcome = NULL,
          scenario_resources = '[]'::jsonb,
          turn_deadline = NULL,
          turn_stage = NULL,
          turn_revealed_characteristic_id = NULL,
          card_chain = NULL,
          card_state = '{}'::jsonb,
          reaction_deadline = NULL,
          reaction_turn_seconds = NULL,
          last_event = NULL
        WHERE status = 'started'
          AND EXISTS (
            SELECT 1
            FROM lobby_players
            WHERE lobby_players.lobby_id = lobbies.lobby_id
              AND (
                lobby_players.character_profile IS NULL
                OR lobby_players.special_card IS NULL
              )
          )
      `;
      await transaction`
        UPDATE lobbies
        SET turn_stage = 'choosing'
        WHERE status = 'started'
          AND game_phase IN ('revealing', 'reaction')
          AND turn_stage IS NULL
      `;
    });
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw error;
  }

  async function readLobby(code: string): Promise<LobbyStoreView | null> {
    const [lobby] = await sql<LobbyRow[]>`
      SELECT
        code::text,
        host_telegram_id::text AS host_player_id,
        scenario_id,
        secret_goals_enabled,
        status
      FROM lobbies
      WHERE code = ${code}
      LIMIT 1
    `;
    if (
      lobby === undefined ||
      (lobby.status !== "waiting" && lobby.status !== "started")
    ) {
      return null;
    }

    const players = await sql<LobbyPlayerRow[]>`
      SELECT
        users.telegram_id::text AS player_id,
        users.first_name,
        users.last_name,
        users.username,
        players.position::integer,
        players.ready,
        users.telegram_id = ${lobby.host_player_id}::bigint AS is_host
      FROM lobby_players AS players
      JOIN telegram_users AS users
        ON users.telegram_id = players.telegram_id
      JOIN lobbies
        ON lobbies.lobby_id = players.lobby_id
      WHERE lobbies.code = ${code}
      ORDER BY players.position
    `;

    return {
      code: lobby.code,
      hostPlayerId: lobby.host_player_id,
      players: players.map(toPlayer),
      scenarioId: lobby.scenario_id,
      secretGoalsEnabled: lobby.secret_goals_enabled,
      status: lobby.status
    };
  }

  async function requireLobby(code: string) {
    const lobby = await readLobby(code);
    if (lobby === null) {
      throw new LobbyStoreError("LOBBY_NOT_FOUND");
    }
    return lobby;
  }

  async function moveToVoting(
    transaction: postgres.TransactionSql,
    lobbyId: string
  ) {
    await transaction`
      UPDATE lobby_players
      SET vote_target_telegram_id = NULL
      WHERE lobby_id = ${lobbyId}
    `;
    await transaction`
      UPDATE lobbies
      SET
        game_phase = 'voting',
        current_turn_position = NULL,
        turn_deadline = NULL,
        turn_stage = NULL,
        turn_revealed_characteristic_id = NULL,
        voting_attempt = 1,
        voting_candidate_ids = ARRAY[]::text[],
        last_event = 'Обговорення завершено. Розпочато голосування.'
      WHERE lobby_id = ${lobbyId}
    `;
    await createGameCheckpoint(transaction, {
      label: "Початок голосування",
      lobbyId
    });
  }

  async function resolveVoteTally(
    transaction: postgres.TransactionSql,
    input: {
      readonly activePlayers: readonly {
        readonly player_id: string;
        readonly position: number;
      }[];
      readonly ballots: readonly {
        readonly targetPlayerId: string;
        readonly voterPlayerId: string;
      }[];
      readonly candidatePlayerIds: readonly string[];
      readonly cardState: PlaytestCardState;
      readonly lobbyId: string;
      readonly totalPlayerCount: number;
      readonly votingAttempt: number;
    }
  ) {
    const tallies = tallyPlaytestVotes(
      input.ballots,
      input.cardState,
      input.candidatePlayerIds
    );
    const highestVotes = tallies[0]?.votes ?? 0;
    const tiedPlayerIds = tallies
      .filter((tally) => tally.votes === highestVotes)
      .map((tally) => tally.targetPlayerId);

    if (tiedPlayerIds.length > 1 && input.votingAttempt < 3) {
      await transaction`
        UPDATE lobby_players
        SET vote_target_telegram_id = NULL
        WHERE lobby_id = ${input.lobbyId}
      `;
      await transaction`
        UPDATE lobbies
        SET
          voting_attempt = ${input.votingAttempt + 1},
          voting_candidate_ids = ${tiedPlayerIds}
        WHERE lobby_id = ${input.lobbyId}
      `;
      return;
    }

    let eliminatedPlayerId: string | null = null;
    if (tiedPlayerIds.length === 1) {
      eliminatedPlayerId = tiedPlayerIds[0] ?? null;
      await transaction`
        UPDATE lobby_players
        SET game_status = 'eliminated'
        WHERE lobby_id = ${input.lobbyId}
          AND telegram_id = ${eliminatedPlayerId}
      `;
    }
    await transaction`
      UPDATE lobby_players
      SET vote_target_telegram_id = NULL
      WHERE lobby_id = ${input.lobbyId}
    `;

    const remainingPlayers = input.activePlayers.filter(
      (player) => player.player_id !== eliminatedPlayerId
    );
    const capacity = calculateBunkerCapacity(input.totalPlayerCount);
    if (remainingPlayers.length <= capacity) {
      await transaction`
        UPDATE lobbies
        SET
          game_phase = 'final_check',
          current_turn_position = NULL,
          turn_deadline = NULL,
          turn_stage = NULL,
          turn_revealed_characteristic_id = NULL,
          voting_attempt = 1,
          voting_candidate_ids = ARRAY[]::text[],
          card_state = ${transaction.json(clearVoteEffects(input.cardState) as unknown as postgres.JSONValue)}
        WHERE lobby_id = ${input.lobbyId}
      `;
      await createGameCheckpoint(transaction, {
        label: "Початок фінальної перевірки",
        lobbyId: input.lobbyId
      });
      return;
    }

    const stage =
      remainingPlayers[0] === undefined
        ? "choosing"
        : await resolveTurnStage(transaction, {
            lobbyId: input.lobbyId,
            playerId: remainingPlayers[0].player_id,
            round: 2
          });
    await transaction`
      UPDATE lobbies
      SET
        game_phase = 'revealing',
        round = round + 1,
        current_turn_position = ${remainingPlayers[0]?.position ?? 1},
        turn_stage = ${stage},
        turn_revealed_characteristic_id = NULL,
        turn_deadline =
          now() + ${turnDurationSeconds} * interval '1 second',
        voting_attempt = 1,
        voting_candidate_ids = ARRAY[]::text[],
        card_state = ${transaction.json(clearVoteEffects(input.cardState) as unknown as postgres.JSONValue)},
        last_event = NULL
      WHERE lobby_id = ${input.lobbyId}
    `;
    await createGameCheckpoint(transaction, {
      label: "Початок наступного раунду",
      lobbyId: input.lobbyId
    });
  }

  async function consumeScheduledTurn(
    transaction: postgres.TransactionSql,
    lobbyId: string,
    playerId: string
  ) {
    const [row] = await transaction<{ readonly card_state: unknown }[]>`
      SELECT card_state
      FROM lobbies
      WHERE lobby_id = ${lobbyId}
      FOR UPDATE
    `;
    return consumeTurnAdjustment(
      parsePlaytestCardState(row?.card_state),
      playerId
    );
  }

  async function advanceAfterTurn(
    transaction: postgres.TransactionSql,
    input: {
      readonly lobbyId: string;
      readonly playerPosition: number;
      readonly round: number;
    }
  ) {
    const [nextPlayer] = await transaction<{
      readonly player_id: string;
      readonly position: number;
    }[]>`
      SELECT
        telegram_id::text AS player_id,
        position::integer
      FROM lobby_players
      WHERE lobby_id = ${input.lobbyId}
        AND game_status = 'active'
        AND position > ${input.playerPosition}
      ORDER BY position
      LIMIT 1
    `;
    if (nextPlayer !== undefined) {
      const timing = await consumeScheduledTurn(
        transaction,
        input.lobbyId,
        nextPlayer.player_id
      );
      const stage = await resolveTurnStage(transaction, {
        lobbyId: input.lobbyId,
        playerId: nextPlayer.player_id,
        round: input.round
      });
      await transaction`
        UPDATE lobbies
        SET
          current_turn_position = ${nextPlayer.position},
          turn_stage = ${stage},
          turn_revealed_characteristic_id = NULL,
          turn_deadline =
            now() + ${Math.max(15, turnDurationSeconds + timing.seconds)} * interval '1 second',
          card_state = ${transaction.json(timing.state as unknown as postgres.JSONValue)}
        WHERE lobby_id = ${input.lobbyId}
      `;
      await createGameCheckpoint(transaction, {
        label: `Початок ходу гравця №${nextPlayer.position}`,
        lobbyId: input.lobbyId
      });
      return;
    }

    if (input.round === 1) {
      const [firstPlayer] = await transaction<{
        readonly player_id: string;
        readonly position: number;
      }[]>`
        SELECT
          telegram_id::text AS player_id,
          position::integer
        FROM lobby_players
        WHERE lobby_id = ${input.lobbyId}
          AND game_status = 'active'
        ORDER BY position
        LIMIT 1
      `;
      const timing = await consumeScheduledTurn(
        transaction,
        input.lobbyId,
        firstPlayer?.player_id ?? ""
      );
      const stage = await resolveTurnStage(transaction, {
        lobbyId: input.lobbyId,
        playerId: firstPlayer?.player_id ?? "",
        round: 2
      });
      await transaction`
        UPDATE lobbies
        SET
          round = 2,
          current_turn_position = ${firstPlayer?.position ?? 1},
          turn_stage = ${stage},
          turn_revealed_characteristic_id = NULL,
          turn_deadline =
            now() + ${Math.max(15, turnDurationSeconds + timing.seconds)} * interval '1 second',
          card_state = ${transaction.json(timing.state as unknown as postgres.JSONValue)}
        WHERE lobby_id = ${input.lobbyId}
      `;
      await createGameCheckpoint(transaction, {
        label: "Початок раунду 2",
        lobbyId: input.lobbyId
      });
      return;
    }

    await transaction`
      UPDATE lobbies
      SET
        game_phase = 'discussion',
        current_turn_position = NULL,
        turn_stage = NULL,
        turn_revealed_characteristic_id = NULL,
        turn_deadline =
          now() + ${discussionDurationSeconds} * interval '1 second',
        last_event = 'Усі виступи завершено. Почалося загальне обговорення.'
      WHERE lobby_id = ${input.lobbyId}
    `;
    await createGameCheckpoint(transaction, {
      label: "Початок загального обговорення",
      lobbyId: input.lobbyId
    });
  }

  async function resolveReactionChain(
    transaction: postgres.TransactionSql,
    input: {
      readonly cardChain: unknown;
      readonly lobbyId: string;
      readonly reactionTurnSeconds: number | null;
      readonly resources: unknown;
    }
  ) {
    await createGameCheckpoint(transaction, {
      label: "Перед результатом ланцюжка карток",
      lobbyId: input.lobbyId
    });
    const chain = parseStoredCardChain(input.cardChain);
    const [stored] = await transaction<{
      readonly active_branch_id: string;
      readonly card_state: unknown;
    }[]>`
      SELECT active_branch_id::text, card_state
      FROM lobbies
      WHERE lobby_id = ${input.lobbyId}
      FOR UPDATE
    `;
    if (stored === undefined) {
      throw new Error("Cannot resolve cards for a missing game");
    }
    let resources = parseStoredResources(input.resources);
    let cardState = parsePlaytestCardState(stored.card_state);
    let turnExtensionSeconds = 0;
    const events: string[] = [];
    const applyCard = async (
      card: StoredPlaytestCard,
      actorPlayerId: string,
      selection: PlaytestCardSelection
    ) => {
      const effect = await applyPlaytestCardEffect(transaction, {
        actorPlayerId,
        card: findPlaytestCardDefinition(card.id),
        cardState,
        lobbyId: input.lobbyId,
        resources,
        selection
      });
      cardState = effect.cardState;
      resources = effect.resources;
      turnExtensionSeconds += effect.turnExtensionSeconds;
      events.push(effect.event);
    };

    const firstReaction = chain.reactions[0];
    if (chain.reactions.length === 2 || firstReaction === undefined) {
      await applyCard(
        chain.action,
        chain.actorPlayerId,
        chain.actionSelection
      );
      if (chain.reactions.length === 2) {
        events.push("Друга реакція скасувала першу.");
      }
    } else {
      const reaction = findPlaytestCardDefinition(firstReaction.card.id);
      const actionTargetsReactor =
        chain.actionSelection.targetPlayerId === firstReaction.playerId;
      if (
        reaction.effect.kind === "card" &&
        reaction.effect.operation === "cancel"
      ) {
        events.push(`Картку «${chain.action.title}» скасовано реакцією.`);
      } else if (
        reaction.effect.kind === "player" &&
        reaction.effect.operation === "protect" &&
        actionTargetsReactor
      ) {
        events.push(`${reaction.title}: дія проти гравця скасована.`);
      } else if (
        reaction.effect.kind === "card" &&
        reaction.effect.operation === "copy"
      ) {
        await applyCard(
          chain.action,
          chain.actorPlayerId,
          chain.actionSelection
        );
        await applyCard(
          chain.action,
          chain.actorPlayerId,
          chain.actionSelection
        );
      } else if (
        reaction.effect.kind === "card" &&
        reaction.effect.operation === "redirect"
      ) {
        const redirectedTargetPlayerId =
          firstReaction.selection.targetPlayerId;
        if (redirectedTargetPlayerId === undefined) {
          throw new Error("Card redirect is missing its target");
        }
        const redirectedSelection = {
          ...chain.actionSelection,
          targetPlayerId: redirectedTargetPlayerId
        };
        let redirectIsValid = true;
        try {
          await validatePlaytestCardSelection(transaction, {
            actorPlayerId: chain.actorPlayerId,
            card: findPlaytestCardDefinition(chain.action.id),
            lobbyId: input.lobbyId,
            resources,
            selection: redirectedSelection
          });
        } catch (error) {
          if (!(error instanceof PlaytestCardSelectionError)) {
            throw error;
          }
          redirectIsValid = false;
        }
        if (redirectIsValid) {
          await applyCard(
            chain.action,
            chain.actorPlayerId,
            redirectedSelection
          );
          events.push(`${reaction.title}: ціль дії змінено.`);
        } else {
          events.push(
            `${reaction.title}: перенаправлення відхилено — недопустима ціль.`
          );
        }
      } else {
        await applyCard(
          chain.action,
          chain.actorPlayerId,
          chain.actionSelection
        );
        await applyCard(
          firstReaction.card,
          firstReaction.playerId,
          firstReaction.selection
        );
      }
    }
    const resumedSeconds =
      Math.max(1, input.reactionTurnSeconds ?? 1) +
      turnExtensionSeconds;

    await transaction`
      UPDATE lobbies
      SET
        game_phase = 'revealing',
        scenario_resources = ${transaction.json(
          resources as unknown as postgres.JSONValue
        )},
        card_state = ${transaction.json(cardState as unknown as postgres.JSONValue)},
        turn_deadline =
          now() + ${resumedSeconds} * interval '1 second',
        card_chain = NULL,
        reaction_deadline = NULL,
        reaction_turn_seconds = NULL,
        last_event = ${events.join(" ")}
      WHERE lobby_id = ${input.lobbyId}
    `;
    await appendGameEvent(transaction, {
      branchId: stored.active_branch_id,
      eventType: "card_chain_resolved",
      lobbyId: input.lobbyId,
      payload: {
        actionCardId: chain.action.id,
        actionSelection: chain.actionSelection,
        reactions: chain.reactions.map((reaction) => ({
          cardId: reaction.card.id,
          playerId: reaction.playerId,
          selection: reaction.selection
        }))
      }
    });
  }

  async function synchronizeExpiredState(code: string) {
    await sql.begin(async (transaction) => {
      const [game] = await transaction<{
        readonly card_chain: unknown;
        readonly current_turn_position: number | null;
        readonly game_phase: string;
        readonly lobby_id: string;
        readonly reaction_expired: boolean;
        readonly reaction_turn_seconds: number | null;
        readonly resources: unknown;
        readonly round: number;
        readonly turn_expired: boolean;
        readonly turn_stage: string | null;
      }[]>`
        SELECT
          lobby_id::text,
          game_phase,
          round,
          current_turn_position::integer,
          turn_stage,
          card_chain,
          reaction_turn_seconds,
          scenario_resources AS resources,
          reaction_deadline IS NOT NULL
            AND reaction_deadline <= now() AS reaction_expired,
          turn_deadline IS NOT NULL
            AND turn_deadline <= now() AS turn_expired
        FROM lobbies
        WHERE code = ${code}
          AND status = 'started'
        FOR UPDATE
      `;
      if (game === undefined) {
        return;
      }
      if (await isGameRollbackPaused(transaction, game.lobby_id)) {
        return;
      }
      if (
        game.game_phase === "reaction" &&
        game.reaction_expired &&
        game.card_chain !== null
      ) {
        await resolveReactionChain(transaction, {
          cardChain: game.card_chain,
          lobbyId: game.lobby_id,
          reactionTurnSeconds: game.reaction_turn_seconds,
          resources: game.resources
        });
        return;
      }
      if (game.game_phase === "discussion" && game.turn_expired) {
        await moveToVoting(transaction, game.lobby_id);
        return;
      }
      if (
        game.game_phase !== "revealing" ||
        !game.turn_expired ||
        game.current_turn_position === null
      ) {
        return;
      }

      const [player] = await transaction<{
        readonly first_name: string;
        readonly player_id: string;
        readonly position: number;
        readonly revealed_characteristics: readonly string[];
      }[]>`
        SELECT
          users.first_name,
          players.telegram_id::text AS player_id,
          players.position::integer,
          players.revealed_characteristics
        FROM lobby_players AS players
        JOIN telegram_users AS users
          ON users.telegram_id = players.telegram_id
        WHERE players.lobby_id = ${game.lobby_id}
          AND players.game_status = 'active'
          AND players.position = ${game.current_turn_position}
        FOR UPDATE OF players
      `;
      if (player === undefined) {
        return;
      }
      if (game.turn_stage === "speaking") {
        await transaction`
          UPDATE lobbies
          SET last_event = ${
            `Час виступу ${player.first_name} вичерпано. ` +
            "Хід передано далі."
          }
          WHERE lobby_id = ${game.lobby_id}
        `;
        await advanceAfterTurn(transaction, {
          lobbyId: game.lobby_id,
          playerPosition: player.position,
          round: game.round
        });
        return;
      }
      const hidden = CHARACTERISTIC_CATEGORIES.filter(
        (category) =>
          (game.round !== 1 || category.id === "profession") &&
          !player.revealed_characteristics.includes(category.id)
      );
      const selected =
        hidden.length === 0 ? undefined : hidden[randomInt(hidden.length)];
      if (selected === undefined) {
        await transaction`
          UPDATE lobbies
          SET
            turn_stage = 'speaking',
            turn_deadline =
              now() + ${turnDurationSeconds} * interval '1 second',
            last_event = ${
              `${player.first_name}: закритих характеристик немає. ` +
              "Час на виступ поновлено."
            }
          WHERE lobby_id = ${game.lobby_id}
        `;
        return;
      }

      await createGameCheckpoint(transaction, {
        label: `Перед автовідкриттям «${selected.label}»`,
        lobbyId: game.lobby_id
      });
      const regenerated = await regenerateInvalidatedCharacteristic(
        transaction,
        {
          characteristicId: selected.id,
          lobbyId: game.lobby_id,
          playerId: player.player_id
        }
      );
      await transaction`
        UPDATE lobby_players
        SET
          revealed_characteristics = array_append(
            revealed_characteristics,
            ${selected.id}
          ),
          disclosed_characteristics = CASE
            WHEN ${selected.id} = ANY(disclosed_characteristics)
              THEN disclosed_characteristics
            ELSE array_append(disclosed_characteristics, ${selected.id})
          END
        WHERE lobby_id = ${game.lobby_id}
          AND telegram_id = ${player.player_id}
      `;
      const [revealedPlayer] = await transaction<{
        readonly branch_id: string;
        readonly character_profile: unknown;
      }[]>`
        SELECT
          lobbies.active_branch_id::text AS branch_id,
          players.character_profile
        FROM lobbies
        JOIN lobby_players AS players
          ON players.lobby_id = lobbies.lobby_id
        WHERE lobbies.lobby_id = ${game.lobby_id}
          AND players.telegram_id = ${player.player_id}
      `;
      if (revealedPlayer !== undefined) {
        const profile = parseStoredCharacteristics(
          revealedPlayer.character_profile
        );
        await appendGameEvent(transaction, {
          branchId: revealedPlayer.branch_id,
          eventType: regenerated.regenerated
            ? "characteristic_regenerated_and_revealed"
            : "characteristic_revealed",
          lobbyId: game.lobby_id,
          payload: {
            automatic: true,
            characteristicId: selected.id,
            playerId: player.player_id,
            value: profile[selected.id]
          }
        });
      }
      await transaction`
        UPDATE lobbies
        SET last_event = ${
          regenerated.regenerated
            ? `Час ${player.first_name} вичерпано. «${selected.label}» перегенеровано після rollback і автоматично відкрито; виступ пропущено.`
            : `Час ${player.first_name} вичерпано. Автоматично відкрито «${selected.label}», виступ пропущено.`
        }
        WHERE lobby_id = ${game.lobby_id}
      `;
      await advanceAfterTurn(transaction, {
        lobbyId: game.lobby_id,
        playerPosition: player.position,
        round: game.round
      });
    });
  }

  async function readPublicGame(
    code: string
  ): Promise<PublicGameView | null> {
    await synchronizeExpiredState(code);
    const [current] = await sql<{
      readonly current_turn_position: number | null;
      readonly final_outcome: string | null;
      readonly game_phase: string;
      readonly last_event: string | null;
      readonly reaction_deadline: Date | null;
      readonly resources: unknown;
      readonly rollback_paused: boolean;
      readonly round: number;
      readonly status: string;
      readonly turn_deadline: Date | null;
      readonly turn_revealed_characteristic_id: string | null;
      readonly turn_stage: string | null;
    }[]>`
      SELECT
        current_turn_position::integer,
        final_outcome,
        game_phase,
        scenario_resources AS resources,
        reaction_deadline,
        turn_deadline,
        turn_revealed_characteristic_id,
        turn_stage,
        last_event,
        round,
        status,
        rollback_paused OR EXISTS (
          SELECT 1
          FROM rollback_proposals
          WHERE rollback_proposals.lobby_id = lobbies.lobby_id
            AND status = 'pending'
        ) AS rollback_paused
      FROM lobbies
      WHERE code = ${code}
      LIMIT 1
    `;
    if (current === undefined || current.status !== "started") {
      return null;
    }
    if (
      current.game_phase !== "scenario_intro" &&
      current.game_phase !== "revealing" &&
      current.game_phase !== "reaction" &&
      current.game_phase !== "discussion" &&
      current.game_phase !== "voting" &&
      current.game_phase !== "final_check" &&
      current.game_phase !== "completed"
    ) {
      throw new Error("Started game contains an invalid phase");
    }

    const players = await sql<PublicGamePlayerRow[]>`
      SELECT
        users.telegram_id::text AS player_id,
        players.character_profile,
        users.first_name,
        users.last_name,
        players.position::integer,
        players.revealed_characteristics,
        players.game_status AS status
      FROM lobby_players AS players
      JOIN telegram_users AS users
        ON users.telegram_id = players.telegram_id
      JOIN lobbies
        ON lobbies.lobby_id = players.lobby_id
      WHERE lobbies.code = ${code}
      ORDER BY players.position
    `;
    const activePlayers = players.filter(
      (player) => player.status === "active"
    );
    const currentTurnPlayerId =
      current.current_turn_position === null
        ? null
        : (activePlayers.find(
            (player) => player.position === current.current_turn_position
          )?.player_id ?? null);

    return {
      activeDeadline: current.rollback_paused
        ? null
        : current.game_phase === "reaction"
          ? (current.reaction_deadline?.toISOString() ?? null)
          : (current.turn_deadline?.toISOString() ?? null),
      bunkerCapacity: calculateBunkerCapacity(players.length),
      code,
      currentTurnPlayerId,
      finalOutcome:
        current.final_outcome === "all_survive" ||
        current.final_outcome === "team_loss"
          ? current.final_outcome
          : null,
      lastEvent: current.last_event,
      phase: current.game_phase,
      players: players.map((player) => {
        const characteristics = parseStoredCharacteristics(
          player.character_profile
        );
        return {
          characteristics: Object.fromEntries(
            player.revealed_characteristics
              .filter(isCharacteristicId)
              .map((id) => [id, characteristics[id]])
          ),
          firstName: player.first_name,
          id: player.player_id,
          ...(player.last_name === null
            ? {}
            : { lastName: player.last_name }),
          position: player.position,
          status:
            player.status === "eliminated" ? "eliminated" : "active"
        };
      }),
      round: current.round,
      scenario: {
        ...resolveOperationChalkScenario(code),
        resources: parseStoredResources(current.resources),
        reveals: resolveOperationChalkScenario(code).reveals.filter(
          (reveal) => reveal.round <= current.round
        )
      },
      rollbackPaused: current.rollback_paused,
      status: "started",
      turnDeadline: current.turn_deadline?.toISOString() ?? null,
      turnRevealedCharacteristicId:
        current.turn_revealed_characteristic_id !== null &&
        isCharacteristicId(current.turn_revealed_characteristic_id)
          ? current.turn_revealed_characteristic_id
          : null,
      turnStage:
        current.turn_stage === "choosing" ||
        current.turn_stage === "speaking"
          ? current.turn_stage
          : null
    };
  }

  async function readGame(
    code: string,
    playerId: string
  ): Promise<MockGameView | null> {
    await synchronizeExpiredState(code);
    const [current] = await sql<{
      readonly card_chain: unknown;
      readonly card_private_result: string | null;
      readonly card_state: unknown;
      readonly card_used: boolean;
      readonly host_player_id: string;
      readonly character_profile: unknown;
      readonly current_turn_position: number | null;
      readonly final_outcome: string | null;
      readonly game_phase: string;
      readonly last_event: string | null;
      readonly player_position: number;
      readonly reaction_deadline: Date | null;
      readonly resources: unknown;
      readonly round: number;
      readonly secret_goal: string | null;
      readonly special_card: unknown;
      readonly status: string;
      readonly turn_deadline: Date | null;
      readonly turn_revealed_characteristic_id: string | null;
      readonly turn_stage: string | null;
      readonly voting_attempt: number;
      readonly voting_candidate_ids: readonly string[];
    }[]>`
      SELECT
        lobbies.host_telegram_id::text AS host_player_id,
        players.character_profile,
        players.special_card,
        players.card_used,
        players.card_private_result,
        lobbies.current_turn_position::integer,
        lobbies.final_outcome,
        lobbies.game_phase,
        lobbies.card_chain,
        lobbies.card_state,
        lobbies.reaction_deadline,
        lobbies.scenario_resources AS resources,
        lobbies.turn_deadline,
        lobbies.turn_revealed_characteristic_id,
        lobbies.turn_stage,
        lobbies.last_event,
        players.position::integer AS player_position,
        lobbies.round,
        players.secret_goal,
        lobbies.status,
        lobbies.voting_attempt::integer,
        lobbies.voting_candidate_ids
      FROM lobbies
      JOIN lobby_players AS players
        ON players.lobby_id = lobbies.lobby_id
      WHERE lobbies.code = ${code}
        AND players.telegram_id = ${playerId}
      LIMIT 1
    `;
    if (current === undefined || current.status !== "started") {
      return null;
    }
    const rollback = await readGameRollbackView(sql, {
      code,
      playerId
    });

    const players = await sql<MockGamePlayerRow[]>`
      SELECT
        users.telegram_id::text AS player_id,
        players.character_profile,
        users.first_name,
        users.last_name,
        players.position::integer,
        players.revealed_characteristics,
        players.game_status AS status,
        players.vote_target_telegram_id::text AS vote_target_player_id
      FROM lobby_players AS players
      JOIN telegram_users AS users
        ON users.telegram_id = players.telegram_id
      JOIN lobbies
        ON lobbies.lobby_id = players.lobby_id
      WHERE lobbies.code = ${code}
      ORDER BY players.position
    `;
    const ownCharacteristics = parseStoredCharacteristics(
      current.character_profile
    );
    if (
      current.game_phase !== "scenario_intro" &&
      current.game_phase !== "revealing" &&
      current.game_phase !== "reaction" &&
      current.game_phase !== "discussion" &&
      current.game_phase !== "voting" &&
      current.game_phase !== "final_check" &&
      current.game_phase !== "completed"
    ) {
      throw new Error("Started game contains an invalid phase");
    }
    const ownCard = parseStoredCard(current.special_card);
    const cardChain =
      current.card_chain === null
        ? null
        : parseStoredCardChain(current.card_chain);
    const cardState = parsePlaytestCardState(current.card_state);
    const activePlayers = players.filter(
      (player) => player.status === "active"
    );
    const demography =
      current.game_phase === "final_check" ||
      current.game_phase === "completed"
        ? assessActivePlayersDemography(players)
        : null;
    const currentTurnPlayerId =
      current.current_turn_position === null
        ? null
        : (activePlayers.find(
            (player) => player.position === current.current_turn_position
          )?.player_id ?? null);
    const votingCandidates =
      current.voting_candidate_ids.length === 0
        ? activePlayers
            .map((player) => player.player_id)
            .filter(
              (candidateId) =>
                !cardState.protectedVotePlayerIds.includes(candidateId)
            )
        : current.voting_candidate_ids.filter(
            (candidateId) =>
              !cardState.protectedVotePlayerIds.includes(candidateId)
          );
    const currentPlayer = players.find(
      (player) => player.player_id === playerId
    );

    return {
      bunkerCapacity: calculateBunkerCapacity(players.length),
      card: {
        ...ownCard,
        used: current.card_used
      },
      cardResult: current.card_private_result,
      cardChain:
        cardChain === null || current.reaction_deadline === null
          ? null
          : {
              action: cardChain.action,
              actionSelection: cardChain.actionSelection,
              actorPlayerId: cardChain.actorPlayerId,
              deadline: current.reaction_deadline.toISOString(),
              reactions: cardChain.reactions
            },
      characteristics: CHARACTERISTIC_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        revealed: players
          .find((player) => player.player_id === playerId)
          ?.revealed_characteristics.includes(category.id) ?? false,
        value: ownCharacteristics[category.id]
      })),
      code,
      currentTurnPlayerId,
      demography,
      dossierNumber: current.player_position,
      finalOutcome:
        current.final_outcome === "all_survive" ||
        current.final_outcome === "team_loss"
          ? current.final_outcome
          : null,
      hostPlayerId: current.host_player_id,
      lastEvent: current.last_event,
      phase: current.game_phase,
      players: players.map((player) => {
        const characteristics = parseStoredCharacteristics(
          player.character_profile
        );
        return {
          characteristics: Object.fromEntries(
            player.revealed_characteristics
              .filter(isCharacteristicId)
              .map((id) => [id, characteristics[id]])
          ),
          firstName: player.first_name,
          id: player.player_id,
          ...(player.last_name === null
            ? {}
            : { lastName: player.last_name }),
          position: player.position,
          status:
            player.status === "eliminated" ? "eliminated" : "active"
        };
      }),
      rollback,
      round: current.round,
      scenario: {
        ...resolveOperationChalkScenario(code),
        resources: parseStoredResources(current.resources),
        reveals: resolveOperationChalkScenario(code).reveals.filter(
          (reveal) => reveal.round <= current.round
        )
      },
      secretGoal: current.secret_goal,
      status: "started",
      turnDeadline:
        rollback.paused ? null : (current.turn_deadline?.toISOString() ?? null),
      turnRevealedCharacteristicId:
        current.turn_revealed_characteristic_id !== null &&
        isCharacteristicId(current.turn_revealed_characteristic_id)
          ? current.turn_revealed_characteristic_id
          : null,
      turnStage:
        current.turn_stage === "choosing" ||
        current.turn_stage === "speaking"
          ? current.turn_stage
          : null,
      voting:
        current.game_phase === "voting"
          ? {
              attempt:
                current.voting_attempt === 2
                  ? 2
                  : current.voting_attempt === 3
                    ? 3
                    : 1,
              candidatePlayerIds: votingCandidates,
              expected: activePlayers.filter(
                (player) =>
                  !cardState.silencedVoterPlayerIds.includes(
                    player.player_id
                  )
              ).length,
              hasVoted:
                currentPlayer?.vote_target_player_id !== null &&
                currentPlayer?.vote_target_player_id !== undefined,
              openVotes:
                current.voting_attempt === 3
                  ? activePlayers.flatMap((player) =>
                      player.vote_target_player_id === null
                        ? []
                        : [
                            {
                              targetPlayerId:
                                player.vote_target_player_id,
                              voterPlayerId: player.player_id
                            }
                          ]
                    )
                  : [],
              silenced: cardState.silencedVoterPlayerIds.includes(playerId),
              submitted: activePlayers.filter(
                (player) =>
                  player.vote_target_player_id !== null &&
                  !cardState.silencedVoterPlayerIds.includes(
                    player.player_id
                  )
              ).length,
              totals:
                cardState.revealVoteTotals || current.voting_attempt === 3
                  ? tallyPlaytestVotes(
                      activePlayers.flatMap((player) =>
                        player.vote_target_player_id === null
                          ? []
                          : [
                              {
                                targetPlayerId:
                                  player.vote_target_player_id,
                                voterPlayerId: player.player_id
                              }
                            ]
                      ),
                      cardState,
                      current.voting_candidate_ids
                    )
                  : []
            }
          : null
    };
  }

  async function requireGame(code: string, playerId: string) {
    const game = await readGame(code, playerId);
    if (game === null) {
      throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
    }
    return game;
  }

  return {
    begin: async (code, playerId) => {
      await sql.begin(async (transaction) => {
        const [game] = await transaction<{
          readonly card_state: unknown;
          readonly game_phase: string;
          readonly host_player_id: string;
          readonly lobby_id: string;
        }[]>`
          SELECT
            card_state,
            lobby_id::text,
            host_telegram_id::text AS host_player_id,
            game_phase
          FROM lobbies
          WHERE code = ${code}
            AND status = 'started'
          FOR UPDATE
        `;
        if (game === undefined) {
          throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
        }
        await ensureGameNotRollbackPaused(transaction, game.lobby_id);
        if (game.host_player_id !== playerId) {
          throw new LobbyStoreError("ONLY_HOST_CAN_BEGIN");
        }
        if (game.game_phase !== "scenario_intro") {
          throw new LobbyStoreError("GAME_NOT_IN_INTRO");
        }

        const [firstPlayer] = await transaction<{
          readonly position: number;
        }[]>`
          SELECT position::integer
          FROM lobby_players
          WHERE lobby_id = ${game.lobby_id}
            AND game_status = 'active'
          ORDER BY position
          LIMIT 1
        `;
        await transaction`
          UPDATE lobbies
          SET
            game_phase = 'revealing',
            current_turn_position = ${firstPlayer?.position ?? 1},
            turn_stage = 'choosing',
            turn_revealed_characteristic_id = NULL,
            turn_deadline =
              now() + ${turnDurationSeconds} * interval '1 second',
            last_event = 'Катастрофу оголошено. Перший раунд розпочато.'
          WHERE lobby_id = ${game.lobby_id}
        `;
        await createGameCheckpoint(transaction, {
          label: "Початок першого раунду",
          lobbyId: game.lobby_id
        });
      });
      return requireGame(code, playerId);
    },
    cancelRollback: async (code, playerId, proposalId) => {
      await sql.begin((transaction) =>
        cancelGameRollback(transaction, { code, playerId, proposalId })
      );
      return requireGame(code, playerId);
    },
    close: async () => {
      await sql.end({ timeout: 5 });
    },
    sweepStaleWaitingLobbies: async () => {
      const deleted = await sql<{ readonly code: string }[]>`
        DELETE FROM lobbies
        WHERE status = 'waiting'
          AND created_at < now() - interval '6 hours'
        RETURNING code
      `;
      return deleted.length;
    },
    create: async (hostPlayerId) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = createLobbyCode();

        try {
          const selectedCode = await sql.begin(async (transaction) => {
            await transaction`
              SELECT telegram_id
              FROM telegram_users
              WHERE telegram_id = ${hostPlayerId}
              FOR UPDATE
            `;
            const [current] = await transaction<{ readonly code: string }[]>`
              SELECT lobbies.code::text
              FROM lobby_players AS players
              JOIN lobbies
                ON lobbies.lobby_id = players.lobby_id
              WHERE players.telegram_id = ${hostPlayerId}
                AND lobbies.status IN ('waiting', 'started')
              ORDER BY lobbies.created_at DESC
              LIMIT 1
            `;
            if (current !== undefined) {
              return current.code;
            }

            const lobbyId = randomUUID();
            await transaction`
              INSERT INTO lobbies (
                lobby_id,
                code,
                host_telegram_id,
                scenario_id
              )
              VALUES (
                ${lobbyId},
                ${code},
                ${hostPlayerId},
                'operation-chalk'
              )
            `;
            await transaction`
              INSERT INTO lobby_players (
                lobby_id,
                telegram_id,
                position
              )
              VALUES (${lobbyId}, ${hostPlayerId}, 1)
            `;
            return code;
          });

          return requireLobby(selectedCode);
        } catch (error) {
          if (isCodeConflict(error)) {
            continue;
          }
          throw error;
        }
      }

      throw new Error("Could not allocate a unique lobby code");
    },
    findCurrent: async (playerId) => {
      const [row] = await sql<{ readonly code: string }[]>`
        SELECT lobbies.code::text
        FROM lobby_players AS players
        JOIN lobbies
          ON lobbies.lobby_id = players.lobby_id
        WHERE players.telegram_id = ${playerId}
          AND lobbies.status IN ('waiting', 'started')
        ORDER BY lobbies.created_at DESC
        LIMIT 1
      `;

      return row === undefined ? null : readLobby(row.code);
    },
    findForPlayer: async (code, playerId) => {
      const lobby = await readLobby(code);
      return lobby?.players.some((player) => player.id === playerId) === true
        ? lobby
        : null;
    },
    join: async (code, playerId) => {
      const selectedCode = await sql.begin(async (transaction) => {
        const [target] = await transaction<{
          readonly lobby_id: string;
          readonly status: string;
        }[]>`
          SELECT lobby_id::text, status
          FROM lobbies
          WHERE code = ${code}
          FOR UPDATE
        `;
        if (target === undefined) {
          throw new LobbyStoreError("LOBBY_NOT_FOUND");
        }
        if (target.status !== "waiting") {
          throw new LobbyStoreError("LOBBY_CLOSED");
        }

        await transaction`
          SELECT telegram_id
          FROM telegram_users
          WHERE telegram_id = ${playerId}
          FOR UPDATE
        `;
        const [current] = await transaction<{
          readonly code: string;
          readonly lobby_id: string;
        }[]>`
          SELECT lobbies.code::text, lobbies.lobby_id::text
          FROM lobby_players AS players
          JOIN lobbies
            ON lobbies.lobby_id = players.lobby_id
          WHERE players.telegram_id = ${playerId}
            AND lobbies.status IN ('waiting', 'started')
          LIMIT 1
        `;
        if (current?.lobby_id === target.lobby_id) {
          return current.code;
        }
        if (current !== undefined) {
          throw new LobbyStoreError("ALREADY_IN_LOBBY");
        }

        const [countRow] = await transaction<{
          readonly player_count: number;
        }[]>`
          SELECT count(*)::integer AS player_count
          FROM lobby_players
          WHERE lobby_id = ${target.lobby_id}
        `;
        const playerCount = countRow?.player_count ?? 0;
        if (playerCount >= MAX_GAME_PLAYERS) {
          throw new LobbyStoreError("LOBBY_FULL");
        }

        await transaction`
          INSERT INTO lobby_players (
            lobby_id,
            telegram_id,
            position
          )
          VALUES (${target.lobby_id}, ${playerId}, ${playerCount + 1})
        `;
        return code;
      });

      return requireLobby(selectedCode);
    },
    leave: async (code, playerId) =>
      sql.begin(async (transaction) => {
        const [target] = await transaction<{
          readonly game_phase: string;
          readonly host_player_id: string;
          readonly lobby_id: string;
          readonly status: string;
        }[]>`
          SELECT
            lobby_id::text,
            host_telegram_id::text AS host_player_id,
            status,
            game_phase
          FROM lobbies
          WHERE code = ${code}
          FOR UPDATE
        `;
        if (target === undefined) {
          throw new LobbyStoreError("LOBBY_NOT_FOUND");
        }

        const [member] = await transaction<{
          readonly position: number;
        }[]>`
          SELECT position::integer
          FROM lobby_players
          WHERE lobby_id = ${target.lobby_id}
            AND telegram_id = ${playerId}
        `;
        if (member === undefined) {
          throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
        }

        if (target.host_player_id === playerId) {
          await transaction`
            DELETE FROM lobbies
            WHERE lobby_id = ${target.lobby_id}
          `;
          return { cancelled: true };
        }
        if (target.status !== "waiting" && target.game_phase !== "completed") {
          throw new LobbyStoreError("LOBBY_CLOSED");
        }

        await transaction`
          DELETE FROM lobby_players
          WHERE lobby_id = ${target.lobby_id}
            AND telegram_id = ${playerId}
        `;
        const shiftedPlayers = await transaction<{
          readonly player_id: string;
          readonly position: number;
        }[]>`
          SELECT
            telegram_id::text AS player_id,
            position::integer
          FROM lobby_players
          WHERE lobby_id = ${target.lobby_id}
            AND position > ${member.position}
          ORDER BY position
        `;
        for (const player of shiftedPlayers) {
          await transaction`
            UPDATE lobby_players
            SET position = ${player.position - 1}
            WHERE lobby_id = ${target.lobby_id}
              AND telegram_id = ${player.player_id}
          `;
        }

        return { cancelled: false };
      }),
    findGame: readGame,
    findPublicGame: readPublicGame,
    finishDiscussion: async (code, playerId) => {
      await synchronizeExpiredState(code);
      await sql.begin(async (transaction) => {
        const [game] = await transaction<{
          readonly game_phase: string;
          readonly host_player_id: string;
          readonly lobby_id: string;
        }[]>`
          SELECT
            lobbies.lobby_id::text,
            lobbies.host_telegram_id::text AS host_player_id,
            lobbies.game_phase
          FROM lobbies
          JOIN lobby_players
            ON lobby_players.lobby_id = lobbies.lobby_id
          WHERE lobbies.code = ${code}
            AND lobbies.status = 'started'
            AND lobby_players.telegram_id = ${playerId}
          FOR UPDATE OF lobbies
        `;
        if (game === undefined) {
          throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
        }
        await ensureGameNotRollbackPaused(transaction, game.lobby_id);
        if (game.host_player_id !== playerId) {
          throw new LobbyStoreError("ONLY_HOST_CAN_END_DISCUSSION");
        }
        if (game.game_phase !== "discussion") {
          throw new LobbyStoreError("GAME_NOT_IN_DISCUSSION");
        }
        await moveToVoting(transaction, game.lobby_id);
      });
      return requireGame(code, playerId);
    },
    finishVoting: async (code, playerId, votingAttempt) => {
      await synchronizeExpiredState(code);
      await sql.begin(async (transaction) => {
        const [game] = await transaction<{
          readonly card_state: unknown;
          readonly game_phase: string;
          readonly host_player_id: string;
          readonly lobby_id: string;
          readonly voting_attempt: number;
          readonly voting_candidate_ids: readonly string[];
        }[]>`
          SELECT
            lobbies.lobby_id::text,
            lobbies.host_telegram_id::text AS host_player_id,
            lobbies.game_phase,
            lobbies.card_state,
            lobbies.voting_attempt::integer,
            lobbies.voting_candidate_ids
          FROM lobbies
          JOIN lobby_players
            ON lobby_players.lobby_id = lobbies.lobby_id
          WHERE lobbies.code = ${code}
            AND lobbies.status = 'started'
            AND lobby_players.telegram_id = ${playerId}
          FOR UPDATE OF lobbies
        `;
        if (game === undefined) {
          throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
        }
        await ensureGameNotRollbackPaused(transaction, game.lobby_id);
        if (game.host_player_id !== playerId) {
          throw new LobbyStoreError("ONLY_HOST_CAN_FINISH_VOTING");
        }
        if (game.game_phase !== "voting") {
          throw new LobbyStoreError("GAME_NOT_IN_VOTING");
        }
        if (game.voting_attempt !== votingAttempt) {
          throw new LobbyStoreError("VOTING_ATTEMPT_CHANGED");
        }
        const players = await transaction<{
          readonly player_id: string;
          readonly position: number;
          readonly status: string;
          readonly vote_target_player_id: string | null;
        }[]>`
          SELECT
            telegram_id::text AS player_id,
            position::integer,
            game_status AS status,
            vote_target_telegram_id::text AS vote_target_player_id
          FROM lobby_players
          WHERE lobby_id = ${game.lobby_id}
          ORDER BY position
          FOR UPDATE
        `;
        const activePlayers = players.filter(
          (player) => player.status === "active"
        );
        await createGameCheckpoint(transaction, {
          label: "Ведучий примусово завершив голосування",
          lobbyId: game.lobby_id
        });
        await resolveVoteTally(transaction, {
          activePlayers,
          ballots: activePlayers.flatMap((player) =>
            player.vote_target_player_id === null
              ? []
              : [
                  {
                    targetPlayerId: player.vote_target_player_id,
                    voterPlayerId: player.player_id
                  }
                ]
          ),
          candidatePlayerIds: game.voting_candidate_ids,
          cardState: parsePlaytestCardState(game.card_state),
          lobbyId: game.lobby_id,
          totalPlayerCount: players.length,
          votingAttempt: game.voting_attempt
        });
      });
      return requireGame(code, playerId);
    },
    proposeRollback: async (
      code,
      playerId,
      checkpointId,
      reason
    ) => {
      await synchronizeExpiredState(code);
      await sql.begin((transaction) =>
        proposeGameRollback(transaction, {
          checkpointId,
          code,
          playerId,
          reason
        })
      );
      return requireGame(code, playerId);
    },
    finishTurn: async (code, playerId) => {
      await synchronizeExpiredState(code);
      await sql.begin(async (transaction) => {
        const [turn] = await transaction<{
          readonly current_turn_position: number | null;
          readonly game_phase: string;
          readonly lobby_id: string;
          readonly player_position: number;
          readonly player_status: string;
          readonly round: number;
          readonly turn_active: boolean;
          readonly turn_stage: string | null;
        }[]>`
          SELECT
            lobbies.lobby_id::text,
            lobbies.game_phase,
            lobbies.round,
            lobbies.current_turn_position::integer,
            lobbies.turn_stage,
            players.position::integer AS player_position,
            players.game_status AS player_status,
            lobbies.turn_deadline IS NOT NULL
              AND lobbies.turn_deadline > now() AS turn_active
          FROM lobbies
          JOIN lobby_players AS players
            ON players.lobby_id = lobbies.lobby_id
          WHERE lobbies.code = ${code}
            AND lobbies.status = 'started'
            AND players.telegram_id = ${playerId}
          FOR UPDATE OF lobbies, players
        `;
        if (turn === undefined) {
          throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
        }
        await ensureGameNotRollbackPaused(transaction, turn.lobby_id);
        if (
          turn.game_phase !== "revealing" ||
          !turn.turn_active ||
          turn.player_status !== "active" ||
          turn.current_turn_position !== turn.player_position
        ) {
          throw new LobbyStoreError("NOT_YOUR_TURN");
        }
        if (turn.turn_stage !== "speaking") {
          throw new LobbyStoreError("TURN_NOT_READY_TO_FINISH");
        }
        await advanceAfterTurn(transaction, {
          lobbyId: turn.lobby_id,
          playerPosition: turn.player_position,
          round: turn.round
        });
      });
      return requireGame(code, playerId);
    },
    reveal: async (code, playerId, characteristicId) => {
      await synchronizeExpiredState(code);
      await sql.begin(async (transaction) => {
        const [turn] = await transaction<{
          readonly current_turn_position: number | null;
          readonly first_name: string;
          readonly game_phase: string;
          readonly lobby_id: string;
          readonly player_position: number;
          readonly player_status: string;
          readonly revealed_characteristics: readonly string[];
          readonly round: number;
          readonly turn_active: boolean;
          readonly turn_stage: string | null;
        }[]>`
          SELECT
            lobbies.lobby_id::text,
            lobbies.game_phase,
            lobbies.round,
            lobbies.current_turn_position::integer,
            lobbies.turn_stage,
            users.first_name,
            players.position::integer AS player_position,
            players.game_status AS player_status,
            players.revealed_characteristics,
            lobbies.turn_deadline IS NOT NULL
              AND lobbies.turn_deadline > now() AS turn_active
          FROM lobbies
          JOIN lobby_players AS players
            ON players.lobby_id = lobbies.lobby_id
          JOIN telegram_users AS users
            ON users.telegram_id = players.telegram_id
          WHERE lobbies.code = ${code}
            AND lobbies.status = 'started'
            AND players.telegram_id = ${playerId}
          FOR UPDATE OF lobbies, players
        `;
        if (turn === undefined) {
          throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
        }
        await ensureGameNotRollbackPaused(transaction, turn.lobby_id);
        if (
          turn.game_phase !== "revealing" ||
          turn.turn_stage !== "choosing" ||
          !turn.turn_active ||
          turn.player_status !== "active" ||
          turn.current_turn_position !== turn.player_position
        ) {
          throw new LobbyStoreError("NOT_YOUR_TURN");
        }
        if (turn.revealed_characteristics.includes(characteristicId)) {
          throw new LobbyStoreError(
            "CHARACTERISTIC_ALREADY_REVEALED"
          );
        }
        if (turn.round === 1 && characteristicId !== "profession") {
          throw new LobbyStoreError("MUST_REVEAL_PROFESSION_FIRST");
        }

        const characteristicLabel =
          CHARACTERISTIC_CATEGORIES.find(
            (category) => category.id === characteristicId
          )?.label ?? characteristicId;
        await createGameCheckpoint(transaction, {
          label: `Перед відкриттям «${characteristicLabel}»`,
          lobbyId: turn.lobby_id
        });
        const regenerated = await regenerateInvalidatedCharacteristic(
          transaction,
          {
            characteristicId,
            lobbyId: turn.lobby_id,
            playerId
          }
        );
        await transaction`
          UPDATE lobby_players
          SET
            revealed_characteristics = array_append(
              revealed_characteristics,
              ${characteristicId}
            ),
            disclosed_characteristics = CASE
              WHEN ${characteristicId} = ANY(disclosed_characteristics)
                THEN disclosed_characteristics
              ELSE array_append(disclosed_characteristics, ${characteristicId})
            END
          WHERE lobby_id = ${turn.lobby_id}
            AND telegram_id = ${playerId}
        `;
        await transaction`
          UPDATE lobbies
          SET
            turn_stage = 'speaking',
            turn_revealed_characteristic_id = ${characteristicId},
            last_event = ${
              regenerated.regenerated
                ? `${turn.first_name}: «${characteristicLabel}» перегенеровано після rollback і відкрито.`
                : `${turn.first_name} відкрив «${characteristicLabel}» і почав виступ.`
            }
          WHERE lobby_id = ${turn.lobby_id}
        `;
        const [revealed] = await transaction<{
          readonly branch_id: string;
          readonly character_profile: unknown;
        }[]>`
          SELECT
            lobbies.active_branch_id::text AS branch_id,
            players.character_profile
          FROM lobbies
          JOIN lobby_players AS players
            ON players.lobby_id = lobbies.lobby_id
          WHERE lobbies.lobby_id = ${turn.lobby_id}
            AND players.telegram_id = ${playerId}
        `;
        if (revealed !== undefined) {
          const profile = parseStoredCharacteristics(
            revealed.character_profile
          );
          await appendGameEvent(transaction, {
            branchId: revealed.branch_id,
            eventType: regenerated.regenerated
              ? "characteristic_regenerated_and_revealed"
              : "characteristic_revealed",
            lobbyId: turn.lobby_id,
            payload: {
              characteristicId,
              playerId,
              value: profile[characteristicId]
            }
          });
        }
      });
      return requireGame(code, playerId);
    },
    reactCard: async (code, playerId, selection, expectedReactionCount) => {
      await synchronizeExpiredState(code);
      await sql.begin(async (transaction) => {
        const [game] = await transaction<{
          readonly card_chain: unknown;
          readonly game_phase: string;
          readonly lobby_id: string;
          readonly player_card: unknown;
          readonly player_card_used: boolean;
          readonly player_status: string;
          readonly reaction_turn_seconds: number | null;
          readonly reaction_active: boolean;
          readonly resources: unknown;
        }[]>`
          SELECT
            lobbies.lobby_id::text,
            lobbies.game_phase,
            lobbies.card_chain,
            lobbies.reaction_turn_seconds,
            lobbies.reaction_deadline IS NOT NULL
              AND lobbies.reaction_deadline > now() AS reaction_active,
            lobbies.scenario_resources AS resources,
            players.special_card AS player_card,
            players.card_used AS player_card_used,
            players.game_status AS player_status
          FROM lobbies
          JOIN lobby_players AS players
            ON players.lobby_id = lobbies.lobby_id
          WHERE lobbies.code = ${code}
            AND lobbies.status = 'started'
            AND players.telegram_id = ${playerId}
          FOR UPDATE OF lobbies, players
        `;
        if (game === undefined) {
          throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
        }
        await ensureGameNotRollbackPaused(transaction, game.lobby_id);
        if (
          game.game_phase !== "reaction" ||
          !game.reaction_active ||
          game.card_chain === null ||
          game.player_status !== "active"
        ) {
          throw new LobbyStoreError("CARD_NOT_ALLOWED");
        }
        const card = parseStoredCard(game.player_card);
        const chain = parseStoredCardChain(game.card_chain);
        if (
          card.kind !== "reaction" ||
          game.player_card_used ||
          chain.actorPlayerId === playerId ||
          chain.reactions.length >= 2 ||
          chain.reactions.some(
            (reaction) => reaction.playerId === playerId
          )
        ) {
          throw new LobbyStoreError("CARD_NOT_AVAILABLE");
        }
        if (chain.reactions.length !== expectedReactionCount) {
          throw new LobbyStoreError("REACTION_CHAIN_CHANGED");
        }
        const definition = findPlaytestCardDefinition(card.id);
        const countersFirstReaction = chain.reactions.length === 1;
        const resolvedSelection: PlaytestCardSelection =
          countersFirstReaction ? {} : selection;
        if (!countersFirstReaction) {
          try {
            await validatePlaytestCardSelection(transaction, {
              actorPlayerId: playerId,
              card: definition,
              lobbyId: game.lobby_id,
              resources: parseStoredResources(game.resources),
              selection: resolvedSelection
            });
          } catch (error) {
            if (error instanceof PlaytestCardSelectionError) {
              throw new LobbyStoreError("INVALID_CARD_SELECTION");
            }
            throw error;
          }
          if (
            definition.effect.kind === "card" &&
            definition.effect.operation === "redirect" &&
            (chain.actionSelection.targetPlayerId === undefined ||
              findPlaytestCardDefinition(chain.action.id).target !==
                "any_non_afk_player")
          ) {
            throw new LobbyStoreError("INVALID_CARD_SELECTION");
          }
          if (
            definition.effect.kind === "player" &&
            definition.effect.operation === "protect" &&
            chain.actionSelection.targetPlayerId !== playerId
          ) {
            throw new LobbyStoreError("INVALID_CARD_SELECTION");
          }
        }

        await createGameCheckpoint(transaction, {
          label: `Перед реакцією «${card.title}»`,
          lobbyId: game.lobby_id
        });
        const updatedChain: StoredCardChain = {
          ...chain,
          reactions: [
            ...chain.reactions,
            {
              card,
              playerId,
              selection: resolvedSelection
            }
          ]
        };
        await transaction`
          UPDATE lobby_players
          SET card_used = true
          WHERE lobby_id = ${game.lobby_id}
            AND telegram_id = ${playerId}
        `;
        if (updatedChain.reactions.length >= 2) {
          await resolveReactionChain(transaction, {
            cardChain: updatedChain,
            lobbyId: game.lobby_id,
            reactionTurnSeconds: game.reaction_turn_seconds,
            resources: game.resources
          });
          return;
        }

        await transaction`
          UPDATE lobbies
          SET
            card_chain = ${transaction.json(
              updatedChain as unknown as postgres.JSONValue
            )},
            reaction_deadline =
              now() + ${reactionDurationSeconds} * interval '1 second',
            last_event = ${
              `Картка «${card.title}» стала першою реакцією. ` +
              "Доступна ще одна реакція."
            }
          WHERE lobby_id = ${game.lobby_id}
        `;
        await createGameCheckpoint(transaction, {
          label: "Після першої реакції",
          lobbyId: game.lobby_id
        });
      });
      return requireGame(code, playerId);
    },
    reorder: async (code, playerId, orderedPlayerIds) => {
      await sql.begin(async (transaction) => {
        const [target] = await transaction<{
          readonly host_player_id: string;
          readonly lobby_id: string;
          readonly status: string;
        }[]>`
          SELECT
            lobby_id::text,
            host_telegram_id::text AS host_player_id,
            status
          FROM lobbies
          WHERE code = ${code}
          FOR UPDATE
        `;
        if (target === undefined) {
          throw new LobbyStoreError("LOBBY_NOT_FOUND");
        }
        if (target.host_player_id !== playerId) {
          throw new LobbyStoreError("ONLY_HOST_CAN_REORDER");
        }
        if (target.status !== "waiting") {
          throw new LobbyStoreError("LOBBY_CLOSED");
        }
        const currentPlayers = await transaction<{
          readonly player_id: string;
          readonly ready: boolean;
        }[]>`
          SELECT
            telegram_id::text AS player_id,
            ready
          FROM lobby_players
          WHERE lobby_id = ${target.lobby_id}
          ORDER BY position
          FOR UPDATE
        `;
        const currentIds = new Set(
          currentPlayers.map((player) => player.player_id)
        );
        if (
          orderedPlayerIds.length !== currentPlayers.length ||
          new Set(orderedPlayerIds).size !== orderedPlayerIds.length ||
          orderedPlayerIds.some((id) => !currentIds.has(id))
        ) {
          throw new LobbyStoreError("INVALID_PLAYER_ORDER");
        }

        await transaction`
          DELETE FROM lobby_players
          WHERE lobby_id = ${target.lobby_id}
        `;
        for (const [index, orderedPlayerId] of orderedPlayerIds.entries()) {
          const player = currentPlayers.find(
            (entry) => entry.player_id === orderedPlayerId
          );
          await transaction`
            INSERT INTO lobby_players (
              lobby_id,
              telegram_id,
              position,
              ready
            )
            VALUES (
              ${target.lobby_id},
              ${orderedPlayerId},
              ${index + 1},
              ${player?.ready ?? false}
            )
          `;
        }
      });
      return requireLobby(code);
    },
    resumeRollback: async (code, playerId) => {
      await sql.begin((transaction) =>
        resumeGameAfterRollback(transaction, {
          code,
          discussionSeconds: discussionDurationSeconds,
          playerId,
          reactionSeconds: reactionDurationSeconds,
          turnSeconds: turnDurationSeconds
        })
      );
      return requireGame(code, playerId);
    },
    submitFinalOutcome: async (code, playerId, outcome) => {
      await sql.begin(async (transaction) => {
        const [game] = await transaction<{
          readonly game_phase: string;
          readonly host_player_id: string;
          readonly lobby_id: string;
        }[]>`
          SELECT
            lobby_id::text,
            host_telegram_id::text AS host_player_id,
            game_phase
          FROM lobbies
          WHERE code = ${code}
            AND status = 'started'
          FOR UPDATE
        `;
        if (game === undefined) {
          throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
        }
        await ensureGameNotRollbackPaused(transaction, game.lobby_id);
        if (game.host_player_id !== playerId) {
          throw new LobbyStoreError("ONLY_HOST_CAN_FINALIZE");
        }
        if (game.game_phase !== "final_check") {
          throw new LobbyStoreError("GAME_NOT_IN_FINAL");
        }
        const finalists = await transaction<
          Pick<MockGamePlayerRow, "character_profile" | "status">[]
        >`
          SELECT character_profile, game_status AS status
          FROM lobby_players
          WHERE lobby_id = ${game.lobby_id}
            AND game_status = 'active'
          ORDER BY position
        `;
        const demography = assessActivePlayersDemography(finalists);
        if (outcome === "all_survive" && !demography.preserved) {
          throw new LobbyStoreError("DEMOGRAPHY_NOT_PRESERVED");
        }
        await createGameCheckpoint(transaction, {
          label: "Перед фінальним рішенням ведучого",
          lobbyId: game.lobby_id
        });
        await transaction`
          UPDATE lobbies
          SET
            game_phase = 'completed',
            final_outcome = ${outcome}
          WHERE lobby_id = ${game.lobby_id}
        `;
      });
      return requireGame(code, playerId);
    },
    useCard: async (code, playerId, selection) => {
      await synchronizeExpiredState(code);
      await sql.begin(async (transaction) => {
        const [game] = await transaction<{
          readonly card_used: boolean;
          readonly current_turn_position: number | null;
          readonly game_phase: string;
          readonly lobby_id: string;
          readonly player_card: unknown;
          readonly player_position: number;
          readonly player_status: string;
          readonly remaining_seconds: number;
          readonly resources: unknown;
          readonly turn_active: boolean;
        }[]>`
          SELECT
            lobbies.lobby_id::text,
            lobbies.game_phase,
            lobbies.current_turn_position::integer,
            GREATEST(
              1,
              COALESCE(
                ceil(extract(epoch FROM lobbies.turn_deadline - now())),
                ${turnDurationSeconds}
              )
            )::integer AS remaining_seconds,
            players.position::integer AS player_position,
            players.game_status AS player_status,
            players.special_card AS player_card,
            players.card_used,
            lobbies.scenario_resources AS resources,
            lobbies.turn_deadline IS NOT NULL
              AND lobbies.turn_deadline > now() AS turn_active
          FROM lobbies
          JOIN lobby_players AS players
            ON players.lobby_id = lobbies.lobby_id
          WHERE lobbies.code = ${code}
            AND lobbies.status = 'started'
            AND players.telegram_id = ${playerId}
          FOR UPDATE OF lobbies, players
        `;
        if (game === undefined) {
          throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
        }
        await ensureGameNotRollbackPaused(transaction, game.lobby_id);
        if (
          game.game_phase !== "revealing" ||
          !game.turn_active ||
          game.current_turn_position !== game.player_position ||
          game.player_status !== "active"
        ) {
          throw new LobbyStoreError("CARD_NOT_ALLOWED");
        }
        const card = parseStoredCard(game.player_card);
        if (card.kind !== "action" || game.card_used) {
          throw new LobbyStoreError("CARD_NOT_AVAILABLE");
        }
        try {
          await validatePlaytestCardSelection(transaction, {
            actorPlayerId: playerId,
            card: findPlaytestCardDefinition(card.id),
            lobbyId: game.lobby_id,
            resources: parseStoredResources(game.resources),
            selection
          });
        } catch (error) {
          if (error instanceof PlaytestCardSelectionError) {
            throw new LobbyStoreError("INVALID_CARD_SELECTION");
          }
          throw error;
        }
        const chain: StoredCardChain = {
          action: card,
          actionSelection: selection,
          actorPlayerId: playerId,
          reactions: []
        };

        await createGameCheckpoint(transaction, {
          label: `Перед карткою «${card.title}»`,
          lobbyId: game.lobby_id
        });
        await transaction`
          UPDATE lobby_players
          SET card_used = true
          WHERE lobby_id = ${game.lobby_id}
            AND telegram_id = ${playerId}
        `;
        await transaction`
          UPDATE lobbies
          SET
            game_phase = 'reaction',
            turn_deadline = NULL,
            reaction_turn_seconds = ${game.remaining_seconds},
            card_chain = ${transaction.json(
              chain as unknown as postgres.JSONValue
            )},
            reaction_deadline =
              now() + ${reactionDurationSeconds} * interval '1 second',
            last_event = ${
              `Розіграно «${card.title}». ` +
              "В інших гравців є 15 секунд на реакцію."
            }
          WHERE lobby_id = ${game.lobby_id}
        `;
        await createGameCheckpoint(transaction, {
          label: "Початок вікна реакції",
          lobbyId: game.lobby_id
        });
      });
      return requireGame(code, playerId);
    },
    vote: async (code, playerId, targetPlayerId, votingAttempt) => {
      await sql.begin(async (transaction) => {
        const [game] = await transaction<{
          readonly card_state: unknown;
          readonly game_phase: string;
          readonly lobby_id: string;
          readonly voting_attempt: number;
          readonly voting_candidate_ids: readonly string[];
        }[]>`
          SELECT
            card_state,
            lobby_id::text,
            game_phase,
            voting_attempt::integer,
            voting_candidate_ids
          FROM lobbies
          WHERE code = ${code}
            AND status = 'started'
          FOR UPDATE
        `;
        if (game === undefined) {
          throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
        }
        await ensureGameNotRollbackPaused(transaction, game.lobby_id);
        if (game.game_phase !== "voting") {
          throw new LobbyStoreError("GAME_NOT_IN_VOTING");
        }
        if (game.voting_attempt !== votingAttempt) {
          throw new LobbyStoreError("VOTING_ATTEMPT_CHANGED");
        }
        const players = await transaction<{
          readonly player_id: string;
          readonly position: number;
          readonly status: string;
          readonly vote_target_player_id: string | null;
        }[]>`
          SELECT
            telegram_id::text AS player_id,
            position::integer,
            game_status AS status,
            vote_target_telegram_id::text AS vote_target_player_id
          FROM lobby_players
          WHERE lobby_id = ${game.lobby_id}
          ORDER BY position
          FOR UPDATE
        `;
        const voter = players.find(
          (player) => player.player_id === playerId
        );
        const target = players.find(
          (player) => player.player_id === targetPlayerId
        );
        const cardState = parsePlaytestCardState(game.card_state);
        if (voter === undefined) {
          throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
        }
        if (voter.vote_target_player_id !== null) {
          throw new LobbyStoreError("ALREADY_VOTED");
        }
        const allowedCandidate =
          (game.voting_candidate_ids.length === 0 ||
            game.voting_candidate_ids.includes(targetPlayerId)) &&
          !cardState.protectedVotePlayerIds.includes(targetPlayerId);
        if (
          voter.status !== "active" ||
          target === undefined ||
          target.status !== "active" ||
          targetPlayerId === playerId ||
          !allowedCandidate
        ) {
          throw new LobbyStoreError("INVALID_VOTE_TARGET");
        }

        await createGameCheckpoint(transaction, {
          label: "Перед голосом гравця",
          lobbyId: game.lobby_id
        });
        await transaction`
          UPDATE lobby_players
          SET vote_target_telegram_id = ${targetPlayerId}
          WHERE lobby_id = ${game.lobby_id}
            AND telegram_id = ${playerId}
        `;
        const activePlayers = players.filter(
          (player) => player.status === "active"
        );
        // A silenced voter's ballot never counts toward the tally, so the
        // game must not wait on it before resolving — otherwise an AFK
        // silenced player would stall voting forever.
        const expectedVoters = activePlayers.filter(
          (player) =>
            !cardState.silencedVoterPlayerIds.includes(player.player_id)
        );
        const submittedVotes = expectedVoters.filter(
          (player) =>
            player.player_id === playerId ||
            player.vote_target_player_id !== null
        ).length;
        if (submittedVotes < expectedVoters.length) {
          return;
        }

        await resolveVoteTally(transaction, {
          activePlayers,
          ballots: activePlayers.flatMap((player) => {
            const selectedTarget =
              player.player_id === playerId
                ? targetPlayerId
                : player.vote_target_player_id;
            return selectedTarget === null
              ? []
              : [
                  {
                    targetPlayerId: selectedTarget,
                    voterPlayerId: player.player_id
                  }
                ];
          }),
          candidatePlayerIds: game.voting_candidate_ids,
          cardState,
          lobbyId: game.lobby_id,
          totalPlayerCount: players.length,
          votingAttempt: game.voting_attempt
        });
      });
      return requireGame(code, playerId);
    },
    voteRollback: async (code, playerId, approve, proposalId) => {
      await sql.begin((transaction) =>
        voteForGameRollback(transaction, {
          approve,
          code,
          playerId,
          proposalId
        })
      );
      return requireGame(code, playerId);
    },
    setSecretGoalsEnabled: async (code, playerId, enabled) => {
      await sql.begin(async (transaction) => {
        const [target] = await transaction<{
          readonly host_player_id: string;
          readonly lobby_id: string;
          readonly status: string;
        }[]>`
          SELECT
            lobby_id::text,
            host_telegram_id::text AS host_player_id,
            status
          FROM lobbies
          WHERE code = ${code}
          FOR UPDATE
        `;
        if (target === undefined) {
          throw new LobbyStoreError("LOBBY_NOT_FOUND");
        }
        if (target.host_player_id !== playerId) {
          throw new LobbyStoreError("ONLY_HOST_CAN_TOGGLE_SECRET_GOALS");
        }
        if (target.status !== "waiting") {
          throw new LobbyStoreError("LOBBY_CLOSED");
        }

        await transaction`
          UPDATE lobbies
          SET secret_goals_enabled = ${enabled}
          WHERE lobby_id = ${target.lobby_id}
        `;
      });

      return requireLobby(code);
    },
    setReady: async (code, playerId, ready) => {
      const updated = await sql`
        UPDATE lobby_players AS players
        SET ready = ${ready}
        FROM lobbies
        WHERE lobbies.lobby_id = players.lobby_id
          AND lobbies.code = ${code}
          AND lobbies.status = 'waiting'
          AND players.telegram_id = ${playerId}
        RETURNING players.telegram_id
      `;
      if (updated.count === 0) {
        throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
      }

      return requireLobby(code);
    },
    start: async (code, playerId) => {
      await sql.begin(async (transaction) => {
        const [target] = await transaction<{
          readonly host_player_id: string;
          readonly lobby_id: string;
          readonly secret_goals_enabled: boolean;
          readonly status: string;
        }[]>`
          SELECT
            lobby_id::text,
            host_telegram_id::text AS host_player_id,
            secret_goals_enabled,
            status
          FROM lobbies
          WHERE code = ${code}
          FOR UPDATE
        `;
        if (target === undefined) {
          throw new LobbyStoreError("LOBBY_NOT_FOUND");
        }
        if (target.host_player_id !== playerId) {
          throw new LobbyStoreError("ONLY_HOST_CAN_START");
        }
        if (target.status === "started") {
          return;
        }
        if (target.status !== "waiting") {
          throw new LobbyStoreError("LOBBY_CLOSED");
        }

        const [readiness] = await transaction<{
          readonly all_ready: boolean;
          readonly player_count: number;
        }[]>`
          SELECT
            bool_and(ready) AS all_ready,
            count(*)::integer AS player_count
          FROM lobby_players
          WHERE lobby_id = ${target.lobby_id}
        `;
        if (
          readiness === undefined ||
          readiness.player_count < MIN_GAME_PLAYERS ||
          readiness.player_count > MAX_GAME_PLAYERS
        ) {
          throw new LobbyStoreError(
            "PLAYTEST_REQUIRES_FOUR_TO_SIXTEEN_PLAYERS"
          );
        }
        if (!readiness.all_ready) {
          throw new LobbyStoreError("PLAYERS_NOT_READY");
        }

        const players = await transaction<{
          readonly player_id: string;
        }[]>`
          SELECT telegram_id::text AS player_id
          FROM lobby_players
          WHERE lobby_id = ${target.lobby_id}
          ORDER BY position
          FOR UPDATE
        `;
        const cards = dealPlaytestCards(players.length);
        const dossiers = createPlaytestDossiers(players.length);
        for (const [index, player] of players.entries()) {
          const dossier = dossiers[index];
          const card = cards[index];
          if (card === undefined || dossier === undefined) {
            throw new Error("Could not deal the playtest setup");
          }
          await transaction`
            UPDATE lobby_players
            SET
              character_profile = ${transaction.json(
                dossier.characteristics
              )},
              secret_goal = ${
                target.secret_goals_enabled ? dossier.secretGoal : null
              },
              special_card = ${transaction.json(card)},
              card_used = false,
              card_private_result = NULL,
              inspected_characteristics = ARRAY[]::text[],
              revealed_characteristics = ARRAY[]::text[],
              invalidated_characteristics = ARRAY[]::text[],
              game_status = 'active',
              vote_target_telegram_id = NULL
            WHERE lobby_id = ${target.lobby_id}
              AND telegram_id = ${player.player_id}
          `;
        }

        await transaction`
          UPDATE lobbies
          SET
            status = 'started',
            game_phase = 'scenario_intro',
            round = 1,
            current_turn_position = NULL,
            voting_attempt = 1,
            voting_candidate_ids = ARRAY[]::text[],
            final_outcome = NULL,
            scenario_resources = ${transaction.json(
              initialScenarioResources
            )},
            turn_deadline = NULL,
            turn_stage = NULL,
            turn_revealed_characteristic_id = NULL,
            card_chain = NULL,
            card_state = ${transaction.json(emptyPlaytestCardState() as unknown as postgres.JSONValue)},
            reaction_deadline = NULL,
            reaction_turn_seconds = NULL,
            rollback_paused = false,
            last_event = NULL
          WHERE lobby_id = ${target.lobby_id}
        `;
        await createInitialGameBranch(transaction, {
          createdByPlayerId: playerId,
          label: "Оголошення катастрофи",
          lobbyId: target.lobby_id
        });
      });

      return requireLobby(code);
    }
  };
}
