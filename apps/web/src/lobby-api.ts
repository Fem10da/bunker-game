import {
  CHARACTERISTIC_CATEGORIES,
  MAX_GAME_PLAYERS,
  type CharacteristicId,
  type Lobby,
  type LobbyPlayer,
  type MockGameCharacteristic,
  type MockGamePlayer,
  type MockGameView,
  type PlaytestCard,
  type PlaytestCardChain,
  type PlaytestCardSelection,
  type PlaytestCheckpoint,
  type PlaytestRollbackView,
  type PlaytestResourceId,
  type PlaytestScenarioView,
  type PublicGameView
} from "@bunker/contracts";

export class LobbyApiError extends Error {
  readonly code: string;

  constructor(code = "LOBBY_API_ERROR", serverMessage?: string) {
    super(serverMessage ?? code);
    this.name = "LobbyApiError";
    this.code = code;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let clockOffsetMs = 0;

function recordServerTime(response: Response) {
  const header = response.headers.get("date");
  if (header === null) {
    return;
  }
  const serverTime = Date.parse(header);
  if (Number.isFinite(serverTime)) {
    clockOffsetMs = serverTime - Date.now();
  }
}

export function serverNow(): number {
  return Date.now() + clockOffsetMs;
}

async function throwLobbyApiError(response: Response): Promise<never> {
  let code = "LOBBY_API_ERROR";
  let serverMessage: string | undefined;
  try {
    const payload: unknown = await response.json();
    if (isObject(payload) && isObject(payload.error)) {
      if (typeof payload.error.code === "string") {
        code = payload.error.code;
      }
      if (typeof payload.error.message === "string") {
        serverMessage = payload.error.message;
      }
    }
  } catch {
    serverMessage = undefined;
  }
  throw new LobbyApiError(code, serverMessage);
}

function parsePlayer(value: unknown): LobbyPlayer {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.firstName !== "string" ||
    typeof value.isHost !== "boolean" ||
    typeof value.position !== "number" ||
    !Number.isInteger(value.position) ||
    typeof value.ready !== "boolean"
  ) {
    throw new LobbyApiError();
  }

  const lastName =
    typeof value.lastName === "string" && value.lastName.length > 0
      ? value.lastName
      : undefined;
  const username =
    typeof value.username === "string" && value.username.length > 0
      ? value.username
      : undefined;

  return {
    firstName: value.firstName,
    id: value.id,
    isHost: value.isHost,
    ...(lastName === undefined ? {} : { lastName }),
    position: value.position,
    ready: value.ready,
    ...(username === undefined ? {} : { username })
  };
}

function parseLobby(value: unknown): Lobby {
  if (
    !isObject(value) ||
    typeof value.code !== "string" ||
    !/^[A-Z0-9]{6}$/u.test(value.code) ||
    typeof value.hostPlayerId !== "string" ||
    !Array.isArray(value.players) ||
    typeof value.scenarioId !== "string" ||
    typeof value.secretGoalsEnabled !== "boolean" ||
    (value.status !== "waiting" && value.status !== "started")
  ) {
    throw new LobbyApiError();
  }

  return {
    code: value.code,
    hostPlayerId: value.hostPlayerId,
    players: value.players.map(parsePlayer),
    scenarioId: value.scenarioId,
    secretGoalsEnabled: value.secretGoalsEnabled,
    status: value.status
  };
}

function isCharacteristicId(value: string): value is CharacteristicId {
  return CHARACTERISTIC_CATEGORIES.some(
    (category) => category.id === value
  );
}

function parseGameCharacteristic(
  value: unknown
): MockGameCharacteristic {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    !isCharacteristicId(value.id) ||
    typeof value.label !== "string" ||
    typeof value.revealed !== "boolean" ||
    typeof value.value !== "string"
  ) {
    throw new LobbyApiError();
  }

  return {
    id: value.id,
    label: value.label,
    revealed: value.revealed,
    value: value.value
  };
}

