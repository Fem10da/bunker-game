import { randomUUID } from "node:crypto";

import postgres from "postgres";

import {
  PLAYTEST_PHASES,
  type PlaytestPhase,
  type PlaytestRollbackView
} from "@bunker/contracts";

import {
  appendGameEvent,
  createGameCheckpoint,
  type GameCheckpointRow,
  verifyCheckpointSnapshot
} from "./game-checkpoints.js";

export {
  chooseRegeneratedValue,
  regenerateInvalidatedCharacteristic
} from "./game-rollback-random.js";

export {
  appendGameEvent,
  createGameCheckpoint,
  createInitialGameBranch,
  setupGameRollbackSchema
} from "./game-checkpoints.js";

export type GameRollbackErrorCode =
  | "ALREADY_VOTED_ROLLBACK"
  | "CHECKPOINT_NOT_FOUND"
  | "GAME_PAUSED_FOR_ROLLBACK"
  | "ONLY_HOST_CAN_ROLLBACK"
  | "ROLLBACK_ALREADY_PENDING"
  | "ROLLBACK_NOT_PENDING";

export class GameRollbackError extends Error {
  readonly code: GameRollbackErrorCode;

  constructor(code: GameRollbackErrorCode) {
    super(code);
    this.name = "GameRollbackError";
    this.code = code;
  }
}

interface ProposalContext {
  readonly activeBranchId: string;
  readonly checkpoint: GameCheckpointRow;
  readonly hostPlayerId: string;
  readonly lobbyId: string;
}

function isPlaytestPhase(value: string): value is PlaytestPhase {
  return PLAYTEST_PHASES.some((phase) => phase === value);
}

export function requiredRollbackApprovals(activePlayers: number) {
  if (!Number.isInteger(activePlayers) || activePlayers < 1) {
    throw new Error("Rollback vote requires at least one active player");
  }
  return Math.floor(activePlayers / 2) + 1;
}

export async function ensureGameNotRollbackPaused(
  transaction: postgres.TransactionSql,
  lobbyId: string
) {
  const [game] = await transaction<{
    readonly paused: boolean;
  }[]>`
    SELECT
      rollback_paused OR EXISTS (
        SELECT 1
        FROM rollback_proposals
        WHERE rollback_proposals.lobby_id = lobbies.lobby_id
          AND status = 'pending'
      ) AS paused
    FROM lobbies
    WHERE lobby_id = ${lobbyId}
    FOR UPDATE
  `;
  if (game?.paused === true) {
    throw new GameRollbackError("GAME_PAUSED_FOR_ROLLBACK");
  }
}

export async function isGameRollbackPaused(
  transaction: postgres.TransactionSql,
  lobbyId: string
) {
  const [game] = await transaction<{ readonly paused: boolean }[]>`
    SELECT
      rollback_paused OR EXISTS (
        SELECT 1
        FROM rollback_proposals
        WHERE rollback_proposals.lobby_id = lobbies.lobby_id
          AND status = 'pending'
      ) AS paused
    FROM lobbies
    WHERE lobby_id = ${lobbyId}
  `;
  return game?.paused ?? false;
}

