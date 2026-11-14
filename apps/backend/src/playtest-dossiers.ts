import { randomInt } from "node:crypto";

import type { CharacteristicId } from "@bunker/contracts";
import { resolveProfessionCatalog } from "@bunker/content";
import type { DemographicCharacter } from "@bunker/game-engine";
import { STANDARD_BETA_DEMOGRAPHY_RULE } from "@bunker/game-engine";

export interface PlaytestDossier {
  readonly characteristics: Readonly<
    Record<CharacteristicId, string>
  >;
  readonly secretGoal: string;
}

type RandomIndex = (length: number) => number;

export function parsePlaytestAgeGender(
  value: string
): DemographicCharacter {
  const match = /^(Жінка|Чоловік), (\d{1,3}) (?:рік|роки|років)$/u.exec(
    value
  );
  if (match === null) {
    throw new Error("Invalid playtest age and sex value");
  }
  const age = Number(match[2]);
  if (!Number.isInteger(age) || age < 0 || age > 130) {
    throw new Error("Invalid playtest age and sex value");
  }
  return {
    age,
    sex: match[1] === "Жінка" ? "female" : "male"
  };
}

export const FERTILITY_CAPABLE_SPECIAL_CONDITION =
  "Трансгендерна людина до медичного переходу";
export const INSEMINATION_KIT_BAGGAGE =
  "Набір для штучного запліднення";
export const CHILD_FREE_CHARACTER_TRAIT =
  "Свідомо чайлдфрі — дітей не хоче принципово";

export const PLAYTEST_CHARACTERISTIC_POOLS = {
  "age-gender": [
    "Жінка, 19 років",
    "Чоловік, 22 роки",
    "Жінка, 27 років",
    "Чоловік, 31 рік",
    "Жінка, 36 років",
    "Чоловік, 41 рік",
    "Жінка, 47 років",
    "Чоловік, 53 роки",
    "Жінка, 58 років",
    "Чоловік, 64 роки",
    "Жінка, 71 рік",
    "Чоловік, 76 років",
    "Жінка, 24 роки",
    "Чоловік, 29 років",
    "Жінка, 42 роки",
    "Чоловік, 57 років"
  ],
  baggage: [
    "49 банок квасолі без відкривачки",
    "Зарядка не до того телефона",
    "Ламінатор і 200 пакетів",
    "Коробка кабелів невідомого призначення",
    "Пів мішка гречки",
    "Професійний караоке-мікрофон",
    "Аптечка з інструкцією японською",
    "Шахи, але без одного коня",
    "Надувний фламінго",
    "Справжній набір слюсаря",
    "Ручна сонячна зарядка",
    "Три рулони армованого скотчу",
    "Вилка та мочалка",
    "Подушка",
    "Електрочайник і колекція фігурок Kinder Joy Funko One Piece",
    "Складана лопата та термос із холодною кавою",
    INSEMINATION_KIT_BAGGAGE,
    "Курячі яйця та кишеньковий інкубатор",
    "Прилад нічного бачення невідомого походження",
    "Компас і карта околиць бази",
    "Валіза фельдшера з простроченими ліками"
  ],
  character: [
    "Створює робочу групу з будь-якого питання",
    "Каже «я ж казав» уже після події",
    "Спокійна, доки ніхто не чіпає її горнятко",
    "Говорить упевнено навіть без жодних фактів",
    "Підозрює змову в кожній черзі",
    "Рятує всіх, але драматично",
    "Погоджується з останнім промовцем",
    "Завжди має план Б, загубив план А",
    "Непохитний оптиміст із поганою статистикою",
    "Мовчазна, але веде детальний протокол",
    "Добрий переговорник із жахливим почерком",
    "Панікує організовано й за чеклістом",
    "Ніколи не читає договір, але пам’ятає дрібний шрифт",
    "Вміє заспокоїти всіх, поки не вимкнуть Wi-Fi",
    "Спочатку жартує, потім знаходить рішення",
    "Рахує запаси точніше за калькулятор",
    CHILD_FREE_CHARACTER_TRAIT,
    "Вважає: вижити повинні найкорисніші, а не всі підряд",
    "У кризі потрібна тверда рука одного лідера"
  ],
  health: [
    "Цілком здоровий, але дуже переконливо кашляє",
    "Алергія на пил і слово «дедлайн»",
    "Скрипить коліно перед дощем і брехнею",
    "Контрольована астма",
    "Ідеальний зір, крім очевидних проблем",
    "Хронічне безсоння — нічні зміни не лякають",
    "Мігрень від флуоресцентних ламп",
    "Сезонна алергія на все зелене",
    "Стара травма плеча",
    "Легка короткозорість",
    "Залізне здоров’я зі слів самого персонажа",
    "Потребує щоденних ліків від гіпертонії",
    "Лишай",
    "Депресія",
    "Апоплексія",
    "Непереносимість лактози, але запасів молока немає",
    "Тремор рук, який видає нервозність",
    "Ходить уві сні — уже лякав сусідню кімнату",
    "Манія переслідування, часом небезпідставна",
    "Клептоманія під контролем, здебільшого"
  ],
  hobby: [
    "Рейтингування консервів",
    "Колекціонування інструкцій IKEA",
    "Аматорське радіо й чужі розмови",
    "Історична реконструкція черг за дефіцитом",
    "Вирощування базиліку з характером",
    "Настільні ігри про недовіру",
    "Ремонт техніки за відео з інтернету",
    "Спостереження за птахами й сусідами",
    "Ферментація всього, що не втекло",
    "Стрільба з лука",
    "Печерний туризм",
    "Фотографування порожніх парковок",
    "Нумізматика",
    "Колекціонування платівок",
    "Колеоптерологія",
    "Виготовлення свічок із підручних матеріалів",
    "Вивчення часових аномалій-теорій із форумів",
    "Стояння на цвяхах для внутрішньої рівноваги",
    "Домашнє пивоваріння з непередбачуваним результатом"
  ],
  profession: resolveProfessionCatalog("operation-chalk").map(
    (profession) => profession.label
  ),
  "special-condition": [
    "Знає пароль від Wi-Fi, якого не існує",
    "Уміє запустити генератор із третьої спроби",
    "Пам’ятає всі серії кулінарного шоу",
    "Єдина людина, яка читає інструкції",
    "Може розвести вогонь, якщо є запальничка",
    "Розрізняє їстівні гриби у 60% випадків",
    "Має офлайн-копію Вікіпедії без картинок",
    "Знає азбуку Морзе, але лише слово SOS",
    "Уміє шити й не хвалиться цим",
    "Переконливо імітує звук сирени",
    "Може полагодити радіо за наявності другого радіо",
    "Запам’ятовує обличчя, але не імена",
    "Уміє відрізнити їстівне від токсичного за запахом",
    "Пам’ятає схему вентиляції після одного погляду",
    "Має механічний годинник і ніколи не запізнюється",
    "Може полагодити замок канцелярською скріпкою",
    FERTILITY_CAPABLE_SPECIAL_CONDITION,
    "Панічно боїться динозаврів",
    "З дитинства знає сотні видів динозаврів",
    "Викрив незаконний експеримент цієї корпорації",
    "Перед катастрофою бачив схему схожого бункера",
    "Зламав внутрішню базу даних корпорації",
    "Лауреат премії з генної інженерії",
    "Особисто знав власника цієї бази",
    "Приховує, що може бути серійним вбивцею"
  ]
} as const satisfies Readonly<
  Record<CharacteristicId, readonly string[]>