function parseGamePlayer(value: unknown): MockGamePlayer {
  if (
    !isObject(value) ||
    !isObject(value.characteristics) ||
    typeof value.firstName !== "string" ||
    typeof value.id !== "string" ||
    !Number.isInteger(value.position) ||
    (value.status !== "active" && value.status !== "eliminated")
  ) {
    throw new LobbyApiError();
  }

  const characteristics: Partial<Record<CharacteristicId, string>> = {};
  for (const [id, characteristicValue] of Object.entries(
    value.characteristics
  )) {
    if (
      !isCharacteristicId(id) ||
      typeof characteristicValue !== "string"
    ) {
      throw new LobbyApiError();
    }
    characteristics[id] = characteristicValue;
  }

  return {
    characteristics,
    firstName: value.firstName,
    id: value.id,
    ...(typeof value.lastName === "string"
      ? { lastName: value.lastName }
      : {}),
    position: value.position as number,
    status: value.status === "eliminated" ? "eliminated" : "active"
  };
}

const resourceIds = new Set<PlaytestResourceId>([
  "energy",
  "supplies",
  "integrity",
  "lab-data",
  "materials",
  "predator-attention"
]);

function parseCardSelection(value: unknown): PlaytestCardSelection {
  if (!isObject(value)) {
    return {};
  }
  return {
    ...(typeof value.targetPlayerId === "string"
      ? { targetPlayerId: value.targetPlayerId }
      : {}),
    ...(typeof value.characteristicId === "string" &&
    isCharacteristicId(value.characteristicId)
      ? { characteristicId: value.characteristicId }
      : {}),
    ...(typeof value.resourceId === "string" &&
    resourceIds.has(value.resourceId as PlaytestResourceId)
      ? { resourceId: value.resourceId as PlaytestResourceId }
      : {})
  };
}

function parseCard(
  value: unknown,
  includeUsed: true
): PlaytestCard;
function parseCard(
  value: unknown,
  includeUsed: false
): Omit<PlaytestCard, "used">;
function parseCard(
  value: unknown,
  includeUsed: boolean
): PlaytestCard | Omit<PlaytestCard, "used"> {
  if (
    !isObject(value) ||
    typeof value.description !== "string" ||
    typeof value.effectId !== "string" ||
    typeof value.id !== "string" ||
    (value.kind !== "action" && value.kind !== "reaction") ||
    typeof value.title !== "string" ||
    (includeUsed && typeof value.used !== "boolean")
  ) {
    throw new LobbyApiError();
  }
  return {
    description: value.description,
    effectId: value.effectId,
    id: value.id,
    kind: value.kind,
    ...(value.scope === "common" || value.scope === "scenario"
      ? { scope: value.scope }
      : {}),
    ...(Array.isArray(value.selection) &&
    value.selection.every(
      (field) =>
        field === "target_player" ||
        field === "characteristic" ||
        field === "resource"
    )
      ? { selection: value.selection }
      : {}),
    ...(value.target === "self" ||
    value.target === "active_player" ||
    value.target === "any_non_afk_player" ||
    value.target === "eliminated_player" ||
    value.target === "game"
      ? { target: value.target }
      : {}),
    ...(value.timing === "own_phase" ||
    value.timing === "reaction_window" ||
    value.timing === "scenario_defined"
      ? { timing: value.timing }
      : {}),
    title: value.title,
    ...(includeUsed ? { used: value.used as boolean } : {})
  };
}

