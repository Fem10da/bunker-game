import { randomInt } from "node:crypto";

import {
  MAX_GAME_PLAYERS,
  type PlaytestCard,
  type PlaytestResource,
  type PlaytestResourceId,
  type PlaytestScenarioView
} from "@bunker/contracts";
import {
  resolveCardCatalog,
  type CatalogCard,
  type CatalogCardEffect
} from "@bunker/content";

export const operationChalkScenario: PlaytestScenarioView = {
  ageRating: "16+",
  bunker: {
    condition:
      "Основний корпус герметичний і придатний для життя: близько 120 квадратних метрів житлового та технічного простору. Генератор працює, але лабораторія та зовнішні модулі пошкоджені.",
    description:
      "Покинута підземна база корпорації, яка створювала динозаврів. Продовольчих пайків вистачить щонайменше на дванадцять місяців, але ніхто не знає, скільки насправді доведеться тут перечекати — у часової аномалії немає розкладу. В архівах бази можуть бути дані про слабкі місця тварин.",
    limitations: [
      "Генератор, ліфт і радіопередавач створюють сигнали, що привертають хижаків.",
      "Лабораторія працює частково й потребує відновлення даних.",
      "Технічний тунель сполучений із вентиляцією та невідомим зовнішнім модулем.",
      "До наступного безпечного вікна назовні база має працювати автономно."
    ],
    rooms: [
      "Командний центр",
      "Житловий блок",
      "Медичний блок",
      "Ізолятор з експериментальними препаратами невідомого призначення",
      "Генераторна",
      "Майстерня",
      "Лабораторія",
      "Склад запасів",
      "Технічний тунель"
    ],
    supplies: [
      "Продовольчі пайки приблизно на дванадцять місяців",
      "Вода з системою фільтрації",
      "Базовий набір медикаментів",
      "Інструменти та ремонтні матеріали",
      "Пошкоджений лабораторний архів"
    ]
  },
  catastrophe: {
    description:
      "Часова аномалія вирвала групу людей із сучасності та перенесла в епоху динозаврів. Назад дороги немає. Єдиний шанс пережити полювання — зайняти покинуту корпоративну базу, але місць вистачить лише половині групи.",
    title: "ЧАСОВИЙ РОЗЛОМ"
  },
  contentWarnings: [
    "небезпека й загибель людей",
    "напади тварин",
    "медичні стани",
    "залежності",
    "чорний гумор"
  ],
  id: "operation-chalk",
  resources: [
    { id: "energy", label: "Енергія", max: 10, value: 6 },
    { id: "supplies", label: "Їжа і запаси", max: 10, value: 7 },
    {
      id: "integrity",
      label: "Цілісність бункера",
      max: 10,
      value: 8
    },
    {
      id: "lab-data",
      label: "Лабораторні дані",
      max: 6,
      value: 1
    },
    { id: "materials", label: "Матеріали", max: 8, value: 4 },
    {
      id: "predator-attention",
      label: "Увага хижаків",
      max: 10,
      value: 1
    }
  ],
  reveals: [
    {
      description:
        "База належала компанії, яка створила динозаврів. У її даних можуть бути відомості про слабкі місця тварин.",
      id: "bunker-origin",
      round: 1,
      title: "Походження бункера"
    },
    {
      description:
        "Генератор, майстерня, ліфт і радіопередавач створюють сигнали, що поступово привертають хижаків.",
      id: "they-feel-bunker",
      round: 2,
      title: "Вони відчувають бункер"
    },
    {
      description:
        "Частина динозаврів здатна природно розмножуватися. Нове покоління не матиме закладеного обмеження строку життя.",
      id: "natural-breeding",
      round: 3,
      title: "Проблема не зникне сама"
    },
    {
      description:
        "Технічний тунель веде до інкубатора нового покоління й одночасно містить частину вентиляції бункера.",
      id: "technical-tunnel",
      round: 4,
      title: "Технічний тунель"
    },
    {
      description:
        "Лабораторія може створити генетичний пригнічувач. Альтернативи — знищити інкубатор або заблокувати тунель.",
      id: "last-opportunity",
      round: 5,
      title: "Остання можливість"
    }
  ],
  summary:
    "Сучасні люди через часову аномалію опинилися в епосі динозаврів і знайшли корпоративний підземний комплекс.",
  title: "Операція крейда"
};