>;

const secretGoals = [
  "Потрапте до бункера, підтримайте життєздатну демографію та збережіть хоча б один корисний технічний інструмент.",
  "Потрапте до бункера, підтримайте життєздатну демографію та переконайте групу взяти людину з медичними навичками.",
  "Потрапте до бункера, підтримайте життєздатну демографію та не залишайте фінальну групу без запасів їжі.",
  "Потрапте до бункера, підтримайте життєздатну демографію та збережіть у групі хоча б одного спокійного переговорника.",
  "Потрапте до бункера, підтримайте життєздатну демографію та добийтеся, щоб у фінальній групі були різні вікові групи.",
  "Потрапте до бункера, підтримайте життєздатну демографію та не допустіть монополії однієї професійної сфери.",
  "Потрапте до бункера, підтримайте життєздатну демографію та збережіть персонажа, здатного ремонтувати або будувати.",
  "Потрапте до бункера, підтримайте життєздатну демографію та переконайте групу не ігнорувати дивний, але потенційно корисний багаж."
] as const;

function pick<T>(pool: readonly T[], randomIndex: RandomIndex): T {
  const index = randomIndex(pool.length);
  const value = pool[index];
  if (!Number.isInteger(index) || value === undefined) {
    throw new Error("Random index is outside the pool");
  }
  return value;
}

function drawUnique<T>(
  pool: readonly T[],
  count: number,
  randomIndex: RandomIndex
): readonly T[] {
  let remaining = [...pool];
  return Array.from({ length: count }).reduce<readonly T[]>(
    (selected) => {
      const index = randomIndex(remaining.length);
      const value = remaining[index];
      if (!Number.isInteger(index) || value === undefined) {
        throw new Error("Random index is outside the pool");
      }
      remaining = remaining.filter(
        (_candidate, candidateIndex) => candidateIndex !== index
      );
      return [...selected, value];
    },
    []
  );
}

function valueAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error("Could not deal a unique playtest characteristic");
  }
  return value;
}