function parseScenario(value: unknown): PlaytestScenarioView {
  if (
    !isObject(value) ||
    typeof value.ageRating !== "string" ||
    !isObject(value.bunker) ||
    typeof value.bunker.condition !== "string" ||
    typeof value.bunker.description !== "string" ||
    !Array.isArray(value.bunker.limitations) ||
    !value.bunker.limitations.every((item) => typeof item === "string") ||
    !Array.isArray(value.bunker.rooms) ||
    !value.bunker.rooms.every((item) => typeof item === "string") ||
    !Array.isArray(value.bunker.supplies) ||
    !value.bunker.supplies.every((item) => typeof item === "string") ||
    !isObject(value.catastrophe) ||
    typeof value.catastrophe.description !== "string" ||
    typeof value.catastrophe.title !== "string" ||
    !Array.isArray(value.contentWarnings) ||
    !value.contentWarnings.every((item) => typeof item === "string") ||
    typeof value.id !== "string" ||
    !Array.isArray(value.resources) ||
    !Array.isArray(value.reveals) ||
    typeof value.summary !== "string" ||
    typeof value.title !== "string"
  ) {
    throw new LobbyApiError();
  }
  const resources = value.resources.map((resource) => {
    if (
      !isObject(resource) ||
      typeof resource.id !== "string" ||
      !resourceIds.has(resource.id as PlaytestResourceId) ||
      typeof resource.label !== "string" ||
      !Number.isInteger(resource.max) ||
      !Number.isInteger(resource.value)
    ) {
      throw new LobbyApiError();
    }
    return {
      id: resource.id as PlaytestResourceId,
      label: resource.label,
      max: resource.max as number,
      value: resource.value as number
    };
  });
  const reveals = value.reveals.map((reveal) => {
    if (
      !isObject(reveal) ||
      typeof reveal.description !== "string" ||
      typeof reveal.id !== "string" ||
      !Number.isInteger(reveal.round) ||
      typeof reveal.title !== "string"
    ) {
      throw new LobbyApiError();
    }
    return {
      description: reveal.description,
      id: reveal.id,
      round: reveal.round as number,
      title: reveal.title
    };
  });

  return {
    ageRating: value.ageRating,
    bunker: {
      condition: value.bunker.condition,
      description: value.bunker.description,
      limitations: value.bunker.limitations,
      rooms: value.bunker.rooms,
      supplies: value.bunker.supplies
    },
    catastrophe: {
      description: value.catastrophe.description,
      title: value.catastrophe.title
    },
    contentWarnings: value.contentWarnings,
    id: value.id,
    resources,
    reveals,
    summary: value.summary,
    title: value.title
  };
}

function parseCardChain(value: unknown): PlaytestCardChain | null {
  if (value === null) {
    return null;
  }
  if (
    !isObject(value) ||
    typeof value.actorPlayerId !== "string" ||
    typeof value.deadline !== "string" ||
    !Array.isArray(value.reactions)
  ) {
    throw new LobbyApiError();
  }
  return {
    action: parseCard(value.action, false),
    actionSelection: parseCardSelection(value.actionSelection),
    actorPlayerId: value.actorPlayerId,
    deadline: value.deadline,
    reactions: value.reactions.map((reaction) => {
      if (!isObject(reaction) || typeof reaction.playerId !== "string") {
        throw new LobbyApiError();
      }
      return {
        card: parseCard(reaction.card, false),
        playerId: reaction.playerId,
        selection: parseCardSelection(reaction.selection)
      };
    })
  };
}

