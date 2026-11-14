import { useRef, useState } from "react";

import type {
  Lobby,
  MockGameView,
  PlaytestPhase,
  PublicGameView,
  TelegramUser
} from "@bunker/contracts";

import { App } from "./App.js";
import { LobbyScreen } from "./LobbyScreen.js";
import { PublicScreen } from "./PublicScreen.js";

const previewPages = [
  ["entry", "1. Старт гри"],
  ["lobby", "2. Лобі"],
  ["scenario", "3. Оголошення катастрофи"],
  ["character", "4. Мій персонаж · вибір"],
  ["speaking", "5. Особистий виступ"],
  ["table", "6. Публічний стіл"],
  ["bunker", "7. Стан бункера"],
  ["reaction", "8. Вікно реакції"],
  ["discussion", "9. Загальне обговорення"],
  ["voting", "10. Голосування"],
  ["rollback", "11. Відновлення гри"],
  ["final", "12. Фінальна перевірка"],
  ["victory", "13. Перемога"],
  ["loss", "14. Поразка"],
  ["projector", "15. Екран проєктора · 16 гравців"]
] as const;

type PreviewPage = (typeof previewPages)[number][0];

const user: TelegramUser = {
  firstName: "Олена",
  id: "olena"
};

const lobby: Lobby = {
  code: "PREV01",
  hostPlayerId: user.id,
  players: [
    { firstName: "Олена", id: "olena", isHost: true, position: 1, ready: true },
    { firstName: "Максим", id: "maksym", isHost: false, position: 2, ready: true },
    { firstName: "Ірина", id: "iryna", isHost: false, position: 3, ready: false },
    { firstName: "Данило", id: "danylo", isHost: false, position: 4, ready: true }
  ],
  scenarioId: "operation-chalk",
  secretGoalsEnabled: true,
  status: "waiting"
};

const scenario: MockGameView["scenario"] = {
  ageRating: "16+",
  bunker: {
    condition: "Основний корпус герметичний, генератор нестабільний.",
    description:
      "Покинута дослідницька база, частково пошкоджена часовим розломом.",
    limitations: [
      "Генератор потребує щоденного ремонту.",
      "Радіосигнали привертають хижаків."
    ],
    rooms: ["Командний центр", "Лабораторія", "Медичний блок", "Склад"],
    supplies: ["Їжа на 8 місяців", "Фільтри води", "Набір насіння"]
  },
  catastrophe: {
    description:
      "Часова аномалія перенесла групу людей у крейдовий період. За межами бази полюють хижаки, а повернення у свій час не гарантоване.",
    title: "ЧАСОВИЙ РОЗЛОМ"
  },
  contentWarnings: ["небезпека", "смерть", "конфлікт"],
  id: "operation-chalk",
  resources: [
    { id: "energy", label: "Енергія", max: 10, value: 6 },
    { id: "supplies", label: "Запаси", max: 10, value: 7 },
    { id: "integrity", label: "Цілісність", max: 10, value: 5 },
    { id: "lab-data", label: "Лабораторні дані", max: 10, value: 2 }
  ],
  reveals: [
    {
      description:
        "Генератор і передавач поступово привертають увагу хижаків.",
      id: "predator-attention",
      round: 2,
      title: "Вони відчувають бункер"
    }
  ],
  summary: "Вижити серед динозаврів і зберегти людське майбутнє.",
  title: "Операція крейда"
};