async function requireProposalContext(
  transaction: postgres.TransactionSql,
  input: {
    readonly checkpointId: string;
    readonly code: string;
    readonly playerId: string;
  }
): Promise<ProposalContext> {
  const [game] = await transaction<{
    readonly active_branch_id: string | null;
    readonly host_player_id: string;
    readonly lobby_id: string;
    readonly rollback_paused: boolean;
    readonly round: number;
  }[]>`
    SELECT
      lobbies.lobby_id::text,
      lobbies.host_telegram_id::text AS host_player_id,
      lobbies.active_branch_id::text,
      lobbies.round::integer,
      lobbies.rollback_paused
    FROM lobbies
    WHERE lobbies.code = ${input.code}
      AND lobbies.status = 'started'
    FOR UPDATE
  `;
  if (game === undefined || game.active_branch_id === null) {
    throw new GameRollbackError("CHECKPOINT_NOT_FOUND");
  }
  if (game.host_player_id !== input.playerId) {
    throw new GameRollbackError("ONLY_HOST_CAN_ROLLBACK");
  }
  if (game.rollback_paused) {
    throw new GameRollbackError("GAME_PAUSED_FOR_ROLLBACK");
  }
  const [pending] = await transaction`
    SELECT proposal_id
    FROM rollback_proposals
    WHERE lobby_id = ${game.lobby_id}
      AND status = 'pending'
  `;
  if (pending !== undefined) {
    throw new GameRollbackError("ROLLBACK_ALREADY_PENDING");
  }
  const [checkpoint] = await transaction<GameCheckpointRow[]>`
    SELECT
      checkpoint_id::text,
      branch_id::text,
      round::integer,
      phase,
      label,
      state,
      checksum::text
    FROM game_checkpoints
    WHERE checkpoint_id = ${input.checkpointId}
      AND lobby_id = ${game.lobby_id}
      AND branch_id = ${game.active_branch_id}
      AND round = ${game.round}
    FOR UPDATE
  `;
  if (checkpoint === undefined) {
    throw new GameRollbackError("CHECKPOINT_NOT_FOUND");
  }
  return {
    activeBranchId: game.active_branch_id,
    checkpoint,
    hostPlayerId: game.host_player_id,
    lobbyId: game.lobby_id
  };
}

export async function proposeGameRollback(
  transaction: postgres.TransactionSql,
  input: {
    readonly checkpointId: string;
    readonly code: string;
    readonly playerId: string;
    readonly reason: string;
  }
) {
  const context = await requireProposalContext(transaction, input);
  const proposalId = randomUUID();
  await transaction`
    INSERT INTO rollback_proposals (
      proposal_id,
      lobby_id,
      branch_id,
      checkpoint_id,
      initiated_by_telegram_id,
      reason
    )
    VALUES (
      ${proposalId},
      ${context.lobbyId},
      ${context.activeBranchId},
      ${input.checkpointId},
      ${input.playerId},
      ${input.reason}
    )
  `;
  await transaction`
    INSERT INTO rollback_votes (proposal_id, telegram_id, approve)
    VALUES (${proposalId}, ${input.playerId}, true)
  `;
  await appendGameEvent(transaction, {
    branchId: context.activeBranchId,
    eventType: "rollback_proposed",
    lobbyId: context.lobbyId,
    payload: {
      checkpointId: input.checkpointId,
      playerId: input.playerId,
      reason: input.reason
    }
  });
}

async function rejectProposal(
  transaction: postgres.TransactionSql,
  input: {
    readonly proposalId: string;
  }
) {
  await transaction`
    UPDATE lobbies
    SET
      turn_deadline = CASE
        WHEN turn_deadline IS NULL THEN NULL
        ELSE turn_deadline + (
          now() - (
            SELECT created_at
            FROM rollback_proposals
            WHERE proposal_id = ${input.proposalId}
          )
        )
      END,
      reaction_deadline = CASE
        WHEN reaction_deadline IS NULL THEN NULL
        ELSE reaction_deadline + (
          now() - (
            SELECT created_at
            FROM rollback_proposals
            WHERE proposal_id = ${input.proposalId}
          )
        )
      END
    WHERE lobby_id = (
      SELECT lobby_id
      FROM rollback_proposals
      WHERE proposal_id = ${input.proposalId}
    )
  `;
  await transaction`
    UPDATE rollback_proposals
    SET status = 'rejected', resolved_at = now()
    WHERE proposal_id = ${input.proposalId}
  `;
}