function parseRollback(value: unknown): PlaytestRollbackView {
  if (
    !isObject(value) ||
    typeof value.activeBranchId !== "string" ||
    !Array.isArray(value.checkpoints) ||
    typeof value.paused !== "boolean"
  ) {
    throw new LobbyApiError();
  }
  const checkpoints = value.checkpoints.map(
    (checkpoint): PlaytestCheckpoint => {
    if (
      !isObject(checkpoint) ||
      typeof checkpoint.createdAt !== "string" ||
      !Number.isInteger(checkpoint.eventsAfter) ||
      typeof checkpoint.id !== "string" ||
      typeof checkpoint.label !== "string" ||
      (checkpoint.phase !== "scenario_intro" &&
        checkpoint.phase !== "revealing" &&
        checkpoint.phase !== "reaction" &&
        checkpoint.phase !== "discussion" &&
        checkpoint.phase !== "voting" &&
        checkpoint.phase !== "final_check" &&
        checkpoint.phase !== "completed") ||
      !Number.isInteger(checkpoint.round)
    ) {
      throw new LobbyApiError();
    }
    return {
      createdAt: checkpoint.createdAt,
      eventsAfter: checkpoint.eventsAfter as number,
      id: checkpoint.id,
      label: checkpoint.label,
      phase: checkpoint.phase,
      round: checkpoint.round as number
    };
    }
  );
  let proposal: PlaytestRollbackView["proposal"] = null;
  if (value.proposal !== null) {
    if (
      !isObject(value.proposal) ||
      !Number.isInteger(value.proposal.approvals) ||
      typeof value.proposal.checkpointId !== "string" ||
      typeof value.proposal.checkpointLabel !== "string" ||
      typeof value.proposal.hasVoted !== "boolean" ||
      typeof value.proposal.id !== "string" ||
      typeof value.proposal.initiatedByPlayerId !== "string" ||
      typeof value.proposal.reason !== "string" ||
      !Number.isInteger(value.proposal.rejections) ||
      !Number.isInteger(value.proposal.requiredApprovals)
    ) {
      throw new LobbyApiError();
    }
    proposal = {
      approvals: value.proposal.approvals as number,
      checkpointId: value.proposal.checkpointId,
      checkpointLabel: value.proposal.checkpointLabel,
      hasVoted: value.proposal.hasVoted,
      id: value.proposal.id,
      initiatedByPlayerId: value.proposal.initiatedByPlayerId,
      reason: value.proposal.reason,
      rejections: value.proposal.rejections as number,
      requiredApprovals: value.proposal.requiredApprovals as number
    };
  }
  return {
    activeBranchId: value.activeBranchId,
    checkpoints,
    paused: value.paused,
    proposal
  };
}

function parseDemography(
  value: unknown
): MockGameView["demography"] {
  if (
    !isObject(value) ||
    !Number.isInteger(value.eligibleMen) ||
    (value.eligibleMen as number) < 0 ||
    !Number.isInteger(value.eligibleWomen) ||
    (value.eligibleWomen as number) < 0 ||
    !isObject(value.femaleAgeRange) ||
    !Number.isInteger(value.femaleAgeRange.min) ||
    (value.femaleAgeRange.min as number) < 0 ||
    !Number.isInteger(value.femaleAgeRange.max) ||
    (value.femaleAgeRange.max as number) > 130 ||
    (value.femaleAgeRange.min as number) >
      (value.femaleAgeRange.max as number) ||
    !isObject(value.maleAgeRange) ||
    !Number.isInteger(value.maleAgeRange.min) ||
    (value.maleAgeRange.min as number) < 0 ||
    !Number.isInteger(value.maleAgeRange.max) ||
    (value.maleAgeRange.max as number) > 130 ||
    (value.maleAgeRange.min as number) >
      (value.maleAgeRange.max as number) ||
    typeof value.preserved !== "boolean" ||
    !Number.isInteger(value.requiredMen) ||
    (value.requiredMen as number) < 1 ||
    !Number.isInteger(value.requiredWomen) ||
    (value.requiredWomen as number) < 1 ||
    value.preserved !==
      ((value.eligibleMen as number) >= (value.requiredMen as number) &&
        (value.eligibleWomen as number) >=
          (value.requiredWomen as number))
  ) {
    throw new LobbyApiError();
  }
  return {
    eligibleMen: value.eligibleMen as number,
    eligibleWomen: value.eligibleWomen as number,
    femaleAgeRange: {
      max: value.femaleAgeRange.max as number,
      min: value.femaleAgeRange.min as number
    },
    maleAgeRange: {
      max: value.maleAgeRange.max as number,
      min: value.maleAgeRange.min as number
    },
    preserved: value.preserved,
    requiredMen: value.requiredMen as number,
    requiredWomen: value.requiredWomen as number
  };
}

