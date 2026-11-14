import type {
  CardSelectionField,
  CardTarget,
  CardTiming,
  CharacteristicId,
  ContentScope,
  PlaytestCard,
  PlaytestResourceId,
  WeightedContentValue
} from "@bunker/contracts";

export type CatalogCardEffect =
  | {
      readonly adjustments: readonly {
        readonly amount: number;
        readonly resourceId: PlaytestResourceId;
      }[];
      readonly kind: "resource";
    }
  | {
      readonly kind: "turn_time";
      readonly seconds: number;
      readonly target: "current" | "selected_next_turn";
    }
  | {
      readonly characteristicId?: CharacteristicId;
      readonly kind: "characteristic";
      readonly operation:
        | "cure_infertility"
        | "force_reroll"
        | "force_reveal"
        | "hide"
        | "inspect"
        | "reroll"
        | "reveal_extra"
        | "swap";
    }
  | {
      readonly kind: "vote";
      readonly operation:
        | "add"
        | "block"
        | "double"
        | "reduce"
        | "reveal_total"
        | "silence";
    }
  | {
      readonly kind: "card";
      readonly operation: "cancel" | "copy" | "draw" | "recover" | "redirect";
    }
  | {
      readonly kind: "player";
      readonly operation: "protect" | "revive";
    }
  | {
      readonly kind: "order";
      readonly operation: "move_next";
    }
  | {
      readonly kind: "pause";
      readonly seconds: number;
    };

export interface CatalogCard extends Omit<PlaytestCard, "used"> {
  readonly effect: CatalogCardEffect;
  readonly scope: ContentScope;
  readonly selection: readonly CardSelectionField[];
  readonly target: CardTarget;
  readonly timing: CardTiming;
}

const card = (definition: CatalogCard): CatalogCard => definition;