async function restoreCheckpoint(
  transaction: postgres.TransactionSql,
  input: {
    readonly checkpoint: GameCheckpointRow;
    readonly lobbyId: string;
    readonly oldBranchId: string;
    readonly playerId: string;
    readonly proposalId: string;
    readonly reason: string;
  }
) {
  const snapshot = verifyCheckpointSnapshot(input.checkpoint);
  if (!isPlaytestPhase(snapshot.lobby.gamePhase)) {
    throw new Error("Rollback checkpoint contains an unsupported phase");
  }
  const currentPlayers = await transaction<{
    readonly disclosed_characteristics: readonly string[];
    readonly inspected_characteristics: readonly string[];
    readonly player_id: string;
    readonly position: number;
    readonly revealed_characteristics: readonly string[];
  }[]>`
    SELECT
      telegram_id::text AS player_id,
      disclosed_characteristics,
      inspected_characteristics,
      position::integer,
      revealed_characteristics
    FROM lobby_players
    WHERE lobby_id = ${input.lobbyId}
    ORDER BY position
    FOR UPDATE
  `;
  const currentSecrets = new Map(
    currentPlayers.map((player) => [
      player.player_id,
      {
        disclosed: player.disclosed_characteristics,
        inspected: player.inspected_characteristics,
        revealed: player.revealed_characteristics
      }
    ])
  );
  const branchId = randomUUID();
  await transaction`
    INSERT INTO game_branches (
      branch_id,
      lobby_id,
      parent_branch_id,
      fork_checkpoint_id,
      created_by_telegram_id,
      reason
    )
    VALUES (
      ${branchId},
      ${input.lobbyId},
      ${input.oldBranchId},
      ${input.checkpoint.checkpoint_id},
      ${input.playerId},
      ${input.reason}
    )
  `;
  await transaction`
    UPDATE lobbies
    SET
      active_branch_id = ${branchId},
      game_phase = ${snapshot.lobby.gamePhase},
      round = ${snapshot.lobby.round},
      current_turn_position = ${snapshot.lobby.currentTurnPosition},
      voting_attempt = ${snapshot.lobby.votingAttempt},
      voting_candidate_ids = ${snapshot.lobby.votingCandidateIds},
      final_outcome = ${snapshot.lobby.finalOutcome},
      scenario_resources = ${transaction.json(
        snapshot.lobby.scenarioResources as postgres.JSONValue
      )},
      turn_deadline = NULL,
      turn_stage = ${snapshot.lobby.turnStage},
      turn_revealed_characteristic_id =
        ${snapshot.lobby.turnRevealedCharacteristicId},
      card_chain = ${transaction.json(
        snapshot.lobby.cardChain as postgres.JSONValue
      )},
      card_state = ${transaction.json(
        snapshot.lobby.cardState as postgres.JSONValue
      )},
      reaction_deadline = NULL,
      reaction_turn_seconds = ${snapshot.lobby.reactionTurnSeconds},
      rollback_paused = true,
      last_event = 'Стан відновлено. Ведучий має перевірити гру й продовжити.'
    WHERE lobby_id = ${input.lobbyId}
  `;
  const playerPositions = new Map(
    currentPlayers.map((player) => [player.player_id, player.position])
  );
  await transaction`SET CONSTRAINTS lobby_players_lobby_id_position_key DEFERRED`;
  for (const player of snapshot.players) {
    const currentPosition = playerPositions.get(player.playerId);
    if (currentPosition === undefined || currentPosition === player.position) {
      continue;
    }
    await transaction`
      UPDATE lobby_players
      SET position = ${player.position}
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id = ${player.playerId}
    `;
    playerPositions.set(player.playerId, player.position);
  }
  for (const player of snapshot.players) {
    const current = currentSecrets.get(player.playerId);
    const everDisclosed = [
      ...new Set([
        ...player.disclosedCharacteristics,
        ...(current?.disclosed ?? [])
      ])
    ];
    const invalidated = [
      ...new Set([
        ...player.invalidatedCharacteristics,
        ...everDisclosed.filter(
          (id) =>
            !player.revealedCharacteristics.includes(id) &&
            !player.inspectedCharacteristics.includes(id)
        )
      ])
    ];
    await transaction`
      UPDATE lobby_players
      SET
        revealed_characteristics = ${player.revealedCharacteristics},
        invalidated_characteristics = ${invalidated},
        disclosed_characteristics = ${everDisclosed},
        inspected_characteristics = ${player.inspectedCharacteristics},
        character_profile = ${transaction.json(
          player.characterProfile as postgres.JSONValue
        )},
        secret_goal = ${player.secretGoal},
        special_card = ${transaction.json(
          player.specialCard as postgres.JSONValue
        )},
        card_used = ${player.cardUsed},
        card_private_result = ${player.cardPrivateResult},
        game_status = ${player.gameStatus},
        vote_target_telegram_id = ${player.voteTargetPlayerId}
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id = ${player.playerId}
    `;
  }
  await transaction`
    UPDATE rollback_proposals
    SET status = 'approved', resolved_at = now()
    WHERE proposal_id = ${input.proposalId}
  `;
  await appendGameEvent(transaction, {
    branchId: input.oldBranchId,
    eventType: "rollback_forked",
    lobbyId: input.lobbyId,
    payload: {
      checkpointId: input.checkpoint.checkpoint_id,
      newBranchId: branchId,
      proposalId: input.proposalId
    }
  });
  await appendGameEvent(transaction, {
    branchId,
    eventType: "rollback_restored",
    lobbyId: input.lobbyId,
    payload: {
      checkpointId: input.checkpoint.checkpoint_id,
      parentBranchId: input.oldBranchId,
      proposalId: input.proposalId
    }
  });
  await createGameCheckpoint(transaction, {
    label: `Відновлено: ${input.checkpoint.label}`,
    lobbyId: input.lobbyId
  });
}