function parseMockGame(value: unknown): MockGameView {
  if (
    !isObject(value) ||
    !Number.isInteger(value.bunkerCapacity) ||
    (value.bunkerCapacity as number) < 2 ||
    (value.bunkerCapacity as number) > Math.ceil(MAX_GAME_PLAYERS / 2) ||
    !Array.isArray(value.characteristics) ||
    typeof value.code !== "string" ||
    !/^[A-Z0-9]{6}$/u.test(value.code) ||
    (value.currentTurnPlayerId !== null &&
      typeof value.currentTurnPlayerId !== "string") ||
    (value.demography !== null && !isObject(value.demography)) ||
    (value.cardResult !== null && typeof value.cardResult !== "string") ||
    !Number.isInteger(value.dossierNumber) ||
    typeof value.hostPlayerId !== "string" ||
    (value.phase !== "scenario_intro" &&
      value.phase !== "revealing" &&
      value.phase !== "reaction" &&
      value.phase !== "discussion" &&
      value.phase !== "voting" &&
      value.phase !== "final_check" &&
      value.phase !== "completed") ||
    (value.lastEvent !== null && typeof value.lastEvent !== "string") ||
    !Array.isArray(value.players) ||
    !isObject(value.rollback) ||
    !Number.isInteger(value.round) ||
    (value.round as number) < 1 ||
    (value.secretGoal !== null && typeof value.secretGoal !== "string") ||
    value.status !== "started" ||
    (value.turnDeadline !== null &&
      typeof value.turnDeadline !== "string") ||
    (value.turnRevealedCharacteristicId !== null &&
      (typeof value.turnRevealedCharacteristicId !== "string" ||
        !isCharacteristicId(value.turnRevealedCharacteristicId))) ||
    (value.turnStage !== null &&
      value.turnStage !== "choosing" &&
      value.turnStage !== "speaking") ||
    (value.finalOutcome !== null &&
      value.finalOutcome !== "all_survive" &&
      value.finalOutcome !== "team_loss")
  ) {
    throw new LobbyApiError();
  }
  let voting: MockGameView["voting"] = null;
  if (value.voting !== null) {
    if (
      !isObject(value.voting) ||
      (value.voting.attempt !== 1 &&
        value.voting.attempt !== 2 &&
        value.voting.attempt !== 3) ||
      !Array.isArray(value.voting.candidatePlayerIds) ||
      !value.voting.candidatePlayerIds.every(
        (candidate) => typeof candidate === "string"
      ) ||
      !Number.isInteger(value.voting.expected) ||
      typeof value.voting.hasVoted !== "boolean" ||
      !Array.isArray(value.voting.openVotes) ||
      !value.voting.openVotes.every(
        (vote) =>
          isObject(vote) &&
          typeof vote.targetPlayerId === "string" &&
          typeof vote.voterPlayerId === "string"
      ) ||
      typeof value.voting.silenced !== "boolean" ||
      !Number.isInteger(value.voting.submitted) ||
      !Array.isArray(value.voting.totals) ||
      !value.voting.totals.every(
        (total) =>
          isObject(total) &&
          typeof total.targetPlayerId === "string" &&
          Number.isInteger(total.votes)
      )
    ) {
      throw new LobbyApiError();
    }
    voting = {
      attempt: value.voting.attempt,
      candidatePlayerIds: value.voting.candidatePlayerIds,
      expected: value.voting.expected as number,
      hasVoted: value.voting.hasVoted,
      openVotes: value.voting.openVotes.map((vote) => ({
        targetPlayerId: (vote as { readonly targetPlayerId: string })
          .targetPlayerId,
        voterPlayerId: (vote as { readonly voterPlayerId: string })
          .voterPlayerId
      })),
      silenced: value.voting.silenced,
      submitted: value.voting.submitted as number,
      totals: value.voting.totals.map((total) => ({
        targetPlayerId: (total as { readonly targetPlayerId: string })
          .targetPlayerId,
        votes: (total as { readonly votes: number }).votes
      }))
    };
  }

  return {
    bunkerCapacity: value.bunkerCapacity as number,
    card: parseCard(value.card, true),
    cardChain: parseCardChain(value.cardChain),
    cardResult: value.cardResult,
    characteristics: value.characteristics.map(parseGameCharacteristic),
    code: value.code,
    currentTurnPlayerId: value.currentTurnPlayerId,
    demography:
      value.demography === null ? null : parseDemography(value.demography),
    dossierNumber: value.dossierNumber as number,
    finalOutcome: value.finalOutcome,
    hostPlayerId: value.hostPlayerId,
    lastEvent: value.lastEvent,
    phase: value.phase,
    players: value.players.map(parseGamePlayer),
    rollback: parseRollback(value.rollback),
    round: value.round as number,
    scenario: parseScenario(value.scenario),
    secretGoal: value.secretGoal,
    status: "started",
    turnDeadline: value.turnDeadline,
    turnRevealedCharacteristicId: value.turnRevealedCharacteristicId,
    turnStage: value.turnStage,
    voting
  };
}

