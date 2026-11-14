import { createHash, randomUUID } from "node:crypto";

import type postgres from "postgres";

export interface SnapshotLobby {
  readonly cardChain: unknown;
  readonly cardState: unknown;
  readonly currentTurnPosition: number | null;
  readonly finalOutcome: string | null;
  readonly gamePhase: string;
  readonly lastEvent: string | null;
  readonly reactionDeadline: string | null;
  readonly reactionTurnSeconds: number | null;
  readonly round: number;
  readonly scenarioResources: unknown;
  readonly turnDeadline: string | null;
  readonly turnRevealedCharacteristicId: string | null;
  readonly turnStage: string | null;
  readonly votingAttempt: number;
  readonly votingCandidateIds: readonly string[];
}

export interface SnapshotPlayer {
  readonly cardPrivateResult: string | null;
  readonly cardUsed: boolean;
  readonly characterProfile: unknown;
  readonly disclosedCharacteristics: readonly string[];
  readonly gameStatus: string;
  readonly inspectedCharacteristics: readonly string[];
  readonly invalidatedCharacteristics: readonly string[];
  readonly playerId: string;
  readonly position: number;
  readonly revealedCharacteristics: readonly string[];
  readonly secretGoal: string | null;
  readonly specialCard: unknown;
  readonly voteTargetPlayerId: string | null;
}

export interface GameSnapshot {
  readonly lobby: SnapshotLobby;
  readonly players: readonly SnapshotPlayer[];
}

