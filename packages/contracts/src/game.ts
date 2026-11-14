import type {
  CardSelectionField,
  CardTarget,
  CardTiming,
  ContentScope
} from "./scenario.js";

export const GAME_PHASES = [
  "preparation",
  "introduction",
  "scenario_reveal",
  "player_turns",
  "reaction_window",
  "discussion",
  "voting",
  "tie_defense",
  "tie_revoting",
  "open_tie_vote",
  "final_check",
  "completed",
  "paused"
] as const;

export type GamePhase = (typeof GAME_PHASES)[number];

export const PLAYER_STATUSES = [
  "active",
  "afk",
  "eliminated",
  "spectator"
] as const;

export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

export const TEAM_OUTCOMES = ["all_survive", "team_loss"] as const;
export type TeamOutcome = (typeof TEAM_OUTCOMES)[number];

export const FINAL_OUTCOME_SOURCES = [
  "base",
  "demography",
  "scenario",
  "secret_goal"
] as const;
export type FinalOutcomeSource = (typeof FINAL_OUTCOME_SOURCES)[number];

export interface GamePlayer {
  readonly id: string;
  readonly order: number;
  readonly ready: boolean;
  readonly status: PlayerStatus;
}

export interface GameState {
  readonly bunkerCapacity: number;
  readonly gameId: string;
  readonly phase: GamePhase;
  readonly playerOrder: readonly string[];
  readonly players: Readonly<Record<string, GamePlayer>>;
  readonly revision: number;
  readonly rngSeed: string;
  readonly round: number;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
}

export interface FinalOutcome {
  readonly bunkerPlayerIds: readonly string[];
  readonly demographyPreserved: boolean;
  readonly outcomeSource: FinalOutcomeSource;
  readonly scenarioPassed: boolean;
  readonly secretGoalAdjudication?: {
    readonly appliedOutcome: TeamOutcome | "keep_base_result";
    readonly fulfilled: boolean;
    readonly goalId: string;
    readonly hostPlayerId: string;
  };
  readonly teamOutcome: TeamOutcome;
}

export interface CreateGameInput {
  readonly gameId: string;
  readonly playerIds: readonly string[];
  readonly playerRange: {
    readonly max: number;
    readonly min: number;
  };
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly seed: string;
}

export interface RandomBindings {
  readonly [bindingKey: string]: string;
}

export const CHARACTERISTIC_CATEGORIES = [
  { id: "profession", label: "Професія" },
  { id: "age-gender", label: "Вік і стать" },
  { id: "health", label: "Здоров’я" },
  { id: "hobby", label: "Хобі" },
  { id: "baggage", label: "Багаж" },
  { id: "character", label: "Характер" },
  { id: "special-condition", label: "Особливе" }
] as const;

export type CharacteristicId =
  (typeof CHARACTERISTIC_CATEGORIES)[number]["id"];

export interface MockGameCharacteristic {
  readonly id: CharacteristicId;
  readonly label: string;
  readonly revealed: boolean;
  readonly value: string;
}

export interface MockGamePlayer {
  readonly characteristics: Partial<
    Record<CharacteristicId, string>
  >;
  readonly firstName: string;
  readonly id: string;
  readonly lastName?: string;
  readonly position: number;
  readonly status: "active" | "eliminated";
}

export const PLAYTEST_PHASES = [
  "scenario_intro",
  "revealing",
  "reaction",
  "discussion",
  "voting",
  "final_check",
  "completed"
] as const;

export type PlaytestPhase = (typeof PLAYTEST_PHASES)[number];
export type PlaytestTurnStage = "choosing" | "speaking";

export type PlaytestResourceId =
  | "energy"
  | "supplies"
  | "integrity"
  | "lab-data"
  | "materials"
  | "predator-attention";

export interface PlaytestResource {
  readonly id: PlaytestResourceId;
  readonly label: string;
  readonly max: number;
  readonly value: number;
}

export interface PlaytestScenarioView {
  readonly ageRating: string;
  readonly bunker: {
    readonly condition: string;
    readonly description: string;
    readonly limitations: readonly string[];
    readonly rooms: readonly string[];
    readonly supplies: readonly string[];
  };
  readonly catastrophe: {
    readonly description: string;
    readonly title: string;
  };
  readonly contentWarnings: readonly string[];
  readonly id: string;
  readonly resources: readonly PlaytestResource[];
  readonly reveals: readonly {
    readonly description: string;
    readonly id: string;
    readonly round: number;
    readonly title: string;
  }[];
  readonly summary: string;
  readonly title: string;
}