function parsePublicGame(value: unknown): PublicGameView {
  if (
    !isObject(value) ||
    (value.activeDeadline !== null &&
      typeof value.activeDeadline !== "string") ||
    !Number.isInteger(value.bunkerCapacity) ||
    (value.bunkerCapacity as number) < 2 ||
    (value.bunkerCapacity as number) > Math.ceil(MAX_GAME_PLAYERS / 2) ||
    typeof value.code !== "string" ||
    !/^[A-Z0-9]{6}$/u.test(value.code) ||
    (value.currentTurnPlayerId !== null &&
      typeof value.currentTurnPlayerId !== "string") ||
    (value.finalOutcome !== null &&
      value.finalOutcome !== "all_survive" &&
      value.finalOutcome !== "team_loss") ||
    (value.lastEvent !== null && typeof value.lastEvent !== "string") ||
    (value.phase !== "scenario_intro" &&
      value.phase !== "revealing" &&
      value.phase !== "reaction" &&
      value.phase !== "discussion" &&
      value.phase !== "voting" &&
      value.phase !== "final_check" &&
      value.phase !== "completed") ||
    !Array.isArray(value.players) ||
    typeof value.rollbackPaused !== "boolean" ||
    !Number.isInteger(value.round) ||
    (value.round as number) < 1 ||
    value.status !== "started" ||
    (value.turnDeadline !== null &&
      typeof value.turnDeadline !== "string") ||
    (value.turnRevealedCharacteristicId !== null &&
      (typeof value.turnRevealedCharacteristicId !== "string" ||
        !isCharacteristicId(value.turnRevealedCharacteristicId))) ||
    (value.turnStage !== null &&
      value.turnStage !== "choosing" &&
      value.turnStage !== "speaking")
  ) {
    throw new LobbyApiError();
  }

  return {
    activeDeadline: value.activeDeadline,
    bunkerCapacity: value.bunkerCapacity as number,
    code: value.code,
    currentTurnPlayerId: value.currentTurnPlayerId,
    finalOutcome: value.finalOutcome,
    lastEvent: value.lastEvent,
    phase: value.phase,
    players: value.players.map(parseGamePlayer),
    rollbackPaused: value.rollbackPaused,
    round: value.round as number,
    scenario: parseScenario(value.scenario),
    status: "started",
    turnDeadline: value.turnDeadline,
    turnRevealedCharacteristicId: value.turnRevealedCharacteristicId,
    turnStage: value.turnStage
  };
}

async function readLobby(
  response: Response,
  allowNull = false
): Promise<Lobby | null> {
  recordServerTime(response);
  if (!response.ok) {
    return throwLobbyApiError(response);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LobbyApiError();
  }

  if (
    !isObject(payload) ||
    !isObject(payload.data) ||
    !("lobby" in payload.data)
  ) {
    throw new LobbyApiError();
  }
  if (allowNull && payload.data.lobby === null) {
    return null;
  }

  return parseLobby(payload.data.lobby);
}