function gameFor(page: PreviewPage): MockGameView {
  const speaking = page === "speaking";
  const reaction = page === "reaction";
  const final = page === "final" || page === "victory" || page === "loss";
  const phase: PlaytestPhase =
    page === "scenario"
      ? "scenario_intro"
      : reaction
        ? "reaction"
        : page === "discussion"
          ? "discussion"
          : page === "voting"
            ? "voting"
            : page === "final"
              ? "final_check"
              : page === "victory" || page === "loss"
                ? "completed"
                : "revealing";
  const revealed = speaking || page !== "character";
  const deadline = new Date(
    Date.now() + (page === "discussion" ? 180_000 : 90_000)
  ).toISOString();

  return {
    bunkerCapacity: 2,
    card: reaction
      ? {
          description: "Скасуйте щойно розіграну картку дії.",
          effectId: "card.cancel",
          id: "countermeasure",
          kind: "reaction",
          title: "Контрзахід",
          used: false
        }
      : {
          description: "Додайте 2 одиниці енергії бази.",
          effectId: "resource.energy_gain",
          id: "generator-boost",
          kind: "action",
          title: "Форсаж генератора",
          used: false
        },
    cardChain: reaction
      ? {
          action: {
            description: "Зменшує увагу хижаків на 2.",
            effectId: "resource.predator_attention_down",
            id: "silent-night",
            kind: "action",
            title: "Тиха ніч"
          },
          actionSelection: {},
          actorPlayerId: "maksym",
          deadline: new Date(Date.now() + 15_000).toISOString(),
          reactions: []
        }
      : null,
    cardResult: null,
    characteristics: [
      { id: "profession", label: "Професія", revealed: false, value: "Палеонтолог" },
      { id: "age-gender", label: "Вік і стать", revealed: false, value: "Жінка, 28 років" },
      { id: "health", label: "Здоров’я", revealed, value: "Контрольована астма" },
      { id: "hobby", label: "Хобі", revealed: false, value: "Польова мікроскопія" },
      { id: "baggage", label: "Багаж", revealed: false, value: "Польовий мікроскоп" },
      { id: "character", label: "Характер", revealed: false, value: "Спокійна під тиском" },
      { id: "special-condition", label: "Особливе", revealed: false, value: "Знає латину" }
    ],
    code: "PREV01",
    currentTurnPlayerId:
      phase === "revealing" ? "olena" : reaction ? "maksym" : null,
    demography: final
      ? {
          eligibleMen: page === "loss" ? 0 : 1,
          eligibleWomen: 1,
          femaleAgeRange: { max: 49, min: 18 },
          maleAgeRange: { max: 64, min: 18 },
          preserved: page !== "loss",
          requiredMen: 1,
          requiredWomen: 1
        }
      : null,
    dossierNumber: 7,
    finalOutcome:
      page === "victory" ? "all_survive" : page === "loss" ? "team_loss" : null,
    hostPlayerId: "olena",
    lastEvent: speaking ? "Олена відкрила «Здоров’я» і почала виступ." : null,
    phase,
    players: [
      {
        characteristics: revealed ? { health: "Контрольована астма" } : {},
        firstName: "Олена",
        id: "olena",
        position: 1,
        status: "active"
      },
      {
        characteristics: { character: "Імпульсивний", profession: "Сапер" },
        firstName: "Максим",
        id: "maksym",
        position: 2,
        status: "active"
      },
      {
        characteristics: { hobby: "Спортивна стрільба" },
        firstName: "Ірина",
        id: "iryna",
        position: 3,
        status: final ? "eliminated" : "active"
      },
      {
        characteristics: { "special-condition": "Організовує оборону" },
        firstName: "Данило",
        id: "danylo",
        position: 4,
        status: final ? "eliminated" : "active"
      }
    ],
    rollback: {
      activeBranchId: "00000000-0000-4000-8000-000000000001",
      checkpoints: [
        {
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          eventsAfter: 2,
          id: "00000000-0000-4000-8000-000000000002",
          label: "Початок ходу гравця №1",
          phase: "revealing",
          round: 2
        }
      ],
      paused: false,
      proposal: null
    },
    round: phase === "scenario_intro" ? 1 : 2,
    scenario,
    secretGoal:
      "Потрапте до бункера та збережіть наукове обладнання.",
    status: "started",
    turnDeadline:
      phase === "revealing" || phase === "discussion" ? deadline : null,
    turnRevealedCharacteristicId: speaking ? "health" : null,
    turnStage: phase === "revealing" ? (speaking ? "speaking" : "choosing") : null,
    voting:
      phase === "voting"
        ? {
            attempt: 1,
            candidatePlayerIds: ["olena", "maksym", "iryna", "danylo"],
            expected: 4,
            hasVoted: false,
            openVotes: [],
            silenced: false,
            submitted: 1,
            totals: []
          }
        : null
  };
}