export const initialScenarioResources =
  operationChalkScenario.resources.map((resource) => ({ ...resource }));

const BUNKER_SIZE_DESCRIPTORS = [
  "близько 90 квадратних метрів",
  "близько 110 квадратних метрів",
  "близько 130 квадратних метрів",
  "близько 150 квадратних метрів"
];

const RATION_DURATIONS = [
  "дев'ять місяців",
  "десять місяців",
  "дванадцять місяців",
  "чотирнадцять місяців",
  "шістнадцять місяців"
];

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pickStable<T>(pool: readonly T[], seed: string): T {
  const value = pool[stableHash(seed) % pool.length];
  if (value === undefined) {
    throw new Error("Cannot pick from an empty pool");
  }
  return value;
}

export function resolveOperationChalkScenario(
  lobbyCode: string
): PlaytestScenarioView {
  const size = pickStable(BUNKER_SIZE_DESCRIPTORS, `${lobbyCode}:size`);
  const rationMonths = pickStable(RATION_DURATIONS, `${lobbyCode}:rations`);

  return {
    ...operationChalkScenario,
    bunker: {
      ...operationChalkScenario.bunker,
      condition: `Основний корпус герметичний і придатний для життя: ${size} житлового та технічного простору. Генератор працює, але лабораторія та зовнішні модулі пошкоджені.`,
      description: `Покинута підземна база корпорації, яка створювала динозаврів. Продовольчих пайків вистачить щонайменше на ${rationMonths}, але ніхто не знає, скільки насправді доведеться тут перечекати — у часової аномалії немає розкладу. В архівах бази можуть бути дані про слабкі місця тварин.`,
      supplies: operationChalkScenario.bunker.supplies.map((supply) =>
        supply.startsWith("Продовольчі пайки")
          ? `Продовольчі пайки приблизно на ${rationMonths}`
          : supply
      )
    }
  };
}

export type StoredPlaytestCard = Omit<PlaytestCard, "used">;

function toStoredCard(card: CatalogCard): StoredPlaytestCard {
  return {
    description: card.description,
    effectId: card.effectId,
    id: card.id,
    kind: card.kind,
    scope: card.scope,
    selection: card.selection,
    target: card.target,
    timing: card.timing,
    title: card.title
  };
}

const operationChalkCardCatalog = resolveCardCatalog("operation-chalk");

export const allPlaytestCards = operationChalkCardCatalog.map(toStoredCard);

export function findPlaytestCardDefinition(cardId: string): CatalogCard {
  const card = operationChalkCardCatalog.find(
    (candidate) => candidate.id === cardId
  );
  if (card === undefined) {
    throw new Error(`Unsupported playtest card: ${cardId}`);
  }
  return card;
}

function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = result[index];
    const swap = result[swapIndex];
    if (current !== undefined && swap !== undefined) {
      result[index] = swap;
      result[swapIndex] = current;
    }
  }
  return result;
}

export function dealPlaytestCards(
  playerCount: number
): readonly StoredPlaytestCard[] {
  if (playerCount < 2 || playerCount > MAX_GAME_PLAYERS) {
    throw new RangeError("Cannot deal cards for this player count");
  }

  const actions = shuffled(
    allPlaytestCards.filter((card) => card.kind === "action")
  );
  const reactions = shuffled(
    allPlaytestCards.filter((card) => card.kind === "reaction")
  );
  const guaranteedAction = actions.find(
    (card) => (card.selection?.length ?? 0) === 0
  );
  const guaranteedReaction = reactions.find(
    (card) =>
      (card.selection?.length ?? 0) === 0 &&
      card.effectId !== "player.protect"
  );
  if (
    guaranteedAction === undefined ||
    guaranteedReaction === undefined
  ) {
    throw new Error("The playtest deck needs actions and reactions");
  }
  const secondaryReaction = reactions.find(
    (card) => card.id !== guaranteedReaction.id
  );
  const guaranteed: readonly StoredPlaytestCard[] = [
    guaranteedAction,
    guaranteedReaction,
    ...(playerCount >= 4 && secondaryReaction !== undefined
      ? [secondaryReaction]
      : [])
  ];
  const guaranteedIds = new Set(guaranteed.map((card) => card.id));
  const remaining = shuffled(
    allPlaytestCards.filter((card) => !guaranteedIds.has(card.id))
  );

  return shuffled([
    ...guaranteed,
    ...remaining.slice(0, playerCount - guaranteed.length)
  ]);
}