export async function voteForGameRollback(
  transaction: postgres.TransactionSql,
  input: {
    readonly approve: boolean;
    readonly code: string;
    readonly playerId: string;
    readonly proposalId: string;
  }
) {
  const [proposal] = await transaction<{
    readonly active_branch_id: string;
    readonly checkpoint_id: string;
    readonly initiated_by_player_id: string;
    readonly lobby_id: string;
    readonly proposal_id: string;
    readonly reason: string;
  }[]>`
    SELECT
      proposals.proposal_id::text,
      proposals.lobby_id::text,
      proposals.checkpoint_id::text,
      proposals.initiated_by_telegram_id::text AS initiated_by_player_id,
      proposals.branch_id::text AS active_branch_id,
      proposals.reason
    FROM rollback_proposals AS proposals
    JOIN lobbies ON lobbies.lobby_id = proposals.lobby_id
    JOIN lobby_players AS players
      ON players.lobby_id = proposals.lobby_id
    WHERE lobbies.code = ${input.code}
      AND proposals.proposal_id = ${input.proposalId}
      AND proposals.status = 'pending'
      AND players.telegram_id = ${input.playerId}
      AND players.game_status = 'active'
    FOR UPDATE OF proposals, lobbies
  `;
  if (proposal === undefined) {
    throw new GameRollbackError("ROLLBACK_NOT_PENDING");
  }
  try {
    await transaction`
      INSERT INTO rollback_votes (proposal_id, telegram_id, approve)
      VALUES (${proposal.proposal_id}, ${input.playerId}, ${input.approve})
    `;
  } catch (error) {
    if (
      error instanceof postgres.PostgresError &&
      error.code === "23505"
    ) {
      throw new GameRollbackError("ALREADY_VOTED_ROLLBACK");
    }
    throw error;
  }
  const [totals] = await transaction<{
    readonly active_players: number;
    readonly approvals: number;
    readonly votes: number;
  }[]>`
    SELECT
      count(*) FILTER (WHERE votes.approve)::integer AS approvals,
      count(votes.telegram_id)::integer AS votes,
      (
        SELECT count(*)::integer
        FROM lobby_players
        WHERE lobby_id = ${proposal.lobby_id}
          AND game_status = 'active'
      ) AS active_players
    FROM rollback_votes AS votes
    WHERE votes.proposal_id = ${proposal.proposal_id}
  `;
  const activePlayers = totals?.active_players ?? 0;
  const approvals = totals?.approvals ?? 0;
  const votes = totals?.votes ?? 0;
  const required = requiredRollbackApprovals(activePlayers);
  if (approvals >= required) {
    const [checkpoint] = await transaction<GameCheckpointRow[]>`
      SELECT
        checkpoint_id::text,
        branch_id::text,
        round::integer,
        phase,
        label,
        state,
        checksum::text
      FROM game_checkpoints
      WHERE checkpoint_id = ${proposal.checkpoint_id}
      FOR UPDATE
    `;
    if (checkpoint === undefined) {
      throw new GameRollbackError("CHECKPOINT_NOT_FOUND");
    }
    await restoreCheckpoint(transaction, {
      checkpoint,
      lobbyId: proposal.lobby_id,
      oldBranchId: proposal.active_branch_id,
      playerId: proposal.initiated_by_player_id,
      proposalId: proposal.proposal_id,
      reason: proposal.reason
    });
    return;
  }
  const remainingVotes = activePlayers - votes;
  if (approvals + remainingVotes < required) {
    await rejectProposal(transaction, {
      proposalId: proposal.proposal_id
    });
  }
}