async function readGame(response: Response): Promise<MockGameView> {
  recordServerTime(response);
  if (!response.ok) {
    return throwLobbyApiError(response);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LobbyApiError();
  }
  if (
    !isObject(payload) ||
    !isObject(payload.data) ||
    !("game" in payload.data)
  ) {
    throw new LobbyApiError();
  }
  return parseMockGame(payload.data.game);
}

async function readPublicGame(response: Response): Promise<PublicGameView> {
  recordServerTime(response);
  if (!response.ok) {
    return throwLobbyApiError(response);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LobbyApiError();
  }
  if (
    !isObject(payload) ||
    !isObject(payload.data) ||
    !("game" in payload.data)
  ) {
    throw new LobbyApiError();
  }
  return parsePublicGame(payload.data.game);
}

export async function createLobby(): Promise<Lobby> {
  const lobby = await readLobby(
    await fetch("/api/lobbies", {
      credentials: "include",
      method: "POST"
    })
  );
  if (lobby === null) {
    throw new LobbyApiError();
  }
  return lobby;
}

export async function getCurrentLobby(): Promise<Lobby | null> {
  return readLobby(
    await fetch("/api/lobbies/current", {
      credentials: "include"
    }),
    true
  );
}

export async function getLobby(code: string): Promise<Lobby> {
  const lobby = await readLobby(
    await fetch(`/api/lobbies/${encodeURIComponent(code)}`, {
      credentials: "include"
    })
  );
  if (lobby === null) {
    throw new LobbyApiError();
  }
  return lobby;
}

export async function getPublicGame(code: string): Promise<PublicGameView> {
  return readPublicGame(
    await fetch(`/api/screens/${encodeURIComponent(code)}`)
  );
}