function adjustResource(
  resources: readonly PlaytestResource[],
  id: PlaytestResourceId,
  difference: number
) {
  return resources.map((resource) =>
    resource.id === id
      ? {
          ...resource,
          value: Math.max(
            0,
            Math.min(resource.max, resource.value + difference)
          )
        }
      : { ...resource }
  );
}

export function applyPlaytestCard(
  resources: readonly PlaytestResource[],
  cardId: string,
  selectedResourceId?: PlaytestResourceId
): {
  readonly event: string;
  readonly resources: readonly PlaytestResource[];
  readonly turnExtensionSeconds: number;
} {
  const card = findPlaytestCardDefinition(cardId);
  const effect: CatalogCardEffect = card.effect;
  if (effect.kind === "resource") {
    const adjustments =
      effect.adjustments.length > 0
        ? effect.adjustments
        : selectedResourceId === undefined
          ? [{ amount: -1, resourceId: "integrity" as const }]
          : [{ amount: -1, resourceId: selectedResourceId }];
    return {
      event: `${card.title}: ресурси бункера оновлено.`,
      resources: adjustments.reduce(
        (current, adjustment) =>
          adjustResource(current, adjustment.resourceId, adjustment.amount),
        resources
      ),
      turnExtensionSeconds: 0
    };
  }
  const turnExtensionSeconds =
    effect.kind === "turn_time" && effect.target === "current"
      ? effect.seconds
      : effect.kind === "pause"
        ? effect.seconds
        : 0;
  return {
    event: `${card.title}: ефект застосовано.`,
    resources: resources.map((resource) => ({ ...resource })),
    turnExtensionSeconds
  };
}

export function isPlaytestCardCancelled(reactionCount: number) {
  if (
    !Number.isInteger(reactionCount) ||
    reactionCount < 0 ||
    reactionCount > 2
  ) {
    throw new RangeError("A card chain supports zero to two reactions");
  }
  return reactionCount % 2 === 1;
}

export function parseStoredResources(
  value: unknown
): readonly PlaytestResource[] {
  if (!Array.isArray(value)) {
    return initialScenarioResources;
  }

  const storedValues: readonly unknown[] = value;
  const parsed = initialScenarioResources.map((expected) => {
    const stored = storedValues.find(
      (resource) =>
        typeof resource === "object" &&
        resource !== null &&
        "id" in resource &&
        resource.id === expected.id
    );
    if (
      typeof stored !== "object" ||
      stored === null ||
      !("value" in stored) ||
      typeof stored.value !== "number" ||
      !Number.isFinite(stored.value)
    ) {
      return null;
    }
    return {
      ...expected,
      value: Math.max(
        0,
        Math.min(expected.max, Math.round(stored.value))
      )
    };
  });

  return parsed.some((resource) => resource === null)
    ? initialScenarioResources
    : parsed.filter(
        (resource): resource is PlaytestResource => resource !== null
      );
}

export function parseStoredCard(value: unknown): StoredPlaytestCard {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string"
  ) {
    throw new Error("Started game is missing a playtest card");
  }
  const card = allPlaytestCards.find((candidate) => candidate.id === value.id);
  if (card === undefined) {
    throw new Error("Started game contains an invalid playtest card");
  }
  return { ...card };
}
