import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { encode } from "@toon-format/toon";

import {
  parseScenarioContent,
  validateScenarioReferences
} from "../src/scenario.js";
import {
  resolveCardCatalog,
  resolveProfessionCatalog
} from "../src/catalog.js";

type Rarity = "common" | "uncommon" | "rare";

interface ValueOptions {
  readonly constraints?: {
    readonly incompatibleTags?: readonly string[];
    readonly maxAge?: number;
    readonly minAge?: number;
    readonly requiresAnyTags?: readonly string[];
  };
  readonly rarity?: Rarity;
  readonly tags?: readonly string[];
  readonly weight?: number;
}

type ValueSeed = readonly [id: string, label: string, options?: ValueOptions];

function values(seeds: readonly ValueSeed[]) {
  return seeds.map(([id, label, options]) => ({
    ...(options?.constraints === undefined
      ? {}
      : { constraints: options.constraints }),
    id,
    label,
    rarity: options?.rarity ?? "common",
    tags: options?.tags ?? [],
    weight: options?.weight ?? 1
  }));
}

const categories = [
  {
    id: "profession",
    label: "Професія",
    values: resolveProfessionCatalog("operation-chalk")
  },
  {
    id: "age-gender",
    label: "Вік і стать",
    values: values([
      ["woman-18", "Жінка, 18 років", { tags: ["age:young", "gender:woman"] }],
      ["man-21", "Чоловік, 21 рік", { tags: ["age:young", "gender:man"] }],
      ["nonbinary-24", "Небінарна людина, 24 роки", { rarity: "uncommon", tags: ["age:young", "gender:nonbinary"] }],
      ["woman-28", "Жінка, 28 років", { tags: ["age:adult", "gender:woman"] }],
      ["man-31", "Чоловік, 31 рік", { tags: ["age:adult", "gender:man"] }],
      ["woman-35", "Жінка, 35 років", { tags: ["age:adult", "gender:woman"] }],
      ["man-39", "Чоловік, 39 років", { tags: ["age:adult", "gender:man"] }],
      ["woman-43", "Жінка, 43 роки", { tags: ["age:adult", "gender:woman"] }],
      ["man-48", "Чоловік, 48 років", { tags: ["age:mature", "gender:man"] }],
      ["woman-53", "Жінка, 53 роки", { tags: ["age:mature", "gender:woman"] }],
      ["man-58", "Чоловік, 58 років", { tags: ["age:mature", "gender:man"] }],
      ["woman-64", "Жінка, 64 роки", { tags: ["age:senior", "gender:woman"] }],
      ["man-70", "Чоловік, 70 років", { tags: ["age:senior", "gender:man"] }],
      ["woman-76", "Жінка, 76 років", { rarity: "uncommon", tags: ["age:senior", "gender:woman"] }]
    ])
  },
  {
    id: "health",
    label: "Здоров’я",
    values: values([
      ["excellent-health", "Повністю здоровий організм", { rarity: "rare", tags: ["health:excellent"] }],
      ["myopia", "Короткозорість, є запасні окуляри", { tags: ["health:stable", "vision"] }],
      ["controlled-asthma", "Контрольована астма", { tags: ["health:chronic", "respiratory"] }],
      ["controlled-diabetes", "Діабет, запас інсуліну на шість місяців", { rarity: "uncommon", tags: ["health:chronic", "medicine-dependent"] }],
      ["partial-hearing-loss", "Часткова втрата слуху", { tags: ["health:stable", "hearing"] }],
      ["severe-allergy", "Сильна алергія на укуси комах", { tags: ["health:risk", "allergy"] }],
      ["healed-fracture", "Старий перелом ноги нагадує про себе", { tags: ["health:stable", "mobility-limited"] }],
      ["migraine", "Напади мігрені від яскравого світла", { tags: ["health:chronic", "light-sensitive"] }],
      ["hypertension", "Гіпертонія під медикаментозним контролем", { tags: ["health:chronic", "medicine-dependent"] }],
      ["epilepsy", "Епілепсія, стабільна ремісія", { rarity: "uncommon", tags: ["health:chronic", "medicine-dependent"] }],
      ["leg-prosthesis", "Протез гомілки, впевнено пересувається", { rarity: "uncommon", tags: ["health:stable", "prosthesis"] }],
      ["chronic-insomnia", "Хронічне безсоння", { tags: ["health:chronic", "sleep"] }],
      ["cancer-remission", "Онкологічне захворювання в ремісії", { rarity: "rare", tags: ["health:risk", "medicine-dependent"] }],
      ["blood-clotting-disorder", "Порушення згортання крові", { rarity: "rare", tags: ["health:risk", "bleeding"] }]
    ])
  },
  {
    id: "hobby",
    label: "Хобі",
    values: values([
      ["birdwatching", "Спостереження за птахами", { tags: ["animals", "observation"] }],
      ["rock-climbing", "Скелелазіння", { tags: ["mobility", "survival"] }],
      ["amateur-radio", "Аматорський радіозв’язок", { tags: ["communications", "technical"] }],
      ["fermentation", "Домашня ферментація продуктів", { tags: ["food", "chemistry"] }],
      ["board-games", "Складні настільні ігри", { tags: ["strategy", "social"] }],
      ["gardening", "Садівництво", { tags: ["agriculture", "food"] }],
      ["drone-building", "Збирання дронів", { tags: ["technical", "electronics"] }],
      ["archery", "Стрільба з лука", { tags: ["combat", "precision"] }],
      ["sewing", "Шиття й ремонт одягу", { tags: ["craft", "repair"] }],
      ["cave-exploration", "Дослідження печер", { rarity: "uncommon", tags: ["exploration", "survival"] }],
      ["chess", "Шахи", { tags: ["strategy", "focus"] }],
      ["fishing", "Риболовля", { tags: ["food", "survival"] }],
      ["documentary-photography", "Документальна фотографія", { tags: ["observation", "history"] }],
      ["historical-reenactment", "Історична реконструкція", { tags: ["craft", "combat"] }]
    ])
  },
  {
    id: "phobia",
    label: "Фобія",
    values: values([
      ["dinophobia", "Панічний страх динозаврів", { rarity: "rare", tags: ["fear:dinosaurs"] }],
      ["claustrophobia", "Клаустрофобія", { tags: ["fear:enclosed"] }],
      ["nyctophobia", "Страх темряви", { tags: ["fear:darkness"] }],
      ["hemophobia", "Страх крові", { tags: ["fear:blood"] }],
      ["acrophobia", "Страх висоти", { tags: ["fear:height"] }],
      ["germophobia", "Страх інфекцій і бруду", { tags: ["fear:contamination"] }],
      ["thalassophobia", "Страх глибокої води", { tags: ["fear:water"] }],
      ["entomophobia", "Страх комах", { tags: ["fear:insects"] }],
      ["pyrophobia", "Страх вогню", { tags: ["fear:fire"] }],
      ["monophobia", "Страх залишитися на самоті", { tags: ["fear:alone"] }],
      ["technophobia", "Недовіра до складної техніки", { tags: ["fear:technology"] }],
      ["no-known-phobia", "Виражених фобій немає", { rarity: "uncommon", tags: ["fear:none"] }],
      ["loud-noise-fear", "Страх різких гучних звуків", { tags: ["fear:noise"] }],
      ["underground-fear", "Страх підземних споруд", { tags: ["fear:underground"] }]
    ])
  },
  {
    id: "baggage",
    label: "Багаж",
    values: values([
      ["first-aid-kit", "Розширена аптечка", { tags: ["medicine", "supplies"] }],
      ["solar-battery", "Складана сонячна батарея", { rarity: "uncommon", tags: ["energy", "technical"] }],
      ["field-microscope", "Польовий мікроскоп", { tags: ["science", "laboratory"] }],
      ["precision-toolbox", "Набір точних інструментів", { tags: ["technical", "repair"] }],
      ["heritage-seeds", "Контейнер насіння культурних рослин", { rarity: "uncommon", tags: ["agriculture", "food"] }],
      ["radio-set", "Короткохвильова радіостанція", { tags: ["communications", "technical"] }],
      ["climbing-rope", "П’ятдесят метрів альпіністської мотузки", { tags: ["mobility", "survival"] }],
      ["water-filter", "Портативний фільтр для води", { tags: ["water", "survival"] }],
      ["antibiotics", "Курс антибіотиків широкого спектра", { rarity: "uncommon", tags: ["medicine", "supplies"] }],
      ["recon-drone", "Розвідувальний дрон із двома батареями", { rarity: "rare", tags: ["observation", "electronics"] }],
      ["offline-tablet", "Захищений планшет з офлайн-енциклопедією", { rarity: "uncommon", tags: ["knowledge", "electronics"] }],
      ["chef-knives", "Набір професійних кухонних ножів", { tags: ["food", "tools"] }],
      ["firestarter", "Вогниво й водостійкі розпалювачі", { tags: ["fire", "survival"] }],
      ["unknown-sample", "Герметичний контейнер із невідомим біоматеріалом", { rarity: "rare", tags: ["mystery", "laboratory"] }]
    ])
  },
  {
    id: "fact",
    label: "Додатковий факт",
    values: values([
      ["antarctic-station", "Провів рік на антарктичній станції", { rarity: "uncommon", tags: ["isolation", "survival"] }],
      ["corporate-whistleblower", "Викрив незаконний експеримент корпорації", { rarity: "rare", tags: ["company", "secrets"] }],
      ["perfect-memory", "Має майже фотографічну пам’ять", { rarity: "rare", tags: ["knowledge", "observation"] }],
      ["lies-under-pressure", "Починає брехати під сильним тиском", { tags: ["social:risk", "secrets"] }],
      ["former-volunteer", "Координував волонтерський штаб", { tags: ["leadership", "logistics"] }],
      ["lab-accident", "Пережив серйозну лабораторну аварію", { tags: ["laboratory", "trauma"] }],
      ["survival-show", "Переміг у телевізійному шоу про виживання", { tags: ["survival", "social"] }],
      ["dinosaur-expert-child", "З дитинства знає сотні видів динозаврів", { tags: ["dinosaurs", "knowledge"] }],
      ["security-clearance", "Колись мав високий рівень корпоративного допуску", { rarity: "uncommon", tags: ["company", "security"] }],
      ["secret-debt", "Приховує великий борг перед іншим учасником", { tags: ["social:risk", "secrets"] }],
      ["three-days-awake", "Не спав три доби перед аномалією", { tags: ["fatigue", "health:risk"] }],
      ["wild-animal-rescue", "Брав участь у порятунку великих хижаків", { tags: ["animals", "medicine"] }],
      ["bunker-blueprints", "Перед катастрофою бачив схему схожого бункера", { rarity: "rare", tags: ["bunker", "knowledge"] }],
      ["improvised-community", "Створив самоврядну спільноту після стихійного лиха", { rarity: "uncommon", tags: ["leadership", "social"] }]
    ])
  },
  {
    id: "skills",
    label: "Навички",
    values: values([
      ["advanced-first-aid", "Розширена домедична допомога", { tags: ["medicine"] }],
      ["mechanical-repair", "Ремонт механічних систем", { tags: ["technical", "repair"] }],
      ["genetic-analysis", "Генетичний аналіз", { rarity: "rare", tags: ["science", "genetics", "laboratory"] }],
      ["negotiation", "Переговори й деескалація", { tags: ["social", "leadership"] }],
      ["stealth-movement", "Безшумне пересування", { tags: ["survival", "stealth"] }],
      ["animal-behavior", "Розуміння поведінки тварин", { tags: ["animals", "dinosaurs"] }],
      ["cartography", "Картографія та орієнтування", { tags: ["exploration", "navigation"] }],
      ["crisis-leadership", "Керування командою в кризі", { rarity: "uncommon", tags: ["leadership"] }],
      ["ration-cooking", "Приготування їжі з обмежених запасів", { tags: ["food", "logistics"] }],
      ["hydroponics", "Гідропоніка", { tags: ["agriculture", "technical"] }],
      ["analytical-chemistry", "Аналітична хімія", { tags: ["science", "chemistry", "laboratory"] }],
      ["security-systems", "Обслуговування систем безпеки", { tags: ["security", "technical"] }],
      ["multilingual", "Вільно володіє п’ятьма мовами", { tags: ["communications", "social"] }],
      ["improvisation", "Швидке створення рішень із підручних речей", { tags: ["craft", "survival", "repair"] }]
    ])
  },
  {
    id: "character",
    label: "Характер",
    values: values([
      ["calm", "Спокійний навіть під тиском", { tags: ["character:calm"] }],
      ["authoritarian", "Авторитарний і впевнений у своїй правоті", { tags: ["character:dominant", "social:risk"] }],
      ["empathetic", "Емпатичний, добре відчуває інших", { tags: ["character:empathetic", "social"] }],
      ["suspicious", "Підозрілий до чужих мотивів", { tags: ["character:suspicious"] }],
      ["adventurous", "Шукає ризик і нові враження", { tags: ["character:risk"] }],
      ["disciplined", "Дисциплінований і послідовний", { tags: ["character:disciplined"] }],
      ["conflictual", "Конфліктний, не поступається в суперечках", { tags: ["character:conflict", "social:risk"] }],
      ["humorous", "Знімає напругу чорним гумором", { tags: ["character:humor", "social"] }],
      ["altruistic", "Ставить групу вище за себе", { tags: ["character:altruistic"] }],
      ["pragmatic", "Прагматичний і холодно рахує ризики", { tags: ["character:pragmatic", "strategy"] }],
      ["impulsive", "Імпульсивний у критичні моменти", { tags: ["character:impulsive", "social:risk"] }],
      ["secretive", "Мовчазний і приховує наміри", { tags: ["character:secretive", "secrets"] }],
      ["persuasive", "Переконливий оратор", { rarity: "uncommon", tags: ["character:persuasive", "social"] }],
      ["stubborn", "Надзвичайно впертий", { tags: ["character:stubborn"] }]
    ])
  },
  {
    id: "physical-form",
    label: "Фізична форма",
    values: values([
      ["competitive-athlete", "Рівень професійного спортсмена", { rarity: "rare", tags: ["fitness:excellent", "mobility"] }],
      ["well-trained", "Добра тренована форма", { tags: ["fitness:good", "mobility"] }],
      ["average-form", "Середня фізична форма", { tags: ["fitness:average"] }],
      ["sedentary", "Малорухливий спосіб життя", { tags: ["fitness:low"] }],
      ["exhausted", "Сильне фізичне виснаження", { tags: ["fitness:low", "fatigue"] }],
      ["sprinter", "Дуже швидкий на короткій дистанції", { tags: ["fitness:good", "speed"] }],
      ["endurance-runner", "Висока витривалість", { tags: ["fitness:good", "endurance"] }],
      ["flexible", "Виняткова гнучкість", { tags: ["fitness:good", "mobility"] }],
      ["upper-body-strength", "Сильний верхній плечовий пояс", { tags: ["fitness:good", "strength"] }],
      ["limping", "Пересувається з помітною кульгавістю", { tags: ["fitness:limited", "mobility-limited"] }],
      ["injury-recovery", "Відновлюється після спортивної травми", { tags: ["fitness:limited", "health:stable"] }],
      ["underweight", "Недостатня маса тіла", { tags: ["fitness:low", "nutrition:risk"] }],
      ["heavy-strong", "Велика вага, але значна фізична сила", { tags: ["fitness:average", "strength"] }],
      ["active-senior", "Вікова, але активна й витривала людина", { rarity: "uncommon", tags: ["fitness:good", "age:senior"] }]
    ])
  },
  {
    id: "addiction",
    label: "Залежність",
    values: values([
      ["none", "Виражених залежностей немає", { rarity: "uncommon", tags: ["addiction:none"] }],
      ["nicotine", "Нікотинова залежність", { tags: ["addiction:substance"] }],
      ["caffeine", "Не функціонує без великої дози кофеїну", { tags: ["addiction:substance"] }],
      ["alcohol-remission", "Алкогольна залежність у тривалій ремісії", { tags: ["addiction:remission"] }],
      ["gambling", "Азартні ігри", { tags: ["addiction:behavior", "social:risk"] }],
      ["social-media", "Нав’язлива потреба в соціальних мережах", { tags: ["addiction:behavior"] }],
      ["painkillers-risk", "Ризик залежності від знеболювальних", { tags: ["addiction:substance", "medicine-dependent"] }],
      ["adrenaline", "Потреба в небезпечних відчуттях", { tags: ["addiction:behavior", "character:risk"] }],
      ["workaholic", "Трудоголізм", { tags: ["addiction:behavior"] }],
      ["sweets", "Компульсивне споживання солодкого", { tags: ["addiction:food"] }],
      ["energy-drinks", "Енергетичні напої", { tags: ["addiction:substance", "health:risk"] }],
      ["sleeping-pills", "Залежність від снодійного", { tags: ["addiction:substance", "medicine-dependent"] }],
      ["hoarding", "Компульсивне накопичення речей", { tags: ["addiction:behavior", "logistics:risk"] }],
      ["control", "Психологічна потреба все контролювати", { tags: ["addiction:behavior", "character:dominant"] }]
    ])
  },
  {
    id: "moral-beliefs",
    label: "Моральні переконання",
    values: values([
      ["utilitarian", "Найбільша користь для найбільшої кількості", { tags: ["morality:utilitarian"] }],
      ["humanist", "Кожне людське життя має безумовну цінність", { tags: ["morality:humanist"] }],
      ["pacifist", "Насильство неприйнятне майже за будь-яких умов", { tags: ["morality:pacifist"] }],
      ["survivalist", "Виживання групи виправдовує жорсткі рішення", { tags: ["morality:survivalist"] }],
      ["religious-mercy", "Милосердя й прощення важливіші за помсту", { tags: ["morality:mercy", "religion"] }],
      ["scientific-progress", "Науковий прогрес вартий контрольованого ризику", { tags: ["morality:science", "science"] }],
      ["collective-democracy", "Усі важливі рішення має приймати група", { tags: ["morality:democracy", "social"] }],
      ["strict-hierarchy", "У кризі потрібна безумовна вертикаль влади", { tags: ["morality:hierarchy", "character:dominant"] }],
      ["eco-radical", "Природа важливіша за збереження людської цивілізації", { tags: ["morality:eco", "animals"] }],
      ["individualist", "Людина насамперед відповідає за себе", { tags: ["morality:individualist"] }],
      ["duty-first", "Обов’язок важливіший за особисті почуття", { tags: ["morality:duty", "character:disciplined"] }],
      ["absolute-nonviolence", "Не вб’є живу істоту навіть заради порятунку", { rarity: "uncommon", tags: ["morality:pacifist", "animals"] }],
      ["retributive-justice", "Зрада повинна каратися без винятків", { tags: ["morality:punishment", "social:risk"] }],
      ["situational", "Моральне правило залежить від обставин", { tags: ["morality:pragmatic", "strategy"] }]
    ])
  },
  {
    id: "relationships",
    label: "Стосунки",
    values: values([
      ["single", "Не має близьких стосунків", { tags: ["relationship:none"] }],
      ["partner-outside", "Партнер залишився по інший бік аномалії", { tags: ["relationship:partner", "motivation:return"] }],
      ["parent", "Має малу дитину в сучасному світі", { tags: ["relationship:child", "motivation:return"] }],
      ["newlywed", "Одружився за тиждень до катастрофи", { tags: ["relationship:partner", "motivation:return"] }],
      ["cares-for-parent", "Був єдиним опікуном літнього родича", { tags: ["relationship:family", "motivation:return"] }],
      ["divorced", "Переживає важке розлучення", { tags: ["relationship:former", "social:risk"] }],
      ["team-friend", "Один з учасників — давній близький друг", { tags: ["relationship:party", "social"] }],
      ["team-rival", "Один з учасників — професійний суперник", { tags: ["relationship:party", "social:risk"] }],
      ["owes-life", "Завдячує життям іншому учаснику", { rarity: "uncommon", tags: ["relationship:party", "debt"] }],
      ["secret-romance", "Приховує романтичні стосунки з учасником", { rarity: "uncommon", tags: ["relationship:party", "secrets"] }],
      ["bereaved", "Нещодавно втратив найближчу людину", { tags: ["relationship:loss", "trauma"] }],
      ["large-family", "Виріс у великій родині й уміє ділити ресурси", { tags: ["relationship:family", "logistics"] }],
      ["foster-parent", "Має досвід прийомного батьківства", { tags: ["relationship:child", "care"] }],
      ["community-leader", "Очолював тісну місцеву громаду", { tags: ["relationship:community", "leadership"] }]
    ])
  },
  {
    id: "special-condition",
    label: "Особлива умова",
    values: values([
      ["temporal-resonance", "Відчуває наближення часових аномалій", { rarity: "rare", tags: ["anomaly", "time"] }],
      ["company-keycard", "Має пошкоджену ключ-картку корпорації", { rarity: "uncommon", tags: ["company", "security"] }],
      ["partial-immunity", "Організм стійкий до місцевих токсинів", { rarity: "rare", tags: ["health:advantage", "biology"] }],
      ["lab-code-fragment", "Пам’ятає частину коду лабораторії", { rarity: "uncommon", tags: ["laboratory", "knowledge"] }],
      ["company-agent", "Таємно працював на компанію-власника бази", { rarity: "rare", tags: ["company", "secrets"] }],
      ["tracking-beacon", "У тілі є невідомий активний маячок", { rarity: "uncommon", tags: ["company", "danger"] }],
      ["noise-panic", "Під час тривалої сирени втрачає контроль", { tags: ["fear:noise", "health:risk"] }],
      ["night-vision", "Надзвичайно добре бачить у сутінках", { rarity: "uncommon", tags: ["vision", "stealth"] }],
      ["dinosaur-scent", "Одяг забруднений речовиною, яка приваблює хижаків", { rarity: "rare", tags: ["dinosaurs", "danger"] }],
      ["future-message", "Має запис повідомлення від власного майбутнього", { rarity: "rare", tags: ["anomaly", "secrets"] }],
      ["blood-compatible", "Універсальний донор крові", { rarity: "uncommon", tags: ["medicine", "health:advantage"] }],
      ["sterile-suit", "Захисний костюм витримає одну небезпечну експедицію", { rarity: "uncommon", tags: ["survival", "laboratory"] }],
      ["dino-embryo", "Несвідомо переносить заморожений ембріон динозавра", { rarity: "rare", tags: ["dinosaurs", "secrets", "danger"] }],
      ["no-special-condition", "Особливих умов немає", { tags: ["special:none"] }]
    ])
  }
] as const;