export const COMMON_CARD_CATALOG = [
  card({
    description: "Відкрийте ще одну власну закриту характеристику.",
    effect: { kind: "characteristic", operation: "reveal_extra" },
    effectId: "characteristic.reveal_extra",
    id: "open-file",
    kind: "action",
    scope: "common",
    selection: ["characteristic"],
    target: "self",
    timing: "own_phase",
    title: "Відкрите досьє"
  }),
  card({
    description: "Знову закрийте одну раніше відкриту власну характеристику.",
    effect: { kind: "characteristic", operation: "hide" },
    effectId: "characteristic.hide",
    id: "sealed-file",
    kind: "action",
    scope: "common",
    selection: ["characteristic"],
    target: "self",
    timing: "own_phase",
    title: "Засекречене досьє"
  }),
  card({
    description: "Поміняйтеся багажем з обраним активним гравцем.",
    effect: {
      characteristicId: "baggage",
      kind: "characteristic",
      operation: "swap"
    },
    effectId: "player.swap_baggage",
    id: "baggage-exchange",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Обмін багажем"
  }),
  card({
    description: "Поміняйтеся професією з обраним активним гравцем.",
    effect: {
      characteristicId: "profession",
      kind: "characteristic",
      operation: "swap"
    },
    effectId: "player.swap_profession",
    id: "profession-exchange",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Зміна спеціальності"
  }),
  card({
    description: "Захистіть себе від вибору під час наступного голосування.",
    effect: { kind: "vote", operation: "block" },
    effectId: "vote.block",
    id: "vote-veto",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "self",
    timing: "reaction_window",
    title: "Право вето"
  }),
  card({
    description: "Ваш голос у наступному голосуванні рахується двічі.",
    effect: { kind: "vote", operation: "double" },
    effectId: "vote.double",
    id: "double-vote",
    kind: "action",
    scope: "common",
    selection: [],
    target: "self",
    timing: "own_phase",
    title: "Подвійний голос"
  }),
  card({
    description: "Перенаправте дію на іншого активного гравця.",
    effect: { kind: "card", operation: "redirect" },
    effectId: "vote.redirect",
    id: "redirect",
    kind: "reaction",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "reaction_window",
    title: "Зміна адресата"
  }),
  card({
    description: "Скасуйте щойно розіграну картку дії.",
    effect: { kind: "card", operation: "cancel" },
    effectId: "card.cancel",
    id: "countermeasure",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "game",
    timing: "reaction_window",
    title: "Контрзахід"
  }),
  card({
    description: "Повторіть ефект щойно розіграної картки дії.",
    effect: { kind: "card", operation: "copy" },
    effectId: "card.copy",
    id: "mirror-protocol",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "game",
    timing: "reaction_window",
    title: "Дзеркальний протокол"
  }),
  card({
    description: "Отримайте копію однієї вже використаної картки.",
    effect: { kind: "card", operation: "recover" },
    effectId: "card.recover",
    id: "reserve-copy",
    kind: "action",
    scope: "common",
    selection: [],
    target: "self",
    timing: "own_phase",
    title: "Резервна копія"
  }),
  card({
    description: "Продовжте поточний хід на 30 секунд.",
    effect: { kind: "turn_time", seconds: 30, target: "current" },
    effectId: "time.extend",
    id: "extra-minute",
    kind: "action",
    scope: "common",
    selection: [],
    target: "self",
    timing: "own_phase",
    title: "Додатковий час"
  }),
  card({
    description: "Скоротіть наступний хід обраного гравця на 30 секунд.",
    effect: {
      kind: "turn_time",
      seconds: -30,
      target: "selected_next_turn"
    },
    effectId: "time.reduce",
    id: "time-pressure",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Тиск часу"
  }),
  card({
    description: "Таємно перегляньте закриту характеристику іншого гравця.",
    effect: { kind: "characteristic", operation: "inspect" },
    effectId: "characteristic.inspect",
    id: "private-review",
    kind: "action",
    scope: "common",
    selection: ["target_player", "characteristic"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Приватна перевірка"
  }),
  card({
    description: "Якщо дія спрямована на вас, скасуйте її вплив на себе.",
    effect: { kind: "player", operation: "protect" },
    effectId: "player.protect",
    id: "temporary-immunity",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "self",
    timing: "reaction_window",
    title: "Тимчасовий імунітет"
  }),
  card({
    description: "Публічно відкрийте вибрану характеристику іншого гравця.",
    effect: { kind: "characteristic", operation: "force_reveal" },
    effectId: "characteristic.force_reveal",
    id: "forced-disclosure",
    kind: "action",
    scope: "common",
    selection: ["target_player", "characteristic"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Примусове розкриття"
  }),
  card({
    description: "Перегенеруйте одну власну закриту характеристику.",
    effect: { kind: "characteristic", operation: "reroll" },
    effectId: "characteristic.reroll_unrevealed",
    id: "new-file",
    kind: "action",
    scope: "common",
    selection: ["characteristic"],
    target: "self",
    timing: "own_phase",
    title: "Нове досьє"
  }),
  card({
    description: "Поставте обраного гравця наступним у черзі цього раунду.",
    effect: { kind: "order", operation: "move_next" },
    effectId: "order.swap",
    id: "change-order",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Зміна черговості"
  }),
  card({
    description: "Замініть цю картку випадковою невиданою карткою.",
    effect: { kind: "card", operation: "draw" },
    effectId: "card.draw",
    id: "second-copy",
    kind: "action",
    scope: "common",
    selection: [],
    target: "self",
    timing: "own_phase",
    title: "Другий примірник"
  }),
  card({
    description: "Додайте один автоматичний голос проти обраного гравця.",
    effect: { kind: "vote", operation: "add" },
    effectId: "vote.add",
    id: "public-accusation",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Публічне звинувачення"
  }),
  card({
    description: "Приберіть один голос, поданий проти вас у наступному голосуванні.",
    effect: { kind: "vote", operation: "reduce" },
    effectId: "vote.remove",
    id: "documented-alibi",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "self",
    timing: "reaction_window",
    title: "Задокументоване алібі"
  }),
  card({
    description: "Зробіть проміжні голоси публічними до завершення раунду.",
    effect: { kind: "vote", operation: "reveal_total" },
    effectId: "vote.reveal_total",
    id: "sealed-ballot",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "game",
    timing: "reaction_window",
    title: "Опечатана урна"
  }),
  card({
    description: "Поверніть одного виключеного гравця до активної групи.",
    effect: { kind: "player", operation: "revive" },
    effectId: "player.revive",
    id: "first-aid",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "eliminated_player",
    timing: "own_phase",
    title: "Перша допомога"
  }),
  card({
    description: "Продовжте поточний хід на 30 секунд.",
    effect: { kind: "turn_time", seconds: 30, target: "current" },
    effectId: "time.extend",
    id: "calm-command",
    kind: "action",
    scope: "common",
    selection: [],
    target: "game",
    timing: "own_phase",
    title: "Спокійна команда"
  }),
  card({
    description: "Скасуйте щойно розіграну картку дії.",
    effect: { kind: "card", operation: "cancel" },
    effectId: "card.cancel",
    id: "compromise",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "game",
    timing: "reaction_window",
    title: "Компроміс"
  }),
  card({
    description: "Захистіть обраного гравця від наступного голосування.",
    effect: { kind: "player", operation: "protect" },
    effectId: "player.protect",
    id: "temporary-alliance",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Тимчасовий союз"
  }),
  card({
    description: "Додайте 60 секунд до ходу після завершення вікна реакції.",
    effect: { kind: "pause", seconds: 60 },
    effectId: "game.pause_request",
    id: "emergency-pause",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "game",
    timing: "reaction_window",
    title: "Аварійна пауза"
  }),
  card({
    description: "Поміняйте вибрану характеристику з іншим активним гравцем.",
    effect: { kind: "characteristic", operation: "swap" },
    effectId: "characteristic.swap",
    id: "swap-facts",
    kind: "action",
    scope: "common",
    selection: ["target_player", "characteristic"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Обмін фактами"
  }),
  card({
    description: "Перенаправте дію на іншого активного гравця.",
    effect: { kind: "card", operation: "redirect" },
    effectId: "vote.redirect",
    id: "last-argument",
    kind: "reaction",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "reaction_window",
    title: "Останній аргумент"
  }),
  card({
    description: "Поміняйтесь обраною характеристикою з іншим активним гравцем.",
    effect: { kind: "characteristic", operation: "swap" },
    effectId: "characteristic.swap",
    id: "paper-trail-swap",
    kind: "action",
    scope: "common",
    selection: ["target_player", "characteristic"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Обмін документами"
  }),
  card({
    description: "Отримайте копію однієї вже використаної картки.",
    effect: { kind: "card", operation: "recover" },
    effectId: "card.recover",
    id: "second-attempt",
    kind: "action",
    scope: "common",
    selection: [],
    target: "self",
    timing: "own_phase",
    title: "Друга спроба"
  }),
  card({
    description: "Додайте один автоматичний голос проти обраного гравця.",
    effect: { kind: "vote", operation: "add" },
    effectId: "vote.add",
    id: "leaked-file",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Компромат"
  }),
  card({
    description: "Захистіть обраного гравця від наступного голосування.",
    effect: { kind: "player", operation: "protect" },
    effectId: "player.protect",
    id: "cover-story",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Прикриття"
  }),
  card({
    description: "Захистіть себе від вибору під час наступного голосування.",
    effect: { kind: "vote", operation: "block" },
    effectId: "vote.block",
    id: "unbreakable-alibi",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "self",
    timing: "reaction_window",
    title: "Незламне алібі"
  }),
  card({
    description: "Приберіть один голос, поданий проти вас у наступному голосуванні.",
    effect: { kind: "vote", operation: "reduce" },
    effectId: "vote.remove",
    id: "clean-record",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "self",
    timing: "reaction_window",
    title: "Чисте досьє"
  }),
  card({
    description: "Замініть цю картку випадковою невиданою карткою.",
    effect: { kind: "card", operation: "draw" },
    effectId: "card.draw",
    id: "fresh-deck",
    kind: "action",
    scope: "common",
    selection: [],
    target: "self",
    timing: "own_phase",
    title: "Нова колода"
  }),
  card({
    description: "Поставте обраного гравця наступним у черзі цього раунду.",
    effect: { kind: "order", operation: "move_next" },
    effectId: "order.swap",
    id: "cut-the-line",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Пропуск черги"
  }),
  card({
    description: "Таємно перегляньте закриту характеристику іншого гравця.",
    effect: { kind: "characteristic", operation: "inspect" },
    effectId: "characteristic.inspect",
    id: "surveillance",
    kind: "action",
    scope: "common",
    selection: ["target_player", "characteristic"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Стеження"
  }),
  card({
    description:
      "До кінця раунду ніхто не може вголос аргументувати свій голос — лише мовчазне голосування.",
    effect: { kind: "turn_time", seconds: 0, target: "current" },
    effectId: "time.extend",
    id: "silent-vote",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "game",
    timing: "reaction_window",
    title: "Мовчання"
  }),
  card({
    description:
      "Уголос назвіть одну зі своїх закритих характеристик — не відкриваючи її офіційно. Правда це чи блеф, вирішує стіл.",
    effect: { kind: "turn_time", seconds: 0, target: "current" },
    effectId: "time.extend",
    id: "public-bluff",
    kind: "action",
    scope: "common",
    selection: [],
    target: "self",
    timing: "own_phase",
    title: "Публічний блеф"
  }),
  card({
    description: "Повторіть ефект щойно розіграної картки дії.",
    effect: { kind: "card", operation: "copy" },
    effectId: "card.copy",
    id: "double-strike",
    kind: "reaction",
    scope: "common",
    selection: [],
    target: "game",
    timing: "reaction_window",
    title: "Повторний удар"
  }),
  card({
    description: "Знову закрийте одну раніше відкриту власну характеристику.",
    effect: { kind: "characteristic", operation: "hide" },
    effectId: "characteristic.hide",
    id: "re-sealed-file",
    kind: "action",
    scope: "common",
    selection: ["characteristic"],
    target: "self",
    timing: "own_phase",
    title: "Повторне засекречення"
  }),
  card({
    description: "Публічно відкрийте вибрану характеристику іншого гравця.",
    effect: { kind: "characteristic", operation: "force_reveal" },
    effectId: "characteristic.force_reveal",
    id: "information-leak",
    kind: "action",
    scope: "common",
    selection: ["target_player", "characteristic"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Витік інформації"
  }),
  card({
    description: "Відкрийте ще одну власну закриту характеристику.",
    effect: { kind: "characteristic", operation: "reveal_extra" },
    effectId: "characteristic.reveal_extra",
    id: "second-dossier",
    kind: "action",
    scope: "common",
    selection: ["characteristic"],
    target: "self",
    timing: "own_phase",
    title: "Друге досьє"
  }),
  card({
    description: "Поверніть одного виключеного гравця до активної групи.",
    effect: { kind: "player", operation: "revive" },
    effectId: "player.revive",
    id: "second-wind",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "eliminated_player",
    timing: "own_phase",
    title: "Друге дихання"
  }),
  card({
    description: "Голос обраного гравця не враховується в цьому голосуванні.",
    effect: { kind: "vote", operation: "silence" },
    effectId: "vote.silence",
    id: "discredit",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Дискредитація"
  }),
  card({
    description:
      "Примусово перегенеруйте вже відкриту характеристику іншого гравця.",
    effect: { kind: "characteristic", operation: "force_reroll" },
    effectId: "characteristic.force_reroll",
    id: "fake-diploma",
    kind: "action",
    scope: "common",
    selection: ["target_player", "characteristic"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Фейковий диплом"
  }),
  card({
    description:
      "Обраний гравець отримує репродуктивну здатність — це може допомогти пройти демографію.",
    effect: {
      characteristicId: "special-condition",
      kind: "characteristic",
      operation: "cure_infertility"
    },
    effectId: "characteristic.cure_infertility",
    id: "good-pills",
    kind: "action",
    scope: "common",
    selection: ["target_player"],
    target: "any_non_afk_player",
    timing: "own_phase",
    title: "Хороші пігулки"
  })
] as const satisfies readonly CatalogCard[];

export const OPERATION_CHALK_CARD_CATALOG = [] as const satisfies readonly CatalogCard[];

function profession(
  id: string,
  label: string,
  tags: readonly string[] = []
): WeightedContentValue {
  return { id, label, rarity: "common", tags, weight: 1 };
}

export const COMMON_PROFESSION_CATALOG = [
  profession("hoa-chat-admin", "Адміністратор чату ОСББ", ["social"]),
  profession("peak-crypto-trader", "Криптотрейдер, який зайшов на піку", ["finance"]),
  profession("webinar-survival-coach", "Коуч із виживання після трьох вебінарів", ["survival"]),
  profession("duct-tape-repairer", "Майстер ремонту всього армованим скотчем", ["technical", "repair"]),
  profession("snail-veterinarian", "Ветеринар екзотичних равликів", ["medicine", "animals"]),
  profession("go-bag-influencer", "Інфлюенсер з оглядів тривожних валіз", ["social"]),
  profession("ration-taster", "Дегустатор сухпайків", ["food"]),
  profession("apocalypse-accountant", "Бухгалтер апокаліпсису", ["finance", "logistics"]),
  profession("small-event-host", "Тамада для дуже камерних подій", ["social"]),
  profession("empty-drone-operator", "Оператор дрона з розрядженим пультом", ["technical", "observation"]),
  profession("system-administrator", "Системний адміністратор", ["technical"]),
  profession("taxidermist", "Таксидерміст", ["animals", "craft"]),
  profession("trading-quality-auditor", "Trading Quality Auditor", ["finance", "observation"]),
  profession("street-racer", "Вуличний гонщик", ["mobility"]),
  profession("third-wave-barista", "Бариста третьої хвилі", ["food", "social"])
] as const satisfies readonly WeightedContentValue[];

export const FERTILITY_SPECIALIST_PROFESSION_LABEL = "Репродуктолог";

export const OPERATION_CHALK_PROFESSION_CATALOG = [
  profession("paleontologist", "Палеонтолог", ["science", "dinosaurs"]),
  profession("veterinarian", "Ветеринар", ["medicine", "animals"]),
  profession("geneticist", "Генетик", ["science", "genetics", "laboratory"]),
  profession("electrical-engineer", "Інженер-електрик", ["technical", "energy"]),
  profession("mechanical-engineer", "Інженер-механік", ["technical", "repair"]),
  profession("emergency-doctor", "Лікар невідкладної допомоги", ["medicine", "leadership"]),
  profession("surgeon", "Хірург", ["medicine", "precision"]),
  profession("botanist", "Ботанік", ["science", "agriculture"]),
  profession("chemist", "Хімік-технолог", ["science", "chemistry", "laboratory"]),
  profession("survival-instructor", "Інструктор із виживання", ["survival", "leadership"]),
  profession("radio-engineer", "Радіоінженер", ["technical", "communications"]),
  profession("geologist", "Геолог", ["science", "exploration"]),
  profession("cook-technologist", "Кухар-технолог", ["food", "logistics"]),
  profession("logistics-coordinator", "Координатор логістики", ["logistics", "leadership"]),
  profession(
    "fertility-specialist",
    FERTILITY_SPECIALIST_PROFESSION_LABEL,
    ["medicine", "genetics"]
  ),
  profession("sexologist", "Сексолог", ["medicine", "social"]),
  profession("tattoo-artist", "Тату-майстер", ["craft", "social"])
] as const satisfies readonly WeightedContentValue[];

export function resolveCardCatalog(scenarioId: string): readonly CatalogCard[] {
  return scenarioId === "operation-chalk"
    ? [...COMMON_CARD_CATALOG, ...OPERATION_CHALK_CARD_CATALOG]
    : COMMON_CARD_CATALOG;
}

export function resolveProfessionCatalog(
  scenarioId: string
): readonly WeightedContentValue[] {
  return scenarioId === "operation-chalk"
    ? [...COMMON_PROFESSION_CATALOG, ...OPERATION_CHALK_PROFESSION_CATALOG]
    : COMMON_PROFESSION_CATALOG;
}