export async function joinLobby(code: string): Promise<Lobby> {
  const lobby = await readLobby(
    await fetch("/api/lobbies/join", {
      body: JSON.stringify({ code }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    })
  );
  if (lobby === null) {
    throw new LobbyApiError();
  }
  return lobby;
}

export async function leaveLobby(
  code: string
): Promise<{ readonly cancelled: boolean }> {
  const response = await fetch(
    `/api/lobbies/${encodeURIComponent(code)}`,
    {
      credentials: "include",
      method: "DELETE"
    }
  );
  if (!response.ok) {
    return throwLobbyApiError(response);
  }

  const payload: unknown = await response.json();
  if (
    !isObject(payload) ||
    !isObject(payload.data) ||
    typeof payload.data.cancelled !== "boolean"
  ) {
    throw new LobbyApiError();
  }

  return {
    cancelled: payload.data.cancelled
  };
}

export async function setLobbyReady(
  code: string,
  ready: boolean
): Promise<Lobby> {
  const lobby = await readLobby(
    await fetch(`/api/lobbies/${encodeURIComponent(code)}/readiness`, {
      body: JSON.stringify({ ready }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "PUT"
    })
  );
  if (lobby === null) {
    throw new LobbyApiError();
  }
  return lobby;
}

export async function setLobbySecretGoals(
  code: string,
  enabled: boolean
): Promise<Lobby> {
  const lobby = await readLobby(
    await fetch(`/api/lobbies/${encodeURIComponent(code)}/secret-goals`, {
      body: JSON.stringify({ enabled }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "PUT"
    })
  );
  if (lobby === null) {
    throw new LobbyApiError();
  }
  return lobby;
}

export async function reorderLobby(
  code: string,
  playerIds: readonly string[]
): Promise<Lobby> {
  const lobby = await readLobby(
    await fetch(`/api/lobbies/${encodeURIComponent(code)}/order`, {
      body: JSON.stringify({ playerIds }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "PUT"
    })
  );
  if (lobby === null) {
    throw new LobbyApiError();
  }
  return lobby;
}

export async function startLobby(code: string): Promise<Lobby> {
  const lobby = await readLobby(
    await fetch(`/api/lobbies/${encodeURIComponent(code)}/start`, {
      credentials: "include",
      method: "POST"
    })
  );
  if (lobby === null) {
    throw new LobbyApiError();
  }
  return lobby;
}

export async function getMockGame(code: string): Promise<MockGameView> {
  return readGame(
    await fetch(`/api/games/${encodeURIComponent(code)}`, {
      credentials: "include"
    })
  );
}

export async function beginMockGame(code: string): Promise<MockGameView> {
  return readGame(
    await fetch(`/api/games/${encodeURIComponent(code)}/begin`, {
      credentials: "include",
      method: "POST"
    })
  );
}

export async function revealMockCharacteristic(
  code: string,
  characteristicId: CharacteristicId
): Promise<MockGameView> {
  return readGame(
    await fetch(`/api/games/${encodeURIComponent(code)}/reveal`, {
      body: JSON.stringify({ characteristicId }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    })
  );
}

export async function finishMockTurn(
  code: string
): Promise<MockGameView> {
  return readGame(
    await fetch(`/api/games/${encodeURIComponent(code)}/finish-turn`, {
      credentials: "include",
      method: "POST"
    })
  );
}

export async function finishMockDiscussion(
  code: string
): Promise<MockGameView> {
  return readGame(
    await fetch(
      `/api/games/${encodeURIComponent(code)}/finish-discussion`,
      {
        credentials: "include",
        method: "POST"
      }
    )
  );
}

export async function finishMockVoting(
  code: string,
  votingAttempt: number
): Promise<MockGameView> {
  return readGame(
    await fetch(
      `/api/games/${encodeURIComponent(code)}/finish-voting`,
      {
        body: JSON.stringify({ votingAttempt }),
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      }
    )
  );
}

export async function usePlaytestCard(
  code: string,
  selection: PlaytestCardSelection
): Promise<MockGameView> {
  return readGame(
    await fetch(`/api/games/${encodeURIComponent(code)}/cards/use`, {
      body: JSON.stringify(selection),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST"
    })
  );
}

export async function reactWithPlaytestCard(
  code: string,
  selection: PlaytestCardSelection,
  expectedReactionCount: number
): Promise<MockGameView> {
  return readGame(
    await fetch(`/api/games/${encodeURIComponent(code)}/cards/react`, {
      body: JSON.stringify({ ...selection, expectedReactionCount }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST"
    })
  );
}

export async function submitFinalOutcome(
  code: string,
  outcome: "all_survive" | "team_loss"
): Promise<MockGameView> {
  return readGame(
    await fetch(
      `/api/games/${encodeURIComponent(code)}/final-outcome`,
      {
        body: JSON.stringify({ outcome }),
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      }
    )
  );
}

export async function submitVote(
  code: string,
  targetPlayerId: string,
  votingAttempt: number
): Promise<MockGameView> {
  return readGame(
    await fetch(`/api/games/${encodeURIComponent(code)}/vote`, {
      body: JSON.stringify({ targetPlayerId, votingAttempt }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    })
  );
}

export async function proposeRollback(
  code: string,
  checkpointId: string,
  reason: string
): Promise<MockGameView> {
  return readGame(
    await fetch(`/api/games/${encodeURIComponent(code)}/rollback`, {
      body: JSON.stringify({ checkpointId, reason }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    })
  );
}

export async function voteRollback(
  code: string,
  approve: boolean,
  proposalId: string
): Promise<MockGameView> {
  return readGame(
    await fetch(
      `/api/games/${encodeURIComponent(code)}/rollback/vote`,
      {
        body: JSON.stringify({ approve, proposalId }),
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      }
    )
  );
}

export async function cancelRollback(
  code: string,
  proposalId: string
): Promise<MockGameView> {
  return readGame(
    await fetch(`/api/games/${encodeURIComponent(code)}/rollback`, {
      body: JSON.stringify({ proposalId }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "DELETE"
    })
  );
}

export async function resumeRollback(
  code: string
): Promise<MockGameView> {
  return readGame(
    await fetch(
      `/api/games/${encodeURIComponent(code)}/rollback/resume`,
      {
        credentials: "include",
        method: "POST"
      }
    )
  );
}
