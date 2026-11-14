import { useEffect, useMemo, useRef, useState } from "react";

import {
  CHARACTERISTIC_CATEGORIES,
  type CharacteristicId,
  type MockGameView,
  type PlaytestCardSelection,
  type TelegramUser
} from "@bunker/contracts";

import { LobbyApiError, serverNow } from "./lobby-api.js";

type View = "bunker" | "character" | "rollback" | "table";

function describeActionError(error: unknown, fallback: string): string {
  return error instanceof LobbyApiError ? error.message : fallback;
}

interface Characteristic {
  readonly category: string;
  readonly id: CharacteristicId;
  readonly open: boolean;
  readonly value: string;
}

interface Player {
  readonly characteristics: Partial<
    Record<CharacteristicId, string>
  >;
  readonly id: string;
  readonly name: string;
  readonly status: "playing" | "eliminated";
}

function withoutCardSelectionField(
  selection: PlaytestCardSelection,
  field: keyof PlaytestCardSelection
): PlaytestCardSelection {
  return Object.fromEntries(
    Object.entries(selection).filter(([key]) => key !== field)
  );
}

function isReactionCompatible(
  game: MockGameView,
  playerId: string
): boolean {
  if (
    game.phase !== "reaction" ||
    game.card.kind !== "reaction" ||
    game.cardChain === null ||
    game.cardChain.reactions.length === 1
  ) {
    return true;
  }
  if (game.card.effectId === "player.protect") {
    return game.cardChain.actionSelection.targetPlayerId === playerId;
  }
  if (game.card.effectId === "vote.redirect") {
    return (
      game.cardChain.actionSelection.targetPlayerId !== undefined &&
      game.cardChain.action.target === "any_non_afk_player"
    );
  }
  return true;
}

const initialCharacteristics: readonly Characteristic[] = [
  {
    category: "Професія",
    id: "profession",
    open: false,
    value: "Палеонтолог"
  },
  {
    category: "Вік і стать",
    id: "age-gender",
    open: false,
    value: "Жінка, 28 років"
  },
  {
    category: "Здоров’я",
    id: "health",
    open: false,
    value: "Контрольована астма"
  },
  {
    category: "Хобі",
    id: "hobby",
    open: false,
    value: "Польова мікроскопія"
  },
  {
    category: "Багаж",
    id: "baggage",
    open: false,
    value: "Польовий мікроскоп"
  },
  {
    category: "Характер",
    id: "character",
    open: false,
    value: "Спокійна під тиском"
  },
  {
    category: "Особливе",
    id: "special-condition",
    open: false,
    value: "Знає латину"
  }
];

const initialPlayers: readonly Player[] = [
  {
    characteristics: {},
    id: "olena",
    name: "Олена",
    status: "playing"
  },
  {
    characteristics: {},
    id: "maksym",
    name: "Максим",
    status: "playing"
  },
  {
    characteristics: {},
    id: "iryna",
    name: "Ірина",
    status: "playing"
  },
  {
    characteristics: {},
    id: "danylo",
    name: "Данило",
    status: "playing"
  },
  {
    characteristics: {},
    id: "sofia",
    name: "Софія",
    status: "playing"
  },
  {
    characteristics: {},
    id: "artem",
    name: "Артем",
    status: "playing"
  },
  {
    characteristics: {
      "age-gender": "Жінка, 43 роки",
      baggage: "Аптечка",
      character: "Обережна",
      health: "Цілком здорова",
      hobby: "Садівництво",
      profession: "Фармацевт",
      "special-condition": "Досліджує прийоми виживання"
    },
    id: "maria",
    name: "Марія",
    status: "eliminated"
  }
];

const demoCurrentTurnPlayerId = "olena";
const demoSecretGoal =
  "Потрапте до бункера та збережіть наукове обладнання. Ціль виконана, якщо у фінальній групі немає іншого персонажа з науковою спеціалізацією.";

interface CharacterViewProps {
  readonly canReveal: boolean;
  readonly characteristics: readonly Characteristic[];
  readonly dossierHidden: boolean;
  readonly dossierNumber: number;
  readonly onSelect: (id: CharacteristicId) => void;
  readonly onToggleHidden: () => void;
  readonly requiredCharacteristicId?: CharacteristicId | null;
  readonly secretGoal: string | null;
  readonly selectedId: CharacteristicId | null;
}