export async function cancelGameRollback(
  transaction: postgres.TransactionSql,
  input: {
    readonly code: string;
    readonly playerId: string;
    readonly proposalId: string;
  }
) {
  const [proposal] = await transaction<{
    readonly host_player_id: string;
    readonly proposal_id: string;
  }[]>`
    SELECT
      proposals.proposal_id::text,
      lobbies.host_telegram_id::text AS host_player_id
    FROM rollback_proposals AS proposals
    JOIN lobbies ON lobbies.lobby_id = proposals.lobby_id
    WHERE lobbies.code = ${input.code}
      AND proposals.proposal_id = ${input.proposalId}
      AND proposals.status = 'pending'
    FOR UPDATE OF proposals, lobbies
  `;
  if (proposal === undefined) {
    throw new GameRollbackError("ROLLBACK_NOT_PENDING");
  }
  if (proposal.host_player_id !== input.playerId) {
    throw new GameRollbackError("ONLY_HOST_CAN_ROLLBACK");
  }
  await rejectProposal(transaction, { proposalId: proposal.proposal_id });
  await transaction`
    UPDATE rollback_proposals
    SET status = 'cancelled'
    WHERE proposal_id = ${proposal.proposal_id}
  `;
}

export async function resumeGameAfterRollback(
  transaction: postgres.TransactionSql,
  input: {
    readonly code: string;
    readonly discussionSeconds: number;
    readonly playerId: string;
    readonly reactionSeconds: number;
    readonly turnSeconds: number;
  }
) {
  const [game] = await transaction<{
    readonly game_phase: string;
    readonly host_player_id: string;
    readonly lobby_id: string;
    readonly rollback_paused: boolean;
  }[]>`
    SELECT
      lobby_id::text,
      host_telegram_id::text AS host_player_id,
      game_phase,
      rollback_paused
    FROM lobbies
    WHERE code = ${input.code}
      AND status = 'started'
    FOR UPDATE
  `;
  if (game === undefined || !game.rollback_paused) {
    throw new GameRollbackError("ROLLBACK_NOT_PENDING");
  }
  if (game.host_player_id !== input.playerId) {
    throw new GameRollbackError("ONLY_HOST_CAN_ROLLBACK");
  }
  await transaction`
    UPDATE lobbies
    SET
      rollback_paused = false,
      turn_deadline = CASE
        WHEN game_phase = 'revealing'
          THEN now() + ${input.turnSeconds} * interval '1 second'
        WHEN game_phase = 'discussion'
          THEN now() + ${input.discussionSeconds} * interval '1 second'
        ELSE NULL
      END,
      reaction_deadline = CASE
        WHEN game_phase = 'reaction'
          THEN now() + ${input.reactionSeconds} * interval '1 second'
        ELSE NULL
      END,
      last_event = 'Ведучий перевірив відновлений стан. Гру продовжено.'
    WHERE lobby_id = ${game.lobby_id}
  `;
  const [branch] = await transaction<{
    readonly branch_id: string;
  }[]>`
    SELECT active_branch_id::text AS branch_id
    FROM lobbies
    WHERE lobby_id = ${game.lobby_id}
  `;
  if (branch !== undefined) {
    await appendGameEvent(transaction, {
      branchId: branch.branch_id,
      eventType: "rollback_resumed",
      lobbyId: game.lobby_id,
      payload: { playerId: input.playerId }
    });
  }
}