function isFertileAgeGender(value: string): boolean {
  const { age, sex } = parsePlaytestAgeGender(value);
  const range =
    sex === "female"
      ? STANDARD_BETA_DEMOGRAPHY_RULE.femaleAgeRange
      : STANDARD_BETA_DEMOGRAPHY_RULE.maleAgeRange;
  return age >= range.min && age <= range.max;
}

function fertileIndexesForSex(
  result: readonly string[],
  sex: "female" | "male"
): readonly number[] {
  return result
    .map((value, index) => ({ index, value }))
    .filter(
      ({ value }) =>
        parsePlaytestAgeGender(value).sex === sex && isFertileAgeGender(value)
    )
    .map(({ index }) => index);
}
function ensureFertileAgeGenderCoverage(
  dealt: readonly string[],
  pool: readonly string[],
  randomIndex: RandomIndex
): readonly string[] {
  if (dealt.length < 2) {
    return dealt;
  }

  const result = [...dealt];

  for (const sex of ["female", "male"] as const) {
    if (fertileIndexesForSex(result, sex).length > 0) {
      continue;
    }

    const otherSex = sex === "female" ? "male" : "female";
    const otherSexIndexes = fertileIndexesForSex(result, otherSex);
    const protectedIndex =
      otherSexIndexes.length === 1 ? otherSexIndexes[0] : null;

    const replacements = pool.filter(
      (value) =>
        !result.includes(value) &&
        parsePlaytestAgeGender(value).sex === sex &&
        isFertileAgeGender(value)
    );
    const swapCandidates = result
      .map((_value, index) => index)
      .filter((index) => index !== protectedIndex);
    if (replacements.length === 0 || swapCandidates.length === 0) {
      continue;
    }

    const swapIndex = valueAt(
      swapCandidates,
      randomIndex(swapCandidates.length)
    );
    result[swapIndex] = pick(replacements, randomIndex);
  }

  return result;
}

export function createPlaytestDossiers(
  count: number,
  randomIndex: RandomIndex = randomInt
): readonly PlaytestDossier[] {
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    Object.values(PLAYTEST_CHARACTERISTIC_POOLS).some(
      (pool) => pool.length < count
    )
  ) {
    throw new Error("Not enough unique playtest characteristics");
  }

  const dealt = {
    "age-gender": ensureFertileAgeGenderCoverage(
      drawUnique(
        PLAYTEST_CHARACTERISTIC_POOLS["age-gender"],
        count,
        randomIndex
      ),
      PLAYTEST_CHARACTERISTIC_POOLS["age-gender"],
      randomIndex
    ),
    baggage: drawUnique(
      PLAYTEST_CHARACTERISTIC_POOLS.baggage,
      count,
      randomIndex
    ),
    character: drawUnique(
      PLAYTEST_CHARACTERISTIC_POOLS.character,
      count,
      randomIndex
    ),
    health: drawUnique(
      PLAYTEST_CHARACTERISTIC_POOLS.health,
      count,
      randomIndex
    ),
    hobby: drawUnique(
      PLAYTEST_CHARACTERISTIC_POOLS.hobby,
      count,
      randomIndex
    ),
    profession: drawUnique(
      PLAYTEST_CHARACTERISTIC_POOLS.profession,
      count,
      randomIndex
    ),
    "special-condition": drawUnique(
      PLAYTEST_CHARACTERISTIC_POOLS["special-condition"],
      count,
      randomIndex
    )
  } as const;

  return Array.from({ length: count }, (_unused, index) => ({
    characteristics: {
      profession: valueAt(dealt.profession, index),
      "age-gender": valueAt(dealt["age-gender"], index),
      health: valueAt(dealt.health, index),
      hobby: valueAt(dealt.hobby, index),
      baggage: valueAt(dealt.baggage, index),
      character: valueAt(dealt.character, index),
      "special-condition": valueAt(dealt["special-condition"], index)
    },
    secretGoal: pick(secretGoals, randomIndex)
  }));
}

export function createPlaytestDossier(
  randomIndex: RandomIndex = randomInt
): PlaytestDossier {
  return {
    characteristics: {
      profession: pick(
        PLAYTEST_CHARACTERISTIC_POOLS.profession,
        randomIndex
      ),
      "age-gender": pick(
        PLAYTEST_CHARACTERISTIC_POOLS["age-gender"],
        randomIndex
      ),
      health: pick(PLAYTEST_CHARACTERISTIC_POOLS.health, randomIndex),
      hobby: pick(PLAYTEST_CHARACTERISTIC_POOLS.hobby, randomIndex),
      baggage: pick(PLAYTEST_CHARACTERISTIC_POOLS.baggage, randomIndex),
      character: pick(
        PLAYTEST_CHARACTERISTIC_POOLS.character,
        randomIndex
      ),
      "special-condition": pick(
        PLAYTEST_CHARACTERISTIC_POOLS["special-condition"],
        randomIndex
      )
    },
    secretGoal: pick(secretGoals, randomIndex)
  };
}