export interface GameCheckpointRow {
  readonly branch_id: string;
  readonly checksum: string;
  readonly checkpoint_id: string;
  readonly label: string;
  readonly phase: string;
  readonly round: number;
  readonly state: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

export function checkpointSnapshotChecksum(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function parseSnapshot(value: unknown): GameSnapshot {
  if (
    !isRecord(value) ||
    !isRecord(value.lobby) ||
    !Array.isArray(value.players)
  ) {
    throw new Error("Rollback checkpoint contains an invalid snapshot");
  }
  const lobby = value.lobby;
  if (
    typeof lobby.gamePhase !== "string" ||
    !Number.isInteger(lobby.round) ||
    !Number.isInteger(lobby.votingAttempt) ||
    !Array.isArray(lobby.votingCandidateIds)
  ) {
    throw new Error("Rollback checkpoint contains an invalid lobby state");
  }
  const players = value.players.map((player, index) => {
    if (
      !isRecord(player) ||
      typeof player.playerId !== "string" ||
      (player.position !== undefined && !Number.isInteger(player.position)) ||
      !Array.isArray(player.revealedCharacteristics) ||
      !Array.isArray(player.invalidatedCharacteristics) ||
      typeof player.cardUsed !== "boolean" ||
      typeof player.gameStatus !== "string"
    ) {
      throw new Error("Rollback checkpoint contains an invalid player state");
    }
    return {
      ...(player as unknown as SnapshotPlayer),
      position: Number.isInteger(player.position)
        ? (player.position as number)
        : index + 1
    };
  });
  return {
    lobby: {
      ...(lobby as unknown as SnapshotLobby),
      cardState: lobby.cardState ?? {}
    },
    players: players.map((player) => {
      const inspectedCharacteristics: readonly string[] = Array.isArray(
        player.inspectedCharacteristics
      )
        ? player.inspectedCharacteristics
        : [];
      return {
        ...player,
        cardPrivateResult:
          typeof player.cardPrivateResult === "string"
            ? player.cardPrivateResult
            : null,
        disclosedCharacteristics: Array.isArray(
          player.disclosedCharacteristics
        )
          ? player.disclosedCharacteristics
          : [
              ...new Set([
                ...player.revealedCharacteristics,
                ...inspectedCharacteristics
              ])
            ],
        inspectedCharacteristics
      };
    })
  };
}

export function verifyCheckpointSnapshot(
  checkpoint: Pick<GameCheckpointRow, "checksum" | "state">
) {
  if (
    checkpointSnapshotChecksum(checkpoint.state) !== checkpoint.checksum
  ) {
    throw new Error("Rollback checkpoint checksum does not match");
  }
  return parseSnapshot(checkpoint.state);
}

async function captureSnapshot(
  transaction: postgres.TransactionSql,
  lobbyId: string
): Promise<GameSnapshot> {
  const [lobby] = await transaction<{
    readonly card_chain: unknown;
    readonly card_state: unknown;
    readonly current_turn_position: number | null;
    readonly final_outcome: string | null;
    readonly game_phase: string;
    readonly last_event: string | null;
    readonly reaction_deadline: Date | null;
    readonly reaction_turn_seconds: number | null;
    readonly round: number;
    readonly scenario_resources: unknown;
    readonly turn_deadline: Date | null;
    readonly turn_revealed_characteristic_id: string | null;
    readonly turn_stage: string | null;
    readonly voting_attempt: number;
    readonly voting_candidate_ids: readonly string[];
  }[]>`
    SELECT
      game_phase,
      round::integer,
      current_turn_position::integer,
      voting_attempt::integer,
      voting_candidate_ids,
      final_outcome,
      scenario_resources,
      turn_deadline,
      turn_stage,
      turn_revealed_characteristic_id,
      card_chain,
      card_state,
      reaction_deadline,
      reaction_turn_seconds,
      last_event
    FROM lobbies
    WHERE lobby_id = ${lobbyId}
    FOR UPDATE
  `;
  if (lobby === undefined) {
    throw new Error("Cannot snapshot a missing game");
  }
  const players = await transaction<{
    readonly card_used: boolean;
    readonly card_private_result: string | null;
    readonly character_profile: unknown;
    readonly disclosed_characteristics: readonly string[];
    readonly game_status: string;
    readonly inspected_characteristics: readonly string[];
    readonly invalidated_characteristics: readonly string[];
    readonly player_id: string;
    readonly position: number;
    readonly revealed_characteristics: readonly string[];
    readonly secret_goal: string | null;
    readonly special_card: unknown;
    readonly vote_target_player_id: string | null;
  }[]>`
    SELECT
      telegram_id::text AS player_id,
      position::integer,
      revealed_characteristics,
      invalidated_characteristics,
      disclosed_characteristics,
      character_profile,
      secret_goal,
      special_card,
      card_used,
      card_private_result,
      inspected_characteristics,
      game_status,
      vote_target_telegram_id::text AS vote_target_player_id
    FROM lobby_players
    WHERE lobby_id = ${lobbyId}
    ORDER BY position
    FOR UPDATE
  `;
  return {
    lobby: {
      cardChain: lobby.card_chain,
      cardState: lobby.card_state,
      currentTurnPosition: lobby.current_turn_position,
      finalOutcome: lobby.final_outcome,
      gamePhase: lobby.game_phase,
      lastEvent: lobby.last_event,
      reactionDeadline: lobby.reaction_deadline?.toISOString() ?? null,
      reactionTurnSeconds: lobby.reaction_turn_seconds,
      round: lobby.round,
      scenarioResources: lobby.scenario_resources,
      turnDeadline: lobby.turn_deadline?.toISOString() ?? null,
      turnRevealedCharacteristicId:
        lobby.turn_revealed_characteristic_id,
      turnStage: lobby.turn_stage,
      votingAttempt: lobby.voting_attempt,
      votingCandidateIds: lobby.voting_candidate_ids
    },
    players: players.map((player) => ({
      cardPrivateResult: player.card_private_result,
      cardUsed: player.card_used,
      characterProfile: player.character_profile,
      disclosedCharacteristics: player.disclosed_characteristics,
      gameStatus: player.game_status,
      inspectedCharacteristics: player.inspected_characteristics,
      invalidatedCharacteristics: player.invalidated_characteristics,
      playerId: player.player_id,
      position: player.position,
      revealedCharacteristics: player.revealed_characteristics,
      secretGoal: player.secret_goal,
      specialCard: player.special_card,
      voteTargetPlayerId: player.vote_target_player_id
    }))
  };
}

export async function appendGameEvent(
  transaction: postgres.TransactionSql,
  input: {
    readonly branchId: string;
    readonly eventType: string;
    readonly lobbyId: string;
    readonly payload?: unknown;
  }
) {
  const [row] = await transaction<{ readonly revision: number }[]>`
    SELECT COALESCE(max(revision), 0)::integer + 1 AS revision
    FROM game_events
    WHERE branch_id = ${input.branchId}
  `;
  const revision = row?.revision ?? 1;
  await transaction`
    INSERT INTO game_events (
      event_id,
      lobby_id,
      branch_id,
      revision,
      event_type,
      payload
    )
    VALUES (
      ${randomUUID()},
      ${input.lobbyId},
      ${input.branchId},
      ${revision},
      ${input.eventType},
      ${transaction.json(
        (input.payload ?? {}) as postgres.JSONValue
      )}
    )
  `;
  return revision;
}

export async function createGameCheckpoint(
  transaction: postgres.TransactionSql,
  input: {
    readonly label: string;
    readonly lobbyId: string;
  }
) {
  const [game] = await transaction<{
    readonly active_branch_id: string | null;
    readonly game_phase: string;
    readonly round: number;
  }[]>`
    SELECT active_branch_id::text, game_phase, round::integer
    FROM lobbies
    WHERE lobby_id = ${input.lobbyId}
    FOR UPDATE
  `;
  if (game?.active_branch_id === null || game === undefined) {
    throw new Error("Started game is missing an active branch");
  }
  const state = await captureSnapshot(transaction, input.lobbyId);
  const checkpointId = randomUUID();
  const eventRevision = await appendGameEvent(transaction, {
    branchId: game.active_branch_id,
    eventType: "checkpoint_created",
    lobbyId: input.lobbyId,
    payload: { checkpointId, label: input.label }
  });
  await transaction`
    INSERT INTO game_checkpoints (
      checkpoint_id,
      lobby_id,
      branch_id,
      round,
      phase,
      label,
      state,
      checksum,
      event_revision
    )
    VALUES (
      ${checkpointId},
      ${input.lobbyId},
      ${game.active_branch_id},
      ${game.round},
      ${game.game_phase},
      ${input.label},
      ${transaction.json(state as unknown as postgres.JSONValue)},
      ${checkpointSnapshotChecksum(state)},
      ${eventRevision}
    )
  `;
  return checkpointId;
}

export async function createInitialGameBranch(
  transaction: postgres.TransactionSql,
  input: {
    readonly createdByPlayerId: string;
    readonly label: string;
    readonly lobbyId: string;
  }
) {
  const branchId = randomUUID();
  await transaction`
    INSERT INTO game_branches (
      branch_id,
      lobby_id,
      created_by_telegram_id,
      reason
    )
    VALUES (
      ${branchId},
      ${input.lobbyId},
      ${input.createdByPlayerId},
      'Початок партії'
    )
  `;
  await transaction`
    UPDATE lobbies
    SET active_branch_id = ${branchId}, rollback_paused = false
    WHERE lobby_id = ${input.lobbyId}
  `;
  await createGameCheckpoint(transaction, {
    label: input.label,
    lobbyId: input.lobbyId
  });
  return branchId;
}

export async function setupGameRollbackSchema(
  transaction: postgres.TransactionSql
) {
  await transaction`
    ALTER TABLE lobby_players
    ADD COLUMN IF NOT EXISTS invalidated_characteristics text[] NOT NULL
      DEFAULT ARRAY[]::text[]
  `;
  await transaction`
    ALTER TABLE lobby_players
    ADD COLUMN IF NOT EXISTS disclosed_characteristics text[] NOT NULL
      DEFAULT ARRAY[]::text[]
  `;
  await transaction`
    ALTER TABLE lobbies
    ADD COLUMN IF NOT EXISTS random_bindings jsonb NOT NULL
      DEFAULT '{}'::jsonb
  `;
  await transaction`
    UPDATE lobby_players
    SET disclosed_characteristics = (
      SELECT array_agg(DISTINCT value)
      FROM unnest(
        revealed_characteristics || inspected_characteristics
      ) AS value
    )
    WHERE disclosed_characteristics = ARRAY[]::text[]
      AND (
        cardinality(revealed_characteristics) > 0
        OR cardinality(inspected_characteristics) > 0
      )
  `;
  await transaction`
    ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS active_branch_id uuid
  `;
  await transaction`
    ALTER TABLE lobbies
    ADD COLUMN IF NOT EXISTS rollback_paused boolean NOT NULL DEFAULT false
  `;
  await transaction`
    CREATE TABLE IF NOT EXISTS game_branches (
      branch_id uuid PRIMARY KEY,
      lobby_id uuid NOT NULL REFERENCES lobbies(lobby_id) ON DELETE CASCADE,
      parent_branch_id uuid REFERENCES game_branches(branch_id),
      fork_checkpoint_id uuid,
      created_by_telegram_id bigint NOT NULL,
      reason text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await transaction`
    CREATE TABLE IF NOT EXISTS game_events (
      event_id uuid PRIMARY KEY,
      lobby_id uuid NOT NULL REFERENCES lobbies(lobby_id) ON DELETE CASCADE,
      branch_id uuid NOT NULL REFERENCES game_branches(branch_id) ON DELETE CASCADE,
      revision integer NOT NULL,
      event_type text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (branch_id, revision)
    )
  `;
  await transaction`
    CREATE TABLE IF NOT EXISTS game_checkpoints (
      checkpoint_id uuid PRIMARY KEY,
      lobby_id uuid NOT NULL REFERENCES lobbies(lobby_id) ON DELETE CASCADE,
      branch_id uuid NOT NULL REFERENCES game_branches(branch_id) ON DELETE CASCADE,
      round integer NOT NULL,
      phase text NOT NULL,
      label text NOT NULL,
      state jsonb NOT NULL,
      checksum char(64) NOT NULL,
      event_revision integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await transaction`
    CREATE INDEX IF NOT EXISTS game_checkpoints_active_lookup
    ON game_checkpoints (lobby_id, branch_id, round, created_at DESC)
  `;
  await transaction`
    CREATE TABLE IF NOT EXISTS rollback_proposals (
      proposal_id uuid PRIMARY KEY,
      lobby_id uuid NOT NULL REFERENCES lobbies(lobby_id) ON DELETE CASCADE,
      branch_id uuid NOT NULL REFERENCES game_branches(branch_id) ON DELETE CASCADE,
      checkpoint_id uuid NOT NULL REFERENCES game_checkpoints(checkpoint_id) ON DELETE CASCADE,
      initiated_by_telegram_id bigint NOT NULL,
      reason text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz,
      CONSTRAINT rollback_proposals_status_check
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
    )
  `;
  await transaction`
    CREATE UNIQUE INDEX IF NOT EXISTS rollback_proposals_one_pending
    ON rollback_proposals (lobby_id)
    WHERE status = 'pending'
  `;
  await transaction`
    CREATE TABLE IF NOT EXISTS rollback_votes (
      proposal_id uuid NOT NULL REFERENCES rollback_proposals(proposal_id) ON DELETE CASCADE,
      telegram_id bigint NOT NULL,
      approve boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (proposal_id, telegram_id)
    )
  `;

  const unbranchedGames = await transaction<{
    readonly host_player_id: string;
    readonly lobby_id: string;
  }[]>`
    SELECT
      lobby_id::text,
      host_telegram_id::text AS host_player_id
    FROM lobbies
    WHERE status = 'started'
      AND active_branch_id IS NULL
    FOR UPDATE
  `;
  for (const game of unbranchedGames) {
    await createInitialGameBranch(transaction, {
      createdByPlayerId: game.host_player_id,
      label: "Стан гри після оновлення",
      lobbyId: game.lobby_id
    });
  }
}