function projectorGame(): PublicGameView {
  const names = [
    "Олена",
    "Максим",
    "Ірина",
    "Данило",
    "Софія",
    "Артем",
    "Марія",
    "Влад",
    "Катерина",
    "Роман",
    "Юлія",
    "Тарас",
    "Оксана",
    "Богдан",
    "Наталя",
    "Андрій"
  ];

  return {
    activeDeadline: new Date(Date.now() + 68_000).toISOString(),
    bunkerCapacity: 8,
    code: "PREV16",
    currentTurnPlayerId: "projector-1",
    finalOutcome: null,
    lastEvent: "Олена відкрила «Професія» і почала виступ.",
    phase: "revealing",
    players: names.map((firstName, index) => ({
      characteristics:
        index === 0
          ? { profession: "Таксидерміст" }
          : index % 3 === 0
            ? { hobby: "Нумізматика" }
            : index % 3 === 1
              ? { baggage: "Вилка та мочалка" }
              : {},
      firstName,
      id: `projector-${index + 1}`,
      position: index + 1,
      status: index === 15 ? "eliminated" : "active"
    })),
    rollbackPaused: false,
    round: 2,
    scenario,
    status: "started",
    turnDeadline: new Date(Date.now() + 68_000).toISOString(),
    turnRevealedCharacteristicId: "profession",
    turnStage: "speaking"
  };
}

export function UiPreview() {
  const initialPage =
    new URLSearchParams(window.location.search).get("page") ?? "scenario";
  const [page, setPage] = useState<PreviewPage>(
    previewPages.some(([id]) => id === initialPage)
      ? (initialPage as PreviewPage)
      : "entry"
  );
  const menuRef = useRef<HTMLDetailsElement>(null);
  const currentPage =
    previewPages.find(([id]) => id === page) ?? previewPages[0];

  const selectPage = (nextPage: PreviewPage) => {
    setPage(nextPage);
    menuRef.current?.removeAttribute("open");
    const url = new URL(window.location.href);
    url.searchParams.set("page", nextPage);
    window.history.replaceState(null, "", url);
  };
  const goTo = (nextPage: PreviewPage) => {
    selectPage(nextPage);
    return Promise.resolve();
  };

  return (
    <div className="ui-preview">
      <details className="ui-preview-menu" ref={menuRef}>
        <summary aria-label="Вибрати екран гри">
          <span>ЕКРАН</span>
          <strong>{currentPage[1]}</strong>
          <small>
            {previewPages.findIndex(([id]) => id === page) + 1}/
            {previewPages.length}
          </small>
        </summary>
        <nav aria-label="Сторінки UI Preview">
          {previewPages.map(([id, label]) => (
            <button
              aria-current={page === id ? "page" : undefined}
              key={id}
              onClick={() => selectPage(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
      </details>
      {page === "projector" ? (
        <PublicScreen code="PREV16" previewGame={projectorGame()} />
      ) : page === "entry" || page === "lobby" ? (
        <LobbyScreen
          key={page}
          previewLobby={page === "lobby" ? lobby : null}
          user={user}
        />
      ) : (
        <App
          currentUser={user}
          game={gameFor(page)}
          initialView={
            page === "table"
              ? "table"
              : page === "bunker"
                ? "bunker"
                : page === "rollback"
                  ? "rollback"
                  : "character"
          }
          key={page}
          onBegin={() => goTo("character")}
          onCardReact={() => goTo("table")}
          onCardUse={() => goTo("reaction")}
          onFinalize={(outcome) =>
            goTo(outcome === "all_survive" ? "victory" : "loss")
          }
          onFinishDiscussion={() => goTo("voting")}
          onFinishTurn={() => goTo("table")}
          onReveal={() => goTo("speaking")}
          onVote={() => goTo("final")}
        />
      )}
    </div>
  );
}