export async function readGameRollbackView(
  sql: postgres.Sql,
  input: {
    readonly code: string;
    readonly playerId: string;
  }
): Promise<PlaytestRollbackView> {
  const [game] = await sql<{
    readonly active_branch_id: string;
    readonly host_player_id: string;
    readonly rollback_paused: boolean;
    readonly round: number;
  }[]>`
    SELECT
      active_branch_id::text,
      host_telegram_id::text AS host_player_id,
      rollback_paused,
      round::integer
    FROM lobbies
    WHERE code = ${input.code}
      AND status = 'started'
  `;
  if (game === undefined) {
    throw new Error("Started game is missing rollback state");
  }
  const [proposal] = await sql<{
    readonly approvals: number;
    readonly checkpoint_id: string;
    readonly checkpoint_label: string;
    readonly has_voted: boolean;
    readonly initiated_by_player_id: string;
    readonly player_count: number;
    readonly proposal_id: string;
    readonly reason: string;
    readonly rejections: number;
  }[]>`
    SELECT
      proposals.proposal_id::text,
      proposals.checkpoint_id::text,
      checkpoints.label AS checkpoint_label,
      proposals.initiated_by_telegram_id::text AS initiated_by_player_id,
      proposals.reason,
      count(votes.telegram_id) FILTER (WHERE votes.approve)::integer
        AS approvals,
      count(votes.telegram_id) FILTER (WHERE NOT votes.approve)::integer
        AS rejections,
      bool_or(votes.telegram_id = ${input.playerId}) AS has_voted,
      (
        SELECT count(*)::integer
        FROM lobby_players
        WHERE lobby_id = proposals.lobby_id
          AND game_status = 'active'
      ) AS player_count
    FROM rollback_proposals AS proposals
    JOIN game_checkpoints AS checkpoints
      ON checkpoints.checkpoint_id = proposals.checkpoint_id
    LEFT JOIN rollback_votes AS votes
      ON votes.proposal_id = proposals.proposal_id
    WHERE proposals.lobby_id = (
      SELECT lobby_id FROM lobbies WHERE code = ${input.code}
    )
      AND proposals.status = 'pending'
    GROUP BY proposals.proposal_id, checkpoints.label
  `;
  const checkpoints =
    game.host_player_id === input.playerId
      ? await sql<{
          readonly created_at: Date;
          readonly events_after: number;
          readonly id: string;
          readonly label: string;
          readonly phase: string;
          readonly round: number;
        }[]>`
          SELECT
            checkpoints.checkpoint_id::text AS id,
            checkpoints.created_at,
            checkpoints.round::integer,
            checkpoints.phase,
            checkpoints.label,
            GREATEST(
              0,
              COALESCE((
                SELECT max(events.revision)
                FROM game_events AS events
                WHERE events.branch_id = checkpoints.branch_id
              ), checkpoints.event_revision) - checkpoints.event_revision
            )::integer AS events_after
          FROM game_checkpoints AS checkpoints
          WHERE checkpoints.lobby_id = (
            SELECT lobby_id FROM lobbies WHERE code = ${input.code}
          )
            AND checkpoints.branch_id = ${game.active_branch_id}
            AND checkpoints.round = ${game.round}
          ORDER BY checkpoints.created_at DESC
          LIMIT 3
        `
      : [];

  return {
    activeBranchId: game.active_branch_id,
    checkpoints: checkpoints.map((checkpoint) => {
      if (!isPlaytestPhase(checkpoint.phase)) {
        throw new Error("Checkpoint contains an unsupported phase");
      }
      return {
        createdAt: checkpoint.created_at.toISOString(),
        eventsAfter: checkpoint.events_after,
        id: checkpoint.id,
        label: checkpoint.label,
        phase: checkpoint.phase,
        round: checkpoint.round
      };
    }),
    paused: game.rollback_paused || proposal !== undefined,
    proposal:
      proposal === undefined
        ? null
        : {
            approvals: proposal.approvals,
            checkpointId: proposal.checkpoint_id,
            checkpointLabel: proposal.checkpoint_label,
            hasVoted: proposal.has_voted,
            id: proposal.proposal_id,
            initiatedByPlayerId: proposal.initiated_by_player_id,
            reason: proposal.reason,
            rejections: proposal.rejections,
            requiredApprovals: requiredRollbackApprovals(
              proposal.player_count
            )
          }
  };
}