const registeredEffectIds = [
  "card.cancel",
  "card.copy",
  "card.draw",
  "card.recover",
  "characteristic.cure_infertility",
  "characteristic.force_reroll",
  "characteristic.force_reveal",
  "characteristic.hide",
  "characteristic.inspect",
  "characteristic.reveal_extra",
  "characteristic.reroll_unrevealed",
  "characteristic.swap",
  "game.pause_request",
  "order.swap",
  "player.protect",
  "player.revive",
  "player.swap_baggage",
  "player.swap_profession",
  "predator_attention.threshold_danger",
  "predator_attention.threshold_incursion",
  "time.extend",
  "time.reduce",
  "vote.add",
  "vote.block",
  "vote.double",
  "vote.redirect",
  "vote.remove",
  "vote.reveal_total",
  "vote.silence"
] as const;

const cards = resolveCardCatalog("operation-chalk").map(
  ({ effect: _effect, ...definition }) => definition
);

const scenario = validateScenarioReferences(
  parseScenarioContent({
    ageRating: "16+",
    bunker: {
      capacityRule: "ceil_half",
      description:
        "Покинута підземна база корпорації, що створювала динозаврів. Частина систем працює, лабораторія й зовнішні модулі пошкоджені."
    },
    cards,
    categories,
    contentWarnings: [
      "небезпека й загибель людей",
      "напади тварин",
      "медичні стани",
      "залежності",
      "чорний гумор"
    ],
    coreObjective: "enter_bunker_and_preserve_demography",
    demography: {
      rule: "standard"
    },
    durationMinutes: {
      max: 150,
      min: 60
    },
    finalPlans: [
      {
        id: "scientific",
        requiredTags: ["science", "genetics", "laboratory"],
        title: "Науковий"
      },
      {
        id: "technical",
        requiredTags: ["technical", "repair", "energy"],
        title: "Технічний"
      },
      {
        id: "force",
        requiredTags: ["combat", "survival", "leadership"],
        title: "Силовий"
      }
    ],
    id: "operation-chalk",
    locale: "uk-UA",
    meters: [
      {
        id: "predator-attention",
        initialValue: 1,
        max: 10,
        min: 0,
        thresholds: [
          {
            at: 6,
            effectId: "predator_attention.threshold_danger",
            label: "Хижаки біля периметра"
          },
          {
            at: 9,
            effectId: "predator_attention.threshold_incursion",
            label: "Спроба проникнення"
          }
        ],
        title: "Увага хижаків"
      }
    ],
    playerRange: {
      max: 16,
      min: 4
    },
    registeredEffectIds,
    resources: [
      {
        id: "energy",
        initialValue: 6,
        max: 10,
        min: 0,
        tags: ["technical", "energy"],
        title: "Енергія"
      },
      {
        id: "supplies",
        initialValue: 7,
        max: 10,
        min: 0,
        tags: ["food", "water", "logistics"],
        title: "Запаси"
      },
      {
        id: "integrity",
        initialValue: 8,
        max: 10,
        min: 0,
        tags: ["bunker", "repair"],
        title: "Цілісність бункера"
      },
      {
        id: "lab-data",
        initialValue: 1,
        max: 6,
        min: 0,
        tags: ["science", "laboratory", "genetics"],
        title: "Лабораторні дані"
      },
      {
        id: "materials",
        initialValue: 4,
        max: 8,
        min: 0,
        tags: ["technical", "craft", "repair"],
        title: "Матеріали"
      }
    ],
    reveals: [
      {
        id: "bunker-origin",
        order: 1,
        text: "База належала компанії, яка створила динозаврів. У її даних можуть бути відомості про слабкі місця тварин.",
        title: "Походження бункера"
      },
      {
        id: "they-feel-bunker",
        order: 2,
        text: "Генератор, майстерня, ліфт і радіопередавач створюють сигнали, що поступово привертають хижаків.",
        title: "Вони відчувають бункер"
      },
      {
        id: "natural-breeding",
        order: 3,
        text: "Частина динозаврів здатна природно розмножуватися. Нове покоління не матиме закладеного обмеження строку життя.",
        title: "Проблема не зникне сама"
      },
      {
        id: "technical-tunnel",
        order: 4,
        text: "Технічний тунель веде до інкубатора нового покоління й одночасно містить частину вентиляції бункера.",
        title: "Технічний тунель"
      },
      {
        id: "last-opportunity",
        order: 5,
        text: "Лабораторія може створити генетичний пригнічувач. Альтернативи — знищити інкубатор або заблокувати тунель.",
        title: "Остання можливість"
      }
    ],
    schemaVersion: 1,
    secretGoals: [
      {
        description: "Завершіть гру з щонайменше чотирма одиницями лабораторних даних.",
        id: "preserve-scientific-archive",
        resolution: "engine",
        title: "Науковий архів"
      },
      {
        description: "Не дозвольте шкалі уваги хижаків досягти дев’яти.",
        id: "keep-silence",
        resolution: "engine",
        title: "Тиша понад усе"
      },
      {
        description: "Доможіться знищення інкубатора незалежно від основного плану.",
        id: "destroy-incubator",
        resolution: "engine",
        title: "Жодного нового покоління"
      },
      {
        description: "Збережіть яйце динозавра до фіналу й не розкривайте мотив.",
        id: "save-egg",
        resolution: "host",
        title: "Останній зразок"
      },
      {
        description: "Зробіть так, щоб корпоративні дані пережили фінал.",
        id: "company-archive",
        resolution: "engine",
        title: "Наказ компанії"
      },
      {
        description: "Особисто потрапте до бункера й підтримайте план повернення додому.",
        id: "return-home",
        resolution: "host",
        title: "Повернутися за будь-яку ціну"
      },
      {
        description: "Переконайте групу принаймні двічі підтримати запропоноване вами рішення.",
        id: "prove-leadership",
        resolution: "host",
        title: "Лідер кризи"
      },
      {
        description: "Завершіть гру із запасом енергії не менше п’яти.",
        id: "preserve-energy",
        resolution: "engine",
        title: "Резерв живлення"
      },
      {
        description: "У фінальній команді має бути персонаж із тегом medicine.",
        id: "keep-medic",
        resolution: "engine",
        title: "Медична гарантія"
      },
      {
        description: "У фінальній команді має бути персонаж із тегом technical.",
        id: "keep-engineer",
        resolution: "engine",
        title: "Системи мають працювати"
      },
      {
        description: "Не використовуйте картки, які прямо додають голос іншому гравцеві.",
        id: "clean-hands",
        resolution: "engine",
        title: "Чисті руки"
      },
      {
        description: "Особисто потрапте до бункера й доможіться максимальної уваги хижаків до фіналу.",
        id: "predator-cult",
        resolution: "host",
        title: "Поклик хижаків"
      }
    ].map((goal) => ({
      ...goal,
      ...(goal.id === "predator-cult"
        ? {
            fulfilledOutcome: "team_loss" as const,
            impact: "team_outcome" as const,
            unfulfilledOutcome: "keep_base_result" as const
          }
        : {
            impact: "personal" as const
          }),
      requiresBunker: true as const
    })),
    status: "draft",
    summary:
      "Сучасні люди через часову аномалію опинилися в епосі динозаврів і знайшли корпоративний підземний комплекс.",
    title: "Операція крейда",
    tone: ["пригодницький трилер", "напруга", "загадка", "чорний гумор"],
    version: "0.1.0"
  })
);

const outputPath = resolve(
  import.meta.dirname,
  "../../../content/scenarios/operation-chalk.toon"
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${encode(scenario)}\n`, "utf8");

process.stdout.write(
  `Generated ${outputPath}: ${scenario.categories.length} categories, ${scenario.categories.reduce((total, category) => total + category.values.length, 0)} values, ${scenario.cards.length} cards\n`
);