export type PlaytestCardKind = "action" | "reaction";

export interface PlaytestCard {
  readonly description: string;
  readonly effectId: string;
  readonly id: string;
  readonly kind: PlaytestCardKind;
  readonly scope?: ContentScope;
  readonly selection?: readonly CardSelectionField[];
  readonly target?: CardTarget;
  readonly timing?: CardTiming;
  readonly title: string;
  readonly used: boolean;
}

export interface PlaytestCardSelection {
  readonly characteristicId?: CharacteristicId;
  readonly resourceId?: PlaytestResourceId;
  readonly targetPlayerId?: string;
}

export interface PlaytestCardChain {
  readonly action: Omit<PlaytestCard, "used">;
  readonly actionSelection: PlaytestCardSelection;
  readonly actorPlayerId: string;
  readonly deadline: string;
  readonly reactions: readonly {
    readonly card: Omit<PlaytestCard, "used">;
    readonly playerId: string;
    readonly selection: PlaytestCardSelection;
  }[];
}

export interface PlaytestCheckpoint {
  readonly createdAt: string;
  readonly eventsAfter: number;
  readonly id: string;
  readonly label: string;
  readonly phase: PlaytestPhase;
  readonly round: number;
}

export interface PlaytestRollbackProposal {
  readonly approvals: number;
  readonly checkpointId: string;
  readonly checkpointLabel: string;
  readonly hasVoted: boolean;
  readonly id: string;
  readonly initiatedByPlayerId: string;
  readonly reason: string;
  readonly rejections: number;
  readonly requiredApprovals: number;
}

export interface PlaytestRollbackView {
  readonly activeBranchId: string;
  readonly checkpoints: readonly PlaytestCheckpoint[];
  readonly paused: boolean;
  readonly proposal: PlaytestRollbackProposal | null;
}

export interface PlaytestDemographyAssessment {
  readonly eligibleMen: number;
  readonly eligibleWomen: number;
  readonly femaleAgeRange: {
    readonly max: number;
    readonly min: number;
  };
  readonly maleAgeRange: {
    readonly max: number;
    readonly min: number;
  };
  readonly preserved: boolean;
  readonly requiredMen: number;
  readonly requiredWomen: number;
}

export interface MockGameView {
  readonly bunkerCapacity: number;
  readonly card: PlaytestCard;
  readonly cardChain: PlaytestCardChain | null;
  readonly cardResult: string | null;
  readonly characteristics: readonly MockGameCharacteristic[];
  readonly code: string;
  readonly currentTurnPlayerId: string | null;
  readonly demography: PlaytestDemographyAssessment | null;
  readonly dossierNumber: number;
  readonly finalOutcome: TeamOutcome | null;
  readonly hostPlayerId: string;
  readonly lastEvent: string | null;
  readonly phase: PlaytestPhase;
  readonly players: readonly MockGamePlayer[];
  readonly rollback: PlaytestRollbackView;
  readonly round: number;
  readonly scenario: PlaytestScenarioView;
  readonly secretGoal: string | null;
  readonly status: "started";
  readonly turnDeadline: string | null;
  readonly turnRevealedCharacteristicId: CharacteristicId | null;
  readonly turnStage: PlaytestTurnStage | null;
  readonly voting: {
    readonly attempt: 1 | 2 | 3;
    readonly candidatePlayerIds: readonly string[];
    readonly expected: number;
    readonly hasVoted: boolean;
    readonly openVotes: readonly {
      readonly targetPlayerId: string;
      readonly voterPlayerId: string;
    }[];
    readonly silenced: boolean;
    readonly submitted: number;
    readonly totals: readonly {
      readonly targetPlayerId: string;
      readonly votes: number;
    }[];
  } | null;
}

export interface PublicGameView {
  readonly activeDeadline: string | null;
  readonly bunkerCapacity: number;
  readonly code: string;
  readonly currentTurnPlayerId: string | null;
  readonly finalOutcome: TeamOutcome | null;
  readonly lastEvent: string | null;
  readonly phase: PlaytestPhase;
  readonly players: readonly MockGamePlayer[];
  readonly rollbackPaused: boolean;
  readonly round: number;
  readonly scenario: PlaytestScenarioView;
  readonly status: "started";
  readonly turnDeadline: string | null;
  readonly turnRevealedCharacteristicId: CharacteristicId | null;
  readonly turnStage: PlaytestTurnStage | null;
}