function CharacterView({
  canReveal,
  characteristics,
  dossierHidden,
  dossierNumber,
  onSelect,
  onToggleHidden,
  requiredCharacteristicId,
  secretGoal,
  selectedId
}: CharacterViewProps) {
  return (
    <section className="panel dossier-panel" aria-labelledby="dossier-title">
      <div className="dossier-header">
        <div className="dossier-header-left">
          <span className="private-badge">ЛИШЕ ДЛЯ ВАС</span>
          <h2 className="dossier-number" id="dossier-title">
            Досьє №{String(dossierNumber).padStart(2, "0")}
          </h2>
        </div>
        <button
          className="hide-btn"
          onClick={onToggleHidden}
          type="button"
          aria-pressed={dossierHidden}
        >
          {dossierHidden ? "Показати" : "Приховати"}
        </button>
      </div>

      <ul className="char-list">
        {characteristics.map((characteristic) => {
          const selected = characteristic.id === selectedId;
          const disabled =
            characteristic.open ||
            dossierHidden ||
            !canReveal ||
            (requiredCharacteristicId != null &&
              characteristic.id !== requiredCharacteristicId);

          return (
            <li className="char-row" key={characteristic.id}>
              <button
                className={`char-button${selected ? " selected" : ""}`}
                disabled={disabled}
                onClick={() => onSelect(characteristic.id)}
                type="button"
                aria-pressed={selected}
              >
                <span className="char-info">
                  <span className="char-category">
                    {characteristic.category}
                  </span>
                  <span className="char-value">
                    {dossierHidden ? "••••••••" : characteristic.value}
                  </span>
                </span>
                <span
                  className={`char-status ${
                    characteristic.open
                      ? "open"
                      : selected
                        ? "selected"
                        : "closed"
                  }`}
                >
                  {characteristic.open
                    ? "ВІДКРИТО"
                    : selected
                      ? "ОБРАНО"
                      : "НЕ ВІДКРИТО"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {secretGoal !== null && (
        <div className="secret-section">
          <div className="secret-label">ТАЄМНА ЦІЛЬ</div>
          <p className="secret-text">
            {dossierHidden ? "Досьє приховано" : secretGoal}
          </p>
        </div>
      )}
    </section>
  );
}

function ClosedCell() {
  return (
    <span className="cell-closed" aria-label="Закрито">
      <span aria-hidden="true">—</span>
    </span>
  );
}

interface TableViewProps {
  readonly bunkerCapacity: number;
  readonly currentTurnPlayerId: string | null;
  readonly mockMode: boolean;
  readonly players: readonly Player[];
  readonly scenario?: MockGameView["scenario"];
}

function TableView({
  bunkerCapacity,
  currentTurnPlayerId,
  mockMode,
  players,
  scenario
}: TableViewProps) {
  const latestReveal = scenario?.reveals.at(-1);
  return (
    <section className="panel table-panel" aria-labelledby="table-title">
      <div className="table-header">
        <div className="table-header-left">
          <span className="public-label">ПУБЛІЧНА ПРОЄКЦІЯ</span>
          <h2 id="table-title">Стіл</h2>
        </div>
        <span className="live-badge">
          <span className="live-dot-icon" aria-hidden="true" />
          НАЖИВО
        </span>
      </div>

      <div className="scenario-note">
        <span className="scenario-num">
          {latestReveal === undefined
            ? mockMode
              ? "СЦЕНАРІЙ 01"
              : "ВІДКРИТТЯ 02"
            : `ВІДКРИТТЯ ${String(latestReveal.round).padStart(2, "0")}`}
        </span>
        <h3>
          {latestReveal?.title ??
            (mockMode ? "Операція крейда" : "Вони відчувають бункер")}
        </h3>
        <p>
          {latestReveal?.description ??
            (mockMode
            ? "Часова аномалія закинула вас в епоху динозаврів. Покинута корпоративна база пошкоджена, а місць вистачить не всім. Потрапте до бункера й збережіть життєздатну демографію."
            : "Генератор і радіопередавач поступово привертають увагу хижаків. Кожна активність збільшує рівень загрози.")}
        </p>
      </div>

      <ul className="mobile-player-list" aria-label="Гравці за столом">
        {players.map((player, index) => {
          const eliminated = player.status === "eliminated";
          const speaking = player.id === currentTurnPlayerId;
          const revealed = CHARACTERISTIC_CATEGORIES.flatMap((category) => {
            const value = player.characteristics[category.id];
            return value === undefined
              ? []
              : [{ label: category.label, value }];
          });

          return (
            <li
              className={`mobile-player-card${
                eliminated ? " eliminated" : ""
              }${speaking ? " speaking" : ""}`}
              key={player.id}
            >
              <header>
                <span className="mobile-player-number">{index + 1}</span>
                <span className="ptable-avatar" aria-hidden="true">
                  {player.name.slice(0, 1)}
                </span>
                <strong>{player.name}</strong>
                <span className="mobile-player-state">
                  {speaking ? "ГОВОРИТЬ" : eliminated ? "ВИБУВ" : "У ГРІ"}
                </span>
              </header>
              {revealed.length === 0 ? (
                <p>Характеристики ще не відкриті</p>
              ) : (
                <dl>
                  {revealed.map((fact) => (
                    <div key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>

      <p className="scroll-hint">Проведіть таблицю вбік, щоб побачити більше</p>

      <div className="ptable-wrap" tabIndex={0} aria-label="Таблиця з прокруткою">
        <table className="ptable" aria-label="Публічні характеристики гравців">
          <thead>
            <tr>
              <th className="ptable-th ptable-th-num">#</th>
              <th className="ptable-th ptable-th-name">Гравець</th>
              {CHARACTERISTIC_CATEGORIES.map((category) => (
                <th className="ptable-th" key={category.id}>
                  {category.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((player, index) => {
              const eliminated = player.status === "eliminated";
              const speaking = player.id === currentTurnPlayerId;

              return (
                <tr
                  className={`ptable-row${eliminated ? " eliminated" : ""}${
                    speaking ? " speaking" : ""
                  }`}
                  key={player.id}
                >
                  <td className="ptable-num">{index + 1}</td>
                  <td className="ptable-player-cell">
                    <div className="ptable-player-inner">
                      <span
                        className={`ptable-avatar${eliminated ? " dim" : ""}`}
                        aria-hidden="true"
                      >
                        {player.name.slice(0, 1)}
                      </span>
                      <span className="ptable-pname">
                        {player.name}
                        {speaking && (
                          <span className="ptable-tag speaking">говорить</span>
                        )}
                        {eliminated && (
                          <span className="ptable-tag elim">вибула</span>
                        )}
                      </span>
                    </div>
                  </td>
                  {CHARACTERISTIC_CATEGORIES.map((category) => {
                    const value = player.characteristics[category.id];

                    return (
                      <td
                        className={`ptable-cell${value ? " revealed" : ""}`}
                        key={category.id}
                      >
                        {value ?? <ClosedCell />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="seats-info">
        <span className="seats-label">МІСЦЬ У БУНКЕРІ</span>
        <span className="seats-value">
          {bunkerCapacity}{" "}
          <span className="seats-of">/ {players.length} гравців</span>
        </span>
      </div>
    </section>
  );
}

function ResourceGrid({
  resources
}: {
  readonly resources: MockGameView["scenario"]["resources"];
}) {
  return (
    <div className="resource-grid" aria-label="Ресурси бункера">
      {resources.map((resource) => (
        <div className="resource-card" key={resource.id}>
          <div className="resource-heading">
            <span>{resource.label}</span>
            <strong>
              {resource.value}/{resource.max}
            </strong>
          </div>
          <div
            aria-label={`${resource.label}: ${resource.value} з ${resource.max}`}
            aria-valuemax={resource.max}
            aria-valuemin={0}
            aria-valuenow={resource.value}
            className="resource-track"
            role="meter"
          >
            <span
              style={{
                width: `${Math.round((resource.value / resource.max) * 100)}%`
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function BunkerView({
  scenario
}: {
  readonly scenario: MockGameView["scenario"];
}) {
  return (
    <section className="panel bunker-panel" aria-labelledby="bunker-title">
      <span className="public-label">ДАНІ КОМПЛЕКСУ</span>
      <h2 id="bunker-title">Бункер</h2>
      <p className="bunker-description">{scenario.bunker.description}</p>

      <div className="bunker-condition">
        <span>СТАН</span>
        <p>{scenario.bunker.condition}</p>
      </div>

      <ResourceGrid resources={scenario.resources} />

      <div className="bunker-columns">
        <section>
          <h3>Приміщення</h3>
          <ul>
            {scenario.bunker.rooms.map((room) => (
              <li key={room}>{room}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Запаси</h3>
          <ul>
            {scenario.bunker.supplies.map((supply) => (
              <li key={supply}>{supply}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="bunker-limitations">
        <h3>Обмеження</h3>
        <ul>
          {scenario.bunker.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>

      <section className="reveal-history">
        <h3>Відомості сценарію</h3>
        {scenario.reveals.map((reveal) => (
          <article key={reveal.id}>
            <span>РАУНД {String(reveal.round).padStart(2, "0")}</span>
            <h4>{reveal.title}</h4>
            <p>{reveal.description}</p>
          </article>
        ))}
      </section>
    </section>
  );
}

interface ScenarioIntroProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly isHost: boolean;
  readonly onBegin?: () => Promise<void>;
  readonly onFinish?: () => void;
  readonly scenario: MockGameView["scenario"];
}

function ScenarioIntro({
  busy,
  error,
  isHost,
  onBegin,
  onFinish,
  scenario
}: ScenarioIntroProps) {
  const [step, setStep] = useState<"catastrophe" | "bunker">(
    "catastrophe"
  );

  return (
    <main className={`app-shell intro-shell intro-${step}`}>
      {step === "catastrophe" ? (
        <>
          <section className="catastrophe-hero">
            <span className="topbar-brand">{scenario.title}</span>
            <span className="intro-kicker">ОГОЛОШЕННЯ КАТАСТРОФИ</span>
            <h1>{scenario.catastrophe.title}</h1>
            <p>{scenario.catastrophe.description}</p>
            <div className="intro-meta">
              <span>{scenario.ageRating}</span>
              <span>{scenario.summary}</span>
            </div>
          </section>

          <section className="intro-warning" aria-label="Попередження про контент">
            <span>ТЕМИ СЦЕНАРІЮ</span>
            <p>{scenario.contentWarnings.join(" · ")}</p>
          </section>

          <button
            className="primary-action intro-begin"
            onClick={() => setStep("bunker")}
            type="button"
          >
            Переглянути бункер
          </button>
        </>
      ) : (
        <>
          <header className="intro-briefing">
            <button
              className="intro-back"
              onClick={() => setStep("catastrophe")}
              type="button"
            >
              ← Катастрофа
            </button>
            <span>БРИФІНГ ПЕРЕД ЗАПУСКОМ</span>
            <h1>Що залишилось людству</h1>
            <p>
              Оцініть стан комплексу, запаси й обмеження. Саме цей бункер
              визначає, хто буде корисним у фінальній групі.
            </p>
          </header>

          <BunkerView scenario={scenario} />

          {isHost ? (
            <button
              className="primary-action intro-begin"
              disabled={busy}
              onClick={() => void onBegin?.()}
              type="button"
            >
              Оголосити катастрофу й почати
            </button>
          ) : (
            <p className="intro-wait" aria-live="polite">
              Ведучий оголошує катастрофу. Після підтвердження почнеться
              перший хід.
            </p>
          )}
          {error !== null && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}

      {onFinish !== undefined && (
        <button
          className="secondary-action danger-action intro-cancel"
          onClick={onFinish}
          type="button"
        >
          Завершити гру
        </button>
      )}
    </main>
  );
}

function secondsUntil(deadline: string | null | undefined) {
  if (deadline === null || deadline === undefined) {
    return null;
  }
  return Math.max(0, Math.ceil((Date.parse(deadline) - serverNow()) / 1_000));
}

function useDeadlineCountdown(deadline: string | null | undefined) {
  const [seconds, setSeconds] = useState(() => secondsUntil(deadline));

  useEffect(() => {
    setSeconds(secondsUntil(deadline));
    if (deadline === null || deadline === undefined) {
      return;
    }
    const interval = window.setInterval(
      () => setSeconds(secondsUntil(deadline)),
      250
    );
    return () => window.clearInterval(interval);
  }, [deadline]);

  return seconds;
}

function describeVoteCandidate(player: MockGameView["players"][number]) {
  const name = `${player.firstName} ${player.lastName ?? ""}`.trim();
  const profession = player.characteristics.profession;
  return profession === undefined
    ? `#${player.position} · ${name}`
    : `#${player.position} · ${name} (${profession})`;
}

function formatCountdown(seconds: number | null) {
  if (seconds === null) {
    return "—:——";
  }
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(
    seconds % 60
  ).padStart(2, "0")}`;
}

interface RevealDialogProps {
  readonly busy: boolean;
  readonly characteristic: Characteristic;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function RevealDialog({
  busy,
  characteristic,
  onCancel,
  onConfirm
}: RevealDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      className="reveal-dialog"
      ref={dialogRef}
      aria-labelledby="reveal-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <span className="dialog-eyebrow">ПУБЛІЧНЕ ВІДКРИТТЯ</span>
      <h2 id="reveal-title">Відкрити «{characteristic.category}»?</h2>
      <p>Після підтвердження всі гравці побачать:</p>
      <strong>{characteristic.value}</strong>
      <div className="dialog-actions">
        <button
          className="secondary-action"
          disabled={busy}
          onClick={onCancel}
          type="button"
          autoFocus
        >
          Скасувати
        </button>
        <button
          className="primary-action inline"
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          Відкрити публічно
        </button>
      </div>
    </dialog>
  );
}

interface RollbackPanelProps {
  readonly busy: boolean;
  readonly game: MockGameView;
  readonly isHost: boolean;
  readonly onCancel?: () => Promise<void>;
  readonly onPropose?: (
    checkpointId: string,
    reason: string
  ) => Promise<void>;
  readonly onResume?: () => Promise<void>;
  readonly onVote?: (approve: boolean) => Promise<void>;
}

function RollbackPanel({
  busy,
  game,
  isHost,
  onCancel,
  onPropose,
  onResume,
  onVote
}: RollbackPanelProps) {
  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const proposal = game.rollback.proposal;

  if (proposal !== null) {
    return (
      <section className="panel rollback-panel" aria-live="assertive">
        <span className="public-label">ГРА ПРИЗУПИНЕНА</span>
        <h2>Повернутися до контрольної точки?</h2>
        <div className="rollback-target">
          <strong>{proposal.checkpointLabel}</strong>
          <p>{proposal.reason}</p>
        </div>
        <p className="rollback-progress">
          Підтримали: {proposal.approvals} / {proposal.requiredApprovals}
          {proposal.rejections > 0
            ? ` · Проти: ${proposal.rejections}`
            : ""}
        </p>
        <p>
          Після схвалення буде створено нову гілку. Відкриті після цієї
          точки характеристики зміняться під час наступного відкриття.
        </p>
        {!proposal.hasVoted && (
          <div className="rollback-actions">
            <button
              className="primary-action inline"
              disabled={busy}
              onClick={() => void onVote?.(true)}
              type="button"
            >
              Підтримати
            </button>
            <button
              className="secondary-action"
              disabled={busy}
              onClick={() => void onVote?.(false)}
              type="button"
            >
              Відхилити
            </button>
          </div>
        )}
        {proposal.hasVoted && (
          <p className="rollback-wait">Ваш голос прийнято.</p>
        )}
        {isHost && (
          <button
            className="secondary-action danger-action"
            disabled={busy}
            onClick={() => void onCancel?.()}
            type="button"
          >
            Скасувати відновлення
          </button>
        )}
      </section>
    );
  }

  if (game.rollback.paused) {
    return (
      <section className="panel rollback-panel" aria-live="assertive">
        <span className="public-label">НОВА ГІЛКА АКТИВНА</span>
        <h2>Стан гри відновлено</h2>
        <p>
          Перевірте фазу, відкриті характеристики та ресурси. Після
          продовження таймер цієї фази почнеться заново.
        </p>
        {isHost ? (
          <button
            className="primary-action"
            disabled={busy}
            onClick={() => void onResume?.()}
            type="button"
          >
            Стан правильний — продовжити
          </button>
        ) : (
          <p className="rollback-wait">
            Ведучий перевіряє відновлений стан. Якщо ведучий довго не
            відповідає — зверніться до нього напряму (голосом чи в чаті);
            автоматичної передачі ролі ведучого зараз немає.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="panel rollback-panel">
      <span className="public-label">КОНТРОЛЬНІ ТОЧКИ РАУНДУ</span>
      <h2>Безпечне відновлення</h2>
      <p>
        Оберіть один із трьох останніх станів. Поточна історія не буде
        стерта — система створить нову гілку після голосування.
      </p>
      <div className="checkpoint-list">
        {game.rollback.checkpoints.map((checkpoint) => (
          <button
            aria-pressed={checkpoint.id === checkpointId}
            className="checkpoint-button"
            key={checkpoint.id}
            onClick={() => setCheckpointId(checkpoint.id)}
            type="button"
          >
            <span>{checkpoint.label}</span>
            <small>
              Раунд {checkpoint.round} · {checkpoint.eventsAfter} подій після
              точки
            </small>
          </button>
        ))}
      </div>
      <label className="rollback-reason">
        <span>Причина відновлення</span>
        <textarea
          maxLength={240}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Наприклад: помилково відкрили не ту характеристику"
          rows={3}
          value={reason}
        />
      </label>
      <button
        className="secondary-action danger-action"
        disabled={
          busy || checkpointId === null || reason.trim().length < 3
        }
        onClick={() =>
          void onPropose?.(checkpointId ?? "", reason.trim())
        }
        type="button"
      >
        Запросити голосування
      </button>
    </section>
  );
}

function DemographyCheck({
  assessment
}: {
  readonly assessment: NonNullable<MockGameView["demography"]>;
}) {
  const rows = [
    {
      count: assessment.eligibleWomen,
      label: `Жінки ${assessment.femaleAgeRange.min}–${assessment.femaleAgeRange.max} років`,
      required: assessment.requiredWomen
    },
    {
      count: assessment.eligibleMen,
      label: `Чоловіки ${assessment.maleAgeRange.min}–${assessment.maleAgeRange.max} років`,
      required: assessment.requiredMen
    }
  ] as const;

  return (
    <div className="demography-check" aria-label="Демографічна перевірка">
      <div className="demography-heading">
        <div>
          <span className="public-label">БАЗОВА УМОВА ВИЖИВАННЯ</span>
          <h3>Демографія</h3>
        </div>
        <strong
          className={
            assessment.preserved
              ? "demography-result success"
              : "demography-result failure"
          }
        >
          {assessment.preserved ? "УМОВУ ВИКОНАНО" : "УМОВУ НЕ ВИКОНАНО"}
        </strong>
      </div>
      <div className="demography-rows">
        {rows.map((row) => (
          <div className="demography-row" key={row.label}>
            <span>{row.label}</span>
            <strong>
              {row.count} / {row.required}
            </strong>
          </div>
        ))}
      </div>
      <p>
        Показано лише підсумкові кількості. Закриті характеристики
        персонажів не розкриваються.
      </p>
    </div>
  );
}

interface AppProps {
  readonly connected?: boolean;
  readonly currentUser?: TelegramUser;
  readonly game?: MockGameView;
  readonly initialView?: View;
  readonly onBegin?: () => Promise<void>;
  readonly onCardReact?: (
    selection: PlaytestCardSelection
  ) => Promise<void>;
  readonly onCardUse?: (
    selection: PlaytestCardSelection
  ) => Promise<void>;
  readonly onFinishDiscussion?: () => Promise<void>;
  readonly onFinish?: () => Promise<void>;
  readonly onFinishTurn?: () => Promise<void>;
  readonly onFinishVoting?: () => Promise<void>;
  readonly onFinalize?: (
    outcome: "all_survive" | "team_loss"
  ) => Promise<void>;
  readonly onReveal?: (
    characteristicId: CharacteristicId
  ) => Promise<void>;
  readonly onRollbackCancel?: () => Promise<void>;
  readonly onRollbackPropose?: (
    checkpointId: string,
    reason: string
  ) => Promise<void>;
  readonly onRollbackResume?: () => Promise<void>;
  readonly onRollbackVote?: (approve: boolean) => Promise<void>;
  readonly onVote?: (targetPlayerId: string) => Promise<void>;
}

const demoUser: TelegramUser = {
  firstName: "Олена",
  id: "demo"
};

export function App({
  connected = true,
  currentUser = demoUser,
  game,
  initialView = "character",
  onBegin,
  onCardReact,
  onCardUse,
  onFinishDiscussion,
  onFinish,
  onFinishTurn,
  onFinishVoting,
  onFinalize,
  onReveal,
  onRollbackCancel,
  onRollbackPropose,
  onRollbackResume,
  onRollbackVote,
  onVote
}: AppProps = {}) {
  const currentPlayerName =
    `${currentUser.firstName} ${currentUser.lastName ?? ""}`.trim();
  const [view, setView] = useState<View>(initialView);
  const [demoCharacteristics, setDemoCharacteristics] = useState(
    initialCharacteristics
  );
  const [demoPublicPlayers, setDemoPublicPlayers] = useState(() =>
    initialPlayers.map((player) =>
      player.id === demoCurrentTurnPlayerId
        ? { ...player, name: currentPlayerName }
        : player
    )
  );
  const characteristics =
    game?.characteristics.map((characteristic) => ({
      category: characteristic.label,
      id: characteristic.id,
      open: characteristic.revealed,
      value: characteristic.value
    })) ?? demoCharacteristics;
  const publicPlayers =
    game?.players.map((player) => ({
      characteristics: player.characteristics,
      id: player.id,
      name: `${player.firstName} ${player.lastName ?? ""}`.trim(),
      status:
        player.status === "eliminated"
          ? ("eliminated" as const)
          : ("playing" as const)
    })) ?? demoPublicPlayers;
  const currentTurnPlayerId =
    game?.currentTurnPlayerId ?? demoCurrentTurnPlayerId;
  const currentTurnPlayerName =
    publicPlayers.find((player) => player.id === currentTurnPlayerId)?.name ??
    currentPlayerName;
  const currentGamePlayer = game?.players.find(
    (player) => player.id === currentUser.id
  );
  const isOwnTurn =
    game?.phase === "revealing" &&
    game.currentTurnPlayerId === currentUser.id &&
    currentGamePlayer?.status === "active";
  const canReveal =
    game === undefined ||
    (isOwnTurn && game.turnStage === "choosing" && !game.rollback.paused);
  const showOwnTurn = game === undefined || isOwnTurn;
  const canFinishTurn =
    isOwnTurn && game?.turnStage === "speaking" && !game.rollback.paused;
  const canUseCard =
    game?.phase === "revealing" &&
    isOwnTurn &&
    game.card.kind === "action" &&
    !game.card.used &&
    !game.rollback.paused;
  const canReactWithCard =
    game?.phase === "reaction" &&
    game.card.kind === "reaction" &&
    !game.card.used &&
    currentGamePlayer?.status === "active" &&
    game.cardChain?.actorPlayerId !== currentUser.id &&
    (game.cardChain?.reactions.length ?? 2) < 2 &&
    isReactionCompatible(game, currentUser.id) &&
    !game.rollback.paused;
  const [dossierHidden, setDossierHidden] = useState(false);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const actionInFlightRef = useRef(false);
  const [cardSelection, setCardSelection] =
    useState<PlaytestCardSelection>({});
  const [selectedId, setSelectedId] =
    useState<CharacteristicId | null>(null);
  const [pendingRevealId, setPendingRevealId] =
    useState<CharacteristicId | null>(null);
  const [pendingVoteTargetId, setPendingVoteTargetId] = useState<
    string | null
  >(null);
  const pendingVoteTarget = useMemo(
    () => game?.players.find((player) => player.id === pendingVoteTargetId),
    [game?.players, pendingVoteTargetId]
  );
  useEffect(() => {
    setPendingVoteTargetId(null);
  }, [game?.phase, game?.voting?.attempt, game?.voting?.hasVoted]);
  const tableMode = view === "table";
  const bunkerMode = view === "bunker";
  const selectedCharacteristic = useMemo(
    () =>
      characteristics.find(
        (characteristic) => characteristic.id === selectedId
      ),
    [characteristics, selectedId]
  );
  const pendingCharacteristic = useMemo(
    () =>
      characteristics.find(
        (characteristic) => characteristic.id === pendingRevealId
      ),
    [characteristics, pendingRevealId]
  );
  useEffect(() => {
    if (!canReveal || pendingCharacteristic?.open === true) {
      setPendingRevealId(null);
    }
  }, [canReveal, pendingCharacteristic?.open]);
  useEffect(() => {
    setCardSelection({});
  }, [game?.card.id]);
  const cardSelectionFields =
    game?.phase === "reaction" && game.cardChain?.reactions.length === 1
      ? []
      : (game?.card.selection ?? []);
  const cardTargetPlayers =
    game?.players.filter((player) => {
      if (player.id === currentUser.id) {
        return false;
      }
      if (game.card.target === "eliminated_player") {
        return player.status === "eliminated";
      }
      if (player.status !== "active") {
        return false;
      }
      return game.card.effectId !== "order.swap" ||
        currentGamePlayer === undefined
        ? true
        : player.position > currentGamePlayer.position;
    }) ?? [];
  const cardTarget = game?.players.find(
    (player) => player.id === cardSelection.targetPlayerId
  );
  const cardCharacteristics = characteristics.filter((characteristic) => {
    switch (game?.card.effectId) {
      case "characteristic.hide":
        return characteristic.open;
      case "characteristic.reveal_extra":
      case "characteristic.reroll_unrevealed":
        return !characteristic.open;
      case "characteristic.force_reveal":
      case "characteristic.inspect":
        return cardTarget?.characteristics[characteristic.id] === undefined;
      case "characteristic.force_reroll":
        return cardTarget?.characteristics[characteristic.id] !== undefined;
      default:
        return true;
    }
  });
  const cardSelectionComplete = cardSelectionFields.every((field) =>
    field === "target_player"
      ? cardSelection.targetPlayerId !== undefined
      : field === "characteristic"
        ? cardSelection.characteristicId !== undefined
        : cardSelection.resourceId !== undefined
  );
  const activeDeadline =
    game?.rollback.paused === true
      ? null
      : game?.phase === "reaction"
      ? game.cardChain?.deadline
      : game?.turnDeadline;
  const countdown = useDeadlineCountdown(activeDeadline);
  const phaseTimerTotalRef = useRef<{
    readonly deadline: string;
    readonly totalSeconds: number;
  } | null>(null);
  if (
    activeDeadline !== null &&
    activeDeadline !== undefined &&
    phaseTimerTotalRef.current?.deadline !== activeDeadline
  ) {
    const remainingSeconds = Math.round(
      (Date.parse(activeDeadline) - serverNow()) / 1_000
    );
    phaseTimerTotalRef.current = {
      deadline: activeDeadline,
      totalSeconds: Math.max(1, remainingSeconds)
    };
  }
  const phaseTitle =
    game?.phase === "reaction"
      ? "ВІКНО РЕАКЦІЇ"
      : game?.phase === "discussion"
        ? "ЗАГАЛЬНЕ ОБГОВОРЕННЯ"
        : game?.phase === "voting"
          ? "ГОЛОСУВАННЯ"
          : game?.phase === "final_check"
            ? "ФІНАЛЬНА ПЕРЕВІРКА"
            : game?.phase === "completed"
              ? "ПАРТІЮ ЗАВЕРШЕНО"
              : showOwnTurn
                ? game?.turnStage === "speaking"
                  ? "ВАШ ВИСТУП"
                  : "ВАШ ХІД"
                : game?.turnStage === "speaking"
                  ? "ВИСТУП ГРАВЦЯ"
                  : "ХІД ГРАВЦЯ";
  const phaseDescription =
    game?.phase === "reaction"
      ? `Розіграно «${game.cardChain?.action.title ?? "картку"}». Реакцій: ${game.cardChain?.reactions.length ?? 0} / 2.`
      : game?.phase === "discussion"
        ? "Порівняйте відкриті факти, перевірте аргументи та визначте, без кого бункер має більше шансів."
        : game?.phase === "voting"
          ? `Голосів отримано: ${game.voting?.submitted ?? 0} / ${game.voting?.expected ?? 0}.`
          : game?.phase === "final_check"
            ? "Місця заповнено. Система перевіряє демографію, а ведучий — сценарій і таємні цілі."
            : game?.phase === "completed"
              ? game.finalOutcome === "all_survive"
                ? "Фінальна група вижила."
                : "Фінальна група програла через умови сценарію або таємну ціль."
              : showOwnTurn
                ? game?.turnStage === "speaking"
                  ? null
                  : "Відкрийте характеристику під час виступу."
                : game?.turnStage === "speaking"
                  ? `${currentTurnPlayerName} виступає.`
                  : `${currentTurnPlayerName} готується до виступу.`;
  const firstReaction = game?.cardChain?.reactions[0];
  const reactionRuleText =
    game?.cardChain === null || game?.cardChain === undefined
      ? null
      : firstReaction === undefined
        ? canReactWithCard
          ? `Ваша реакція «${game.card.title}»: ${game.card.description}`
          : "Реакція може скасувати, скопіювати чи перенаправити дію — залежить від зіграної картки."
        : `Перша реакція — «${firstReaction.card.title}»: ` +
          `${firstReaction.card.description} Друга реакція скасує цю дію ` +
          `й поверне «${game.cardChain.action.title}».`;
  const displayedCountdown =
    game === undefined ? "01:42" : formatCountdown(countdown);
  const timerProgress =
    game === undefined
      ? 85
      : countdown === null
        ? 0
        : Math.max(
            0,
            Math.min(
              100,
              (countdown / (phaseTimerTotalRef.current?.totalSeconds ?? 90)) *
                100
            )
          );

  useEffect(() => {
    if (game?.rollback.paused === true) {
      setView("rollback");
    } else if (game?.phase === "discussion") {
      setView("table");
    }
  }, [game?.phase, game?.rollback.paused]);

  const toggleDossier = () => {
    setDossierHidden((hidden) => !hidden);
    setSelectedId(null);
    setPendingRevealId(null);
  };

  const confirmReveal = async () => {
    if (
      actionInFlightRef.current ||
      pendingRevealId === null ||
      pendingCharacteristic === undefined
    ) {
      return;
    }

    actionInFlightRef.current = true;
    setRevealBusy(true);
    setRevealError(null);
    try {
      if (onReveal === undefined) {
        setDemoCharacteristics((current) =>
          current.map((characteristic) =>
            characteristic.id === pendingRevealId
              ? { ...characteristic, open: true }
              : characteristic
          )
        );
        setDemoPublicPlayers((current) =>
          current.map((player) =>
            player.id === currentTurnPlayerId
              ? {
                  ...player,
                  characteristics: {
                    ...player.characteristics,
                    [pendingRevealId]: pendingCharacteristic.value
                  }
                }
              : player
          )
        );
      } else {
        await onReveal(pendingRevealId);
      }
      setPendingRevealId(null);
      setSelectedId(null);
    } catch (error) {
      setRevealError(
        describeActionError(
          error,
          "Не вдалося відкрити характеристику. Спробуйте ще раз."
        )
      );
    } finally {
      actionInFlightRef.current = false;
      setRevealBusy(false);
    }
  };
  const runGameAction = async (
    action: () => Promise<void>,
    fallbackError = "Не вдалося виконати дію. Спробуйте ще раз."
  ) => {
    if (actionInFlightRef.current) {
      return;
    }
    actionInFlightRef.current = true;
    setRevealBusy(true);
    setRevealError(null);
    try {
      await action();
    } catch (error) {
      setRevealError(describeActionError(error, fallbackError));
    } finally {
      actionInFlightRef.current = false;
      setRevealBusy(false);
    }
  };

  if (game?.rollback.paused === true) {
    return (
      <main className="app-shell rollback-shell">
        <header className="topbar">
          <div className="topbar-left">
            <span className="topbar-brand">Операція крейда</span>
            <h1>Відновлення гри</h1>
          </div>
          <span className="round-label">
            РАУНД {String(game.round).padStart(2, "0")}
          </span>
        </header>
        <RollbackPanel
          busy={revealBusy}
          game={game}
          isHost={game.hostPlayerId === currentUser.id}
          {...(onRollbackCancel === undefined
            ? {}
            : {
                onCancel: async () =>
                  runGameAction(
                    onRollbackCancel,
                    "Не вдалося виконати дію відновлення. Спробуйте ще раз."
                  )
              })}
          {...(onRollbackResume === undefined
            ? {}
            : {
                onResume: async () =>
                  runGameAction(
                    onRollbackResume,
                    "Не вдалося виконати дію відновлення. Спробуйте ще раз."
                  )
              })}
          {...(onRollbackVote === undefined
            ? {}
            : {
                onVote: async (approve: boolean) =>
                  runGameAction(
                    () => onRollbackVote(approve),
                    "Не вдалося виконати дію відновлення. Спробуйте ще раз."
                  )
              })}
        />
        {revealError !== null && (
          <p className="form-error" role="alert">
            {revealError}
          </p>
        )}
      </main>
    );
  }

  if (game?.phase === "scenario_intro") {
    return (
      <ScenarioIntro
        busy={revealBusy}
        error={revealError}
        isHost={game.hostPlayerId === currentUser.id}
        {...(onBegin === undefined
          ? {}
          : {
              onBegin: async () =>
                runGameAction(
                  onBegin,
                  "Не вдалося розпочати раунд. Спробуйте ще раз."
                )
            })}
        {...(onFinish === undefined
          ? {}
          : {
              onFinish: () =>
                void runGameAction(
                  onFinish,
                  "Не вдалося завершити партію. Спробуйте ще раз."
                )
            })}
        scenario={game.scenario}
      />
    );
  }

  return (
    <main className={`app-shell game-shell${tableMode ? " table-mode" : ""}`}>
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-brand">Операція крейда</span>
          <h1>Бункер</h1>
        </div>
        <div className="topbar-right">
          <span className="round-label">
            РАУНД {String(game?.round ?? 2).padStart(2, "0")}
          </span>
        </div>
      </header>

      <section
        aria-label="Поточний хід"
        aria-live={showOwnTurn ? "assertive" : "polite"}
        className={`turn-center${showOwnTurn ? " own-turn" : ""}${
          phaseDescription === null ? " compact" : ""
        }`}
      >
        <header className="turn-center-heading">
          <div>
            <span>ПОТОЧНИЙ ХІД</span>
            <strong>{phaseTitle}</strong>
          </div>
          <span
            aria-live="off"
            className={`timer${countdown !== null && countdown <= 10 ? " danger" : ""}`}
          >
            {displayedCountdown}
          </span>
        </header>
        <div
          aria-label={`Залишилось ${displayedCountdown}`}
          aria-live="off"
          className="turn-progress"
          role="progressbar"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(timerProgress)}
        >
          <span style={{ width: `${timerProgress}%` }} />
        </div>
        {phaseDescription !== null && (
          <p className="turn-description">{phaseDescription}</p>
        )}

        {game?.lastEvent !== null &&
          game?.lastEvent !== undefined &&
          !(
            game.phase === "revealing" &&
            game.turnStage === "speaking"
          ) && (
          <p className="turn-event" role="status">
            {game.lastEvent}
          </p>
          )}
      </section>

      {game?.phase === "reaction" && game.cardChain !== null && (
        <section className="panel reaction-panel">
          <span className="public-label">ЛАНЦЮЖОК КАРТОК</span>
          <h2>{game.cardChain.action.title}</h2>
          <p>{game.cardChain.action.description}</p>
          <ol>
            {game.cardChain.reactions.map((reaction, index) => {
              const player = game.players.find(
                (candidate) => candidate.id === reaction.playerId
              );
              return (
                <li key={`${reaction.playerId}:${reaction.card.id}`}>
                  <span>РЕАКЦІЯ {index + 1}</span>
                  <strong>{reaction.card.title}</strong>
                  <small>{player?.firstName ?? "Гравець"}</small>
                </li>
              );
            })}
          </ol>
          {reactionRuleText !== null && (
            <p className="reaction-rule">{reactionRuleText}</p>
          )}
        </section>
      )}

      <nav className="tabs" aria-label="Ігрові екрани">
        <button
          aria-pressed={view === "character"}
          onClick={() => setView("character")}
          type="button"
        >
          Досьє
        </button>
        <button
          aria-pressed={view === "table"}
          onClick={() => setView("table")}
          type="button"
        >
          Стіл
        </button>
        {game !== undefined && (
          <button
            aria-pressed={view === "bunker"}
            onClick={() => setView("bunker")}
            type="button"
          >
            Бункер
          </button>
        )}
        {game?.hostPlayerId === currentUser.id &&
          game.rollback.checkpoints.length > 0 && (
            <button
              aria-pressed={view === "rollback"}
              onClick={() => setView("rollback")}
              type="button"
            >
              Відновлення
            </button>
          )}
      </nav>

      {game?.phase === "discussion" && (
        <section className="panel dossier-panel discussion-panel">
          <span className="public-label">СПІЛЬНЕ РІШЕННЯ</span>
          <h2>Кого команда справді готова взяти?</h2>
          <p>
            Це час для суперечок, перевірки чужих історій і коротких
            запитань. Голосування почнеться після таймера або рішення
            ведучого.
          </p>
          {game.hostPlayerId === currentUser.id ? (
            <button
              className="primary-action"
              disabled={revealBusy}
              onClick={() =>
                void runGameAction(async () => {
                  await onFinishDiscussion?.();
                })
              }
              type="button"
            >
              Перейти до голосування
            </button>
          ) : (
            <p className="discussion-wait">
              Ведучий може завершити обговорення раніше.
            </p>
          )}
        </section>
      )}

      {game?.phase === "voting" && (
        <section className="panel dossier-panel vote-panel">
          <span className="public-label">
            {game.voting?.attempt === 1
              ? "ТАЄМНЕ ГОЛОСУВАННЯ"
              : game.voting?.attempt === 2
                ? "ПОВТОРНЕ ГОЛОСУВАННЯ"
                : "ВІДКРИТА НІЧИЯ"}
          </span>
          <h2>Хто не потрапить до бункера?</h2>
          {game.voting?.silenced === true &&
            currentGamePlayer?.status !== "eliminated" && (
              <p className="form-error" role="alert">
                Цього разу ваш голос не враховується в підрахунку.
              </p>
            )}
          {currentGamePlayer?.status === "eliminated" ? (
            <p>Ви спостерігаєте за голосуванням.</p>
          ) : game.voting?.hasVoted === true ? (
            <p>
              Голос прийнято. Очікуємо інших: {game.voting.submitted} /{" "}
              {game.voting.expected}.
            </p>
          ) : pendingVoteTarget !== undefined ? (
            <div className="vote-confirm">
              <p>
                Підтвердіть голос проти:{" "}
                <strong>{describeVoteCandidate(pendingVoteTarget)}</strong>
              </p>
              <div className="vote-grid">
                <button
                  className="primary-action"
                  disabled={revealBusy}
                  onClick={() =>
                    void runGameAction(async () => {
                      await onVote?.(pendingVoteTarget.id);
                      setPendingVoteTargetId(null);
                    })
                  }
                  type="button"
                >
                  Підтвердити голос
                </button>
                <button
                  className="secondary-action"
                  disabled={revealBusy}
                  onClick={() => setPendingVoteTargetId(null)}
                  type="button"
                >
                  Обрати іншого
                </button>
              </div>
            </div>
          ) : (
            <div className="vote-grid">
              {game.players
                .filter(
                  (player) =>
                    player.status === "active" &&
                    player.id !== currentUser.id &&
                    game.voting?.candidatePlayerIds.includes(player.id)
                )
                .map((player) => (
                  <button
                    className="secondary-action"
                    disabled={revealBusy}
                    key={player.id}
                    onClick={() => setPendingVoteTargetId(player.id)}
                    type="button"
                  >
                    Голосувати: {describeVoteCandidate(player)}
                  </button>
                ))}
            </div>
          )}
          {(game.voting?.openVotes.length ?? 0) > 0 && (
            <ul className="open-votes">
              {game.voting?.openVotes.map((vote) => {
                const voter = game.players.find(
                  (player) => player.id === vote.voterPlayerId
                );
                const target = game.players.find(
                  (player) => player.id === vote.targetPlayerId
                );
                return (
                  <li key={vote.voterPlayerId}>
                    {voter?.firstName ?? "Гравець"} →{" "}
                    {target?.firstName ?? "кандидат"}
                  </li>
                );
              })}
            </ul>
          )}
          {(game.voting?.totals.length ?? 0) > 0 && (
            <ul className="open-votes vote-totals">
              {game.voting?.totals.map((total) => {
                const target = game.players.find(
                  (player) => player.id === total.targetPlayerId
                );
                return (
                  <li key={total.targetPlayerId}>
                    {target?.firstName ?? "Кандидат"}: {total.votes}
                  </li>
                );
              })}
            </ul>
          )}
          {game.hostPlayerId === currentUser.id && (
            <button
              className="secondary-action danger-action"
              disabled={revealBusy}
              onClick={() =>
                void runGameAction(async () => {
                  await onFinishVoting?.();
                })
              }
              type="button"
            >
              Завершити голосування достроково
            </button>
          )}
        </section>
      )}

      {game !== undefined &&
        (game.phase === "final_check" || game.phase === "completed") && (
        <section className="panel dossier-panel final-panel">
          <span className="public-label">СКЛАД БУНКЕРА</span>
          <h2>
            {game.players
              .filter((player) => player.status === "active")
              .map((player) => player.firstName)
              .join(", ")}
          </h2>
          {game.phase === "final_check" && game.secretGoal !== null && (
            <p>
              Гравці по черзі оголошують таємні цілі. Після автоматичної
              перевірки ведучий визначає, чи не руйнує виконана ціль
              виживання всієї групи.
            </p>
          )}
          {game.demography === null ? (
            <p className="inline-error" role="alert">
              Демографічна перевірка тимчасово недоступна.
            </p>
          ) : (
            <DemographyCheck assessment={game.demography} />
          )}
          {game.phase === "final_check" &&
          game.hostPlayerId === currentUser.id ? (
            <div className="vote-grid">
              <button
                className="primary-action"
                disabled={
                  revealBusy || game.demography?.preserved !== true
                }
                onClick={() =>
                  void runGameAction(async () => {
                    await onFinalize?.("all_survive");
                  })
                }
                type="button"
              >
                Усі вижили
              </button>
              <button
                className="secondary-action danger-action"
                disabled={revealBusy}
                onClick={() =>
                  void runGameAction(async () => {
                    await onFinalize?.("team_loss");
                  })
                }
                type="button"
              >
                {game.demography?.preserved === true
                  ? game.secretGoal !== null
                    ? "Поразка через таємну ціль"
                    : "Поразка через сценарій"
                  : "Завершити: демографію не збережено"}
              </button>
            </div>
          ) : game.phase === "final_check" ? (
            <p>
              Очікуємо фінальне рішення ведучого. Якщо ведучий довго не
              відповідає — зверніться до нього напряму (голосом чи в чаті);
              автоматичної передачі ролі ведучого зараз немає.
            </p>
          ) : (
            <p>
              {game.finalOutcome === "all_survive"
                ? "Перемога: група зберегла шанс на життя й демографічне майбутнє."
                : game.demography?.preserved === true
                  ? game.secretGoal !== null
                    ? "Поразка: прихована умова зруйнувала план виживання."
                    : "Поразка: умови сценарію завадили групі вижити."
                  : "Поразка: фінальна група не пройшла демографічну перевірку."}
            </p>
          )}
        </section>
      )}

      <div
        className={`view-layout ${view}${
          canReactWithCard ? " reaction-pending" : ""
        }`}
      >
        <div className="view-primary">
          {view === "rollback" && game !== undefined ? (
            <RollbackPanel
              busy={revealBusy}
              game={game}
              isHost={game.hostPlayerId === currentUser.id}
              {...(onRollbackPropose === undefined
                ? {}
                : {
                    onPropose: async (checkpointId, reason) =>
                      runGameAction(() =>
                        onRollbackPropose(checkpointId, reason)
                      )
                  })}
            />
          ) : bunkerMode && game !== undefined ? (
        <BunkerView scenario={game.scenario} />
      ) : tableMode ? (
        <TableView
          bunkerCapacity={game?.bunkerCapacity ?? 4}
          currentTurnPlayerId={currentTurnPlayerId}
          mockMode={game !== undefined}
          players={publicPlayers}
          {...(game === undefined ? {} : { scenario: game.scenario })}
        />
      ) : (
        <CharacterView
          canReveal={canReveal}
          characteristics={characteristics}
          dossierHidden={dossierHidden}
          dossierNumber={game?.dossierNumber ?? 7}
          onSelect={setSelectedId}
          onToggleHidden={toggleDossier}
          requiredCharacteristicId={
            game?.round === 1 ? "profession" : null
          }
          secretGoal={game === undefined ? demoSecretGoal : game.secretGoal}
          selectedId={selectedId}
        />
      )}

        </div>

        {game !== undefined && (
          <aside className="view-secondary">
            <section className="panel card-panel" aria-labelledby="card-title">
              <div>
                <span className="private-badge">ВАША КАРТКА</span>
                <span className={`card-kind ${game.card.kind}`}>
                  {game.card.kind === "action" ? "ДІЯ" : "РЕАКЦІЯ"}
                </span>
              </div>
              <h2 id="card-title">{game.card.title}</h2>
              <p>{game.card.description}</p>
              {!game.card.used && cardSelectionFields.length > 0 && (
                <div className="card-fields">
                  {cardSelectionFields.includes("target_player") && (
                    <label>
                      <span>Ціль</span>
                      <select
                        onChange={(event) =>
                          setCardSelection((current) => {
                            if (event.target.value.length > 0) {
                              return {
                                ...withoutCardSelectionField(
                                  current,
                                  "characteristicId"
                                ),
                                targetPlayerId: event.target.value
                              };
                            }
                            return withoutCardSelectionField(
                              current,
                              "targetPlayerId"
                            );
                          })
                        }
                        value={cardSelection.targetPlayerId ?? ""}
                      >
                        <option value="">Оберіть гравця</option>
                        {cardTargetPlayers.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.firstName} {player.lastName ?? ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {cardSelectionFields.includes("characteristic") && (
                    <label>
                      <span>Характеристика</span>
                      <select
                        onChange={(event) =>
                          setCardSelection((current) => {
                            if (event.target.value.length > 0) {
                              return {
                                ...current,
                                characteristicId: event.target
                                  .value as CharacteristicId
                              };
                            }
                            return withoutCardSelectionField(
                              current,
                              "characteristicId"
                            );
                          })
                        }
                        value={cardSelection.characteristicId ?? ""}
                      >
                        <option value="">Оберіть характеристику</option>
                        {cardCharacteristics.map((characteristic) => (
                          <option
                            key={characteristic.id}
                            value={characteristic.id}
                          >
                            {characteristic.category}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {cardSelectionFields.includes("resource") && (
                    <label>
                      <span>Ресурс</span>
                      <select
                        onChange={(event) =>
                          setCardSelection((current) => {
                            if (event.target.value.length > 0) {
                              return {
                                ...current,
                                resourceId: event.target.value as NonNullable<
                                  PlaytestCardSelection["resourceId"]
                                >
                              };
                            }
                            return withoutCardSelectionField(
                              current,
                              "resourceId"
                            );
                          })
                        }
                        value={cardSelection.resourceId ?? ""}
                      >
                        <option value="">Оберіть ресурс</option>
                        {game.scenario.resources.map((resource) => (
                          <option key={resource.id} value={resource.id}>
                            {resource.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
              {game.cardResult !== null && (
                <p className="card-result">
                  <span>ПРИВАТНИЙ РЕЗУЛЬТАТ</span>
                  <strong>{game.cardResult}</strong>
                </p>
              )}
              <button
                className="secondary-action card-action"
                disabled={
                  revealBusy ||
                  !cardSelectionComplete ||
                  (game.card.kind === "action"
                    ? !canUseCard
                    : !canReactWithCard)
                }
                onClick={() =>
                  void runGameAction(async () => {
                    if (game.card.kind === "action") {
                      await onCardUse?.(cardSelection);
                    } else {
                      await onCardReact?.(cardSelection);
                    }
                  })
                }
                type="button"
              >
                {game.card.used
                  ? "Картку використано"
                  : game.card.kind === "action"
                    ? canUseCard
                      ? "Використати картку"
                      : "Доступна лише у ваш хід"
                    : canReactWithCard
                      ? "Зіграти реакцію"
                      : "Очікуйте вікна реакції"}
              </button>
            </section>
          </aside>
        )}
      </div>

      {view === "character" &&
        (game === undefined || game.phase === "revealing") && (
        <div className="action-area">
          <button
            className="primary-action"
            disabled={
              revealBusy ||
              (!canFinishTurn &&
                (selectedCharacteristic === undefined ||
                  dossierHidden ||
                  !canReveal))
            }
            onClick={() => {
              if (canFinishTurn) {
                void runGameAction(async () => {
                  await onFinishTurn?.();
                });
                return;
              }
              setPendingRevealId(selectedCharacteristic?.id ?? null);
            }}
            type="button"
          >
            {canFinishTurn
              ? "Завершити виступ"
              : !canReveal
              ? currentGamePlayer?.status === "eliminated"
                ? "Ви спостерігач"
                : game?.turnStage === "speaking"
                  ? `Триває виступ: ${currentTurnPlayerName}`
                  : "Очікуйте свого ходу"
              : selectedCharacteristic === undefined
                ? "Оберіть характеристику"
              : `Відкрити «${selectedCharacteristic.category}»`}
          </button>
        </div>
      )}

      {onFinish !== undefined && (
        <div className="game-finish-action">
          <button
            className="secondary-action danger-action"
            onClick={() =>
              void runGameAction(
                onFinish,
                "Не вдалося завершити партію. Спробуйте ще раз."
              )
            }
            type="button"
          >
            {game?.hostPlayerId === currentUser.id
              ? "Завершити гру"
              : "Вийти з партії"}
          </button>
        </div>
      )}

      <p className={`connection-status${connected ? "" : " delayed"}`}>
        <span className="conn-dot" aria-hidden="true" />
        {connected ? "З’єднання стабільне" : "Відновлюємо з’єднання"}
      </p>
      {revealError !== null && (
        <p className="form-error game-action-error" role="alert">
          {revealError}
        </p>
      )}

      {pendingCharacteristic !== undefined && (
        <RevealDialog
          busy={revealBusy}
          characteristic={pendingCharacteristic}
          onCancel={() => setPendingRevealId(null)}
          onConfirm={() => void confirmReveal()}
        />
      )}
    </main>
  );
}
