"""Собрать справочник правил D&D 5e (2014) для листа персонажа: web/data/srd2014.json.

Источник — открытые данные SRD 5.1 из проекта 5e-bits/5e-database (лицензия OGL 1.0a / CC-BY-4.0,
см. web/data/LICENSE-SRD.txt). Русские названия классов, рас, навыков, оружия, доспехов и
состояний добавляются здесь. Перевод заклинаний (названия, описания, компоненты) лежит
в tools/srd_ru/spells_*.json и подмешивается при сборке. Описания умений — пока на английском.

Запуск:  python tools/build_srd.py [папка_с_json]
  без аргумента — скачает свежие файлы с GitHub.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "srd2014.json"
BASE = "https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2014/en/"
FILES = ["Spells", "Classes", "Races", "Subraces", "Equipment", "Backgrounds", "Levels", "Features",
         "Traits", "Subclasses", "Conditions"]

ABIL = {"str": ("Сила", "СИЛ", "Strength", "STR"), "dex": ("Ловкость", "ЛОВ", "Dexterity", "DEX"),
        "con": ("Телосложение", "ТЕЛ", "Constitution", "CON"), "int": ("Интеллект", "ИНТ", "Intelligence", "INT"),
        "wis": ("Мудрость", "МДР", "Wisdom", "WIS"), "cha": ("Харизма", "ХАР", "Charisma", "CHA")}

SKILLS = [  # id, характеристика, ru, en
    ("acrobatics", "dex", "Акробатика", "Acrobatics"), ("animal-handling", "wis", "Уход за животными", "Animal Handling"),
    ("arcana", "int", "Магия", "Arcana"), ("athletics", "str", "Атлетика", "Athletics"),
    ("deception", "cha", "Обман", "Deception"), ("history", "int", "История", "History"),
    ("insight", "wis", "Проницательность", "Insight"), ("intimidation", "cha", "Запугивание", "Intimidation"),
    ("investigation", "int", "Анализ", "Investigation"), ("medicine", "wis", "Медицина", "Medicine"),
    ("nature", "int", "Природа", "Nature"), ("perception", "wis", "Восприятие", "Perception"),
    ("performance", "cha", "Выступление", "Performance"), ("persuasion", "cha", "Убеждение", "Persuasion"),
    ("religion", "int", "Религия", "Religion"), ("sleight-of-hand", "dex", "Ловкость рук", "Sleight of Hand"),
    ("stealth", "dex", "Скрытность", "Stealth"), ("survival", "wis", "Выживание", "Survival"),
]

CLASS_RU = {"barbarian": "Варвар", "bard": "Бард", "cleric": "Жрец", "druid": "Друид", "fighter": "Воин",
            "monk": "Монах", "paladin": "Паладин", "ranger": "Следопыт", "rogue": "Плут", "sorcerer": "Чародей",
            "warlock": "Колдун", "wizard": "Волшебник"}
CASTER = {"bard": "full", "cleric": "full", "druid": "full", "sorcerer": "full", "wizard": "full",
          "paladin": "half", "ranger": "half", "warlock": "pact"}
SUBCLASS_RU = {"berserker": "Путь берсерка", "lore": "Коллегия знаний", "life": "Домен жизни", "land": "Круг земли",
               "champion": "Чемпион", "open-hand": "Путь открытой ладони", "devotion": "Клятва преданности",
               "hunter": "Охотник", "thief": "Вор", "draconic": "Наследие драконьей крови", "fiend": "Исчадие",
               "evocation": "Школа воплощения"}
RACE_RU = {"dwarf": "Дварф", "elf": "Эльф", "halfling": "Полурослик", "human": "Человек",
           "dragonborn": "Драконорождённый", "gnome": "Гном", "half-elf": "Полуэльф", "half-orc": "Полуорк",
           "tiefling": "Тифлинг"}
SUBRACE_RU = {"hill-dwarf": "Холмовой дварф", "high-elf": "Высший эльф", "lightfoot-halfling": "Легконогий полурослик",
              "rock-gnome": "Скальный гном"}
SCHOOL_RU = {"abjuration": "Ограждение", "conjuration": "Вызов", "divination": "Прорицание",
             "enchantment": "Очарование", "evocation": "Воплощение", "illusion": "Иллюзия",
             "necromancy": "Некромантия", "transmutation": "Преобразование"}
DAMAGE_RU = {"acid": "кислота", "bludgeoning": "дробящий", "cold": "холод", "fire": "огонь", "force": "силовое поле",
             "lightning": "электричество", "necrotic": "некротическая энергия", "piercing": "колющий", "poison": "яд",
             "psychic": "психическая энергия", "radiant": "излучение", "slashing": "рубящий", "thunder": "звук"}
PROP_RU = {"ammunition": "боеприпасы", "finesse": "фехтовальное", "heavy": "тяжёлое", "light": "лёгкое",
           "loading": "перезарядка", "monk": "монашеское", "reach": "досягаемость", "special": "особое",
           "thrown": "метательное", "two-handed": "двуручное", "versatile": "универсальное"}
WEAPON_RU = {"club": "Дубинка", "dagger": "Кинжал", "greatclub": "Палица", "handaxe": "Ручной топор",
             "javelin": "Метательное копьё", "light-hammer": "Лёгкий молот", "mace": "Булава",
             "quarterstaff": "Боевой посох", "sickle": "Серп", "spear": "Копьё", "crossbow-light": "Лёгкий арбалет",
             "dart": "Дротик", "shortbow": "Короткий лук", "sling": "Праща", "battleaxe": "Боевой топор",
             "flail": "Цеп", "glaive": "Глефа", "greataxe": "Секира", "greatsword": "Двуручный меч",
             "halberd": "Алебарда", "lance": "Длинное копьё", "longsword": "Длинный меч", "maul": "Молот",
             "morningstar": "Моргенштерн", "pike": "Пика", "rapier": "Рапира", "scimitar": "Скимитар",
             "shortsword": "Короткий меч", "trident": "Трезубец", "war-pick": "Боевая кирка",
             "warhammer": "Боевой молот", "whip": "Кнут", "blowgun": "Духовая трубка",
             "crossbow-hand": "Ручной арбалет", "crossbow-heavy": "Тяжёлый арбалет", "longbow": "Длинный лук",
             "net": "Сеть"}
ARMOR_RU = {"padded-armor": "Стёганый доспех", "leather-armor": "Кожаный доспех",
            "studded-leather-armor": "Проклёпанный кожаный доспех", "hide-armor": "Шкурный доспех",
            "chain-shirt": "Кольчужная рубаха", "scale-mail": "Чешуйчатый доспех", "breastplate": "Кираса",
            "half-plate-armor": "Полулаты", "ring-mail": "Кольчатый доспех", "chain-mail": "Кольчуга",
            "splint-armor": "Наборный доспех", "plate-armor": "Латы", "shield": "Щит"}
GEAR_RU = {
    "Abacus": "Счёты", "Acid (vial)": "Кислота (флакон)", "Alchemist's fire (flask)": "Алхимический огонь (фляга)",
    "Alms box": "Ящик для подаяний", "Arrow": "Стрела", "Block of incense": "Брусок благовоний",
    "Blowgun needle": "Игла для духовой трубки", "Censer": "Кадило", "Crossbow bolt": "Арбалетный болт",
    "Sling bullet": "Снаряд для пращи", "Amulet": "Амулет", "Antitoxin (vial)": "Противоядие (флакон)",
    "Crystal": "Кристалл", "Orb": "Сфера", "Rod": "Жезл", "Staff": "Посох", "Wand": "Волшебная палочка",
    "Backpack": "Рюкзак", "Ball bearings (bag of 1,000)": "Металлические шарики (мешочек, 1000 шт.)",
    "Barrel": "Бочка", "Basket": "Корзина", "Bedroll": "Спальник", "Bell": "Колокольчик", "Blanket": "Одеяло",
    "Block and tackle": "Блок и лебёдка", "Book": "Книга", "Bottle, glass": "Бутылка, стеклянная", "Bucket": "Ведро",
    "Caltrops": "Калтропы", "Candle": "Свеча", "Case, crossbow bolt": "Футляр для болтов",
    "Case, map or scroll": "Футляр для карт и свитков", "Chain (10 feet)": "Цепь (10 фт.)", "Chalk (1 piece)": "Мел (1 кусок)",
    "Chest": "Сундук", "Clothes, common": "Одежда, обычная", "Clothes, costume": "Одежда, костюм",
    "Clothes, fine": "Одежда, отличная", "Clothes, traveler's": "Одежда, дорожная", "Component pouch": "Мешочек с компонентами",
    "Crowbar": "Ломик", "Sprig of mistletoe": "Веточка омелы", "Totem": "Тотем", "Wooden staff": "Деревянный посох",
    "Yew wand": "Тисовая палочка", "Emblem": "Эмблема", "Fishing tackle": "Рыболовные снасти",
    "Flask or tankard": "Фляга или кружка", "Grappling hook": "Абордажный крюк", "Hammer": "Молоток",
    "Hammer, sledge": "Кувалда", "Holy water (flask)": "Святая вода (фляга)", "Hourglass": "Песочные часы",
    "Hunting trap": "Охотничий капкан", "Ink (1 ounce bottle)": "Чернила (бутылочка 1 унция)", "Ink pen": "Перо для письма",
    "Jug or pitcher": "Кувшин", "Climber's Kit": "Набор альпиниста", "Disguise Kit": "Набор для грима",
    "Forgery Kit": "Набор для фальсификации", "Herbalism Kit": "Набор травника", "Healer's Kit": "Комплект целителя",
    "Mess Kit": "Столовый набор", "Poisoner's Kit": "Набор отравителя", "Ladder (10-foot)": "Лестница (10 фт.)",
    "Lamp": "Лампа", "Lantern, bullseye": "Фонарь направленный", "Lantern, hooded": "Фонарь с заслонкой",
    "Little bag of sand": "Мешочек с песком", "Lock": "Замок", "Magnifying glass": "Увеличительное стекло",
    "Manacles": "Кандалы", "Mirror, steel": "Зеркало, стальное", "Oil (flask)": "Масло (фляга)",
    "Paper (one sheet)": "Бумага (лист)", "Parchment (one sheet)": "Пергамент (лист)", "Perfume (vial)": "Духи (флакон)",
    "Pick, miner's": "Кирка, шахтёрская", "Piton": "Шлямбур", "Poison, basic (vial)": "Яд, простой (флакон)",
    "Pole (10-foot)": "Шест (10 фт.)", "Pot, iron": "Котелок, железный", "Pouch": "Поясной кошель", "Quiver": "Колчан",
    "Ram, portable": "Таран, портативный", "Rations (1 day)": "Рационы (1 день)", "Reliquary": "Реликварий", "Robes": "Ряса",
    "Rope, hempen (50 feet)": "Верёвка пеньковая (50 фт.)", "Rope, silk (50 feet)": "Верёвка шёлковая (50 фт.)",
    "Sack": "Мешок", "Scale, merchant's": "Весы торговые", "Sealing wax": "Сургуч", "Shovel": "Лопата",
    "Signal whistle": "Сигнальный свисток", "Signet ring": "Кольцо-печатка", "Small knife": "Маленький нож", "Soap": "Мыло",
    "Spellbook": "Книга заклинаний", "Spike, iron": "Железный шип", "Spyglass": "Подзорная труба",
    "String (10 feet)": "Бечёвка (10 фт.)", "Tent, two-person": "Палатка двухместная", "Tinderbox": "Трутница",
    "Torch": "Факел", "Vestments": "Облачение", "Vial": "Флакон", "Waterskin": "Бурдюк", "Whetstone": "Точильный камень",
    "Burglar's Pack": "Набор взломщика", "Diplomat's Pack": "Набор дипломата", "Dungeoneer's Pack": "Набор исследователя подземелий",
    "Entertainer's Pack": "Набор артиста", "Explorer's Pack": "Набор путешественника", "Priest's Pack": "Набор священника",
    "Scholar's Pack": "Набор учёного", "Alchemist's Supplies": "Инструменты алхимика", "Brewer's Supplies": "Инструменты пивовара",
    "Calligrapher's Supplies": "Инструменты каллиграфа", "Carpenter's Tools": "Инструменты плотника",
    "Cartographer's Tools": "Инструменты картографа", "Cobbler's Tools": "Инструменты сапожника",
    "Cook's utensils": "Инструменты повара", "Glassblower's Tools": "Инструменты стеклодува",
    "Jeweler's Tools": "Инструменты ювелира", "Leatherworker's Tools": "Инструменты кожевника",
    "Mason's Tools": "Инструменты каменщика", "Painter's Supplies": "Инструменты художника",
    "Potter's Tools": "Инструменты гончара", "Smith's Tools": "Инструменты кузнеца", "Tinker's Tools": "Инструменты ремонтника",
    "Weaver's Tools": "Инструменты ткача", "Woodcarver's Tools": "Инструменты резчика по дереву", "Dice Set": "Набор костей",
    "Playing Card Set": "Набор игральных карт", "Bagpipes": "Волынка", "Drum": "Барабан", "Dulcimer": "Цимбалы",
    "Flute": "Флейта", "Lute": "Лютня", "Lyre": "Лира", "Horn": "Рожок", "Pan flute": "Свирель", "Shawm": "Шалмей",
    "Viol": "Виола", "Navigator's Tools": "Инструменты навигатора", "Thieves' Tools": "Воровские инструменты",
}
CONDITIONS = [  # id, ru, en, краткое описание (своими словами)
    ("blinded", "Ослеплён", "Blinded", "Не видит; проваливает проверки зрения. Его атаки — с помехой, атаки по нему — с преимуществом."),
    ("charmed", "Очарован", "Charmed", "Не может атаковать очарователя; тот получает преимущество на социальные проверки против него."),
    ("deafened", "Оглох", "Deafened", "Не слышит; проваливает проверки, связанные со слухом."),
    ("frightened", "Испуган", "Frightened", "Помеха на проверки и атаки, пока видит источник страха; не может добровольно приблизиться к нему."),
    ("grappled", "Схвачен", "Grappled", "Скорость 0. Заканчивается, если схвативший недееспособен или цель вытолкнули из досягаемости."),
    ("incapacitated", "Недееспособен", "Incapacitated", "Не может совершать действия и реакции."),
    ("invisible", "Невидим", "Invisible", "Его нельзя увидеть без магии. Его атаки — с преимуществом, атаки по нему — с помехой."),
    ("paralyzed", "Парализован", "Paralyzed", "Недееспособен, не двигается и не говорит. Проваливает спасброски СИЛ и ЛОВ; атаки по нему с преимуществом, удары вблизи — критические."),
    ("petrified", "Окаменел", "Petrified", "Превращён в камень: недееспособен, сопротивление всем видам урона, иммунитет к яду и болезням."),
    ("poisoned", "Отравлен", "Poisoned", "Помеха на броски атаки и проверки характеристик."),
    ("prone", "Сбит с ног", "Prone", "Ползает или тратит половину скорости, чтобы встать. Его атаки с помехой; атаки вблизи по нему с преимуществом, издалека — с помехой."),
    ("restrained", "Опутан", "Restrained", "Скорость 0. Его атаки и спасброски ЛОВ с помехой, атаки по нему с преимуществом."),
    ("stunned", "Ошеломлён", "Stunned", "Недееспособен, не двигается, говорит запинаясь. Проваливает спасброски СИЛ и ЛОВ, атаки по нему с преимуществом."),
    ("unconscious", "Без сознания", "Unconscious", "Недееспособен, роняет всё, падает ничком. Проваливает спасброски СИЛ и ЛОВ; атаки по нему с преимуществом, удары вблизи — критические."),
]
EXHAUSTION = ["Помеха на проверки характеристик", "Скорость уменьшена вдвое", "Помеха на атаки и спасброски",
              "Максимум хитов уменьшен вдвое", "Скорость 0", "Смерть"]
# Предыстории PHB 2014: только названия и владения навыками (игровая механика), без текстов.
BACKGROUNDS = [
    ("acolyte", "Прислужник", "Acolyte", ["insight", "religion"], True),
    ("charlatan", "Шарлатан", "Charlatan", ["deception", "sleight-of-hand"], False),
    ("criminal", "Преступник", "Criminal", ["deception", "stealth"], False),
    ("entertainer", "Артист", "Entertainer", ["acrobatics", "performance"], False),
    ("folk-hero", "Народный герой", "Folk Hero", ["animal-handling", "survival"], False),
    ("guild-artisan", "Гильдейский ремесленник", "Guild Artisan", ["insight", "persuasion"], False),
    ("hermit", "Отшельник", "Hermit", ["medicine", "religion"], False),
    ("noble", "Благородный", "Noble", ["history", "persuasion"], False),
    ("outlander", "Чужеземец", "Outlander", ["athletics", "survival"], False),
    ("sage", "Мудрец", "Sage", ["arcana", "history"], False),
    ("sailor", "Моряк", "Sailor", ["athletics", "perception"], False),
    ("soldier", "Солдат", "Soldier", ["athletics", "intimidation"], False),
    ("urchin", "Беспризорник", "Urchin", ["sleight-of-hand", "stealth"], False),
]
LANG_RU = {"Common": "Общий", "Dwarvish": "Дварфийский", "Elvish": "Эльфийский", "Giant": "Великаний",
           "Gnomish": "Гномий", "Goblin": "Гоблинский", "Halfling": "Язык полуросликов", "Orc": "Орочий",
           "Abyssal": "Язык Бездны", "Celestial": "Небесный", "Draconic": "Драконий", "Deep Speech": "Глубинная речь",
           "Infernal": "Инфернальный", "Primordial": "Первичный", "Sylvan": "Сильван", "Undercommon": "Подземный"}
ARMOR_CAT_RU = {"Light": "Лёгкий", "Medium": "Средний", "Heavy": "Тяжёлый", "Shield": "Щит"}
PROF_RU = {"Light Armor": "Лёгкие доспехи", "Medium Armor": "Средние доспехи", "Heavy Armor": "Тяжёлые доспехи",
           "All armor": "Все доспехи", "Shields": "Щиты", "Simple Weapons": "Простое оружие",
           "Martial Weapons": "Воинское оружие"}


def load(src: Path | None) -> dict[str, list]:
    data = {}
    for name in FILES:
        fn = f"5e-SRD-{name}.json"
        if src:
            data[name] = json.loads((src / fn).read_text(encoding="utf-8"))
        else:
            with urllib.request.urlopen(BASE + fn, timeout=60) as r:
                data[name] = json.loads(r.read().decode("utf-8"))
    return data


def txt(lines) -> str:
    if isinstance(lines, str):
        return lines
    return "\n".join(str(x) for x in (lines or []))


def opt_items(opt) -> list[dict] | None:
    """Вариант стартового снаряжения → список предметов, или None если вариант сложный (выбор из категории)."""
    t = opt.get("option_type")
    if t == "counted_reference":
        return [{"id": opt["of"]["index"], "qty": opt.get("count", 1)}]
    if t == "reference":
        return [{"id": opt["item"]["index"], "qty": 1}]
    if t == "multiple":
        out = []
        for o in opt.get("items", []):
            r = opt_items(o)
            if r is None:
                return None
            out += r
        return out
    return None


def _plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


UNITS_RU = {"action": ("действие",) * 3, "bonus action": ("бонусное действие",) * 3, "reaction": ("реакция",) * 3,
            "minute": ("минута", "минуты", "минут"), "hour": ("час", "часа", "часов"),
            "day": ("день", "дня", "дней"), "round": ("раунд", "раунда", "раундов"),
            "foot": ("фут", "фута", "футов"), "mile": ("миля", "мили", "миль")}
GEN_RU = {"minute": ("минуты", "минут"), "hour": ("часа", "часов"), "round": ("раунда", "раундов"),
          "day": ("дня", "дней")}  # «вплоть до 1 минуты / 10 минут»
WORDS_RU = {"touch": "Касание", "self": "На себя", "sight": "В пределах видимости", "unlimited": "Без ограничений",
            "special": "Особая", "instantaneous": "Мгновенная", "until dispelled": "Пока не рассеется"}


def ru_measure(text: str) -> str:
    """'1 bonus action' → '1 бонусное действие', 'Up to 10 minutes' → 'Концентрация, до 10 минут'."""
    import re
    t = text.strip()
    low = t.lower()
    if low in WORDS_RU:
        return WORDS_RU[low]
    pre = ""
    if low.startswith("up to "):
        pre, low = "Концентрация, вплоть до ", low[6:]
    m = re.fullmatch(r"(\d+)\s+(.+?)", low)
    if not m:
        return t
    n, unit = int(m.group(1)), m.group(2)
    unit = {"feet": "foot", "miles": "mile"}.get(unit, unit.rstrip("s") if unit.endswith("s") else unit)
    forms = UNITS_RU.get(unit)
    if pre and unit in GEN_RU:
        g1, g2 = GEN_RU[unit]
        return f"{pre}{n} {g1 if n % 10 == 1 and n % 100 != 11 else g2}"
    return f"{pre}{n} {_plural(n, *forms)}" if forms else t


def load_ru() -> dict:
    out = {}
    for f in sorted((ROOT / "tools" / "srd_ru").glob("spells_*.json")):
        out.update(json.loads(f.read_text(encoding="utf-8")))
    return out


def build(d: dict[str, list]) -> dict:
    levels = {x["index"]: x for x in d["Levels"]}
    traits = {x["index"]: x for x in d["Traits"]}

    # ---------------- снаряжение
    items = {}
    for e in d["Equipment"]:
        cat = e["equipment_category"]["index"]
        if cat not in ("weapon", "armor", "adventuring-gear", "tools"):
            continue
        it = {"id": e["index"], "en": e["name"], "w": e.get("weight", 0) or 0,
              "cost": f'{e["cost"]["quantity"]} {e["cost"]["unit"]}' if e.get("cost") else ""}
        if cat == "weapon":
            it["ru"] = WEAPON_RU.get(e["index"], e["name"])
            it["kind"] = "weapon"
            it["cat"] = e.get("weapon_category", "").lower()          # simple / martial
            it["range"] = e.get("weapon_range", "").lower()           # melee / ranged
            dmg = e.get("damage") or {}
            it["dmg"] = dmg.get("damage_dice", "")
            it["dtype"] = (dmg.get("damage_type") or {}).get("index", "")
            if e.get("two_handed_damage"):
                it["dmg2"] = e["two_handed_damage"]["damage_dice"]
            it["props"] = [p["index"] for p in e.get("properties", [])]
            rng = e.get("range") or {}
            tr = e.get("throw_range") or {}
            if it["range"] == "ranged" and rng.get("long"):
                it["dist"] = f'{rng.get("normal")}/{rng.get("long")}'
            elif tr:
                it["dist"] = f'{tr.get("normal")}/{tr.get("long")}'
        elif cat == "armor":
            it["ru"] = ARMOR_RU.get(e["index"], e["name"])
            it["kind"] = "shield" if e.get("armor_category") == "Shield" else "armor"
            ac = e.get("armor_class") or {}
            it["acat"] = (e.get("armor_category") or "").lower()
            it["ac"] = ac.get("base", 10)
            it["dex"] = bool(ac.get("dex_bonus"))
            if ac.get("max_bonus") is not None:
                it["maxdex"] = ac["max_bonus"]
            if e.get("str_minimum"):
                it["strmin"] = e["str_minimum"]
            if e.get("stealth_disadvantage"):
                it["stealth"] = True
        else:
            it["ru"] = GEAR_RU.get(e["name"], e["name"])
            it["kind"] = "gear"
        items[e["index"]] = it

    # ---------------- классы
    classes = []
    for c in d["Classes"]:
        cid = c["index"]
        skills_choice = {"n": 0, "from": []}
        for pc in c.get("proficiency_choices", []):
            opts = pc.get("from", {}).get("options", [])
            ids = [o.get("item", {}).get("index", "") for o in opts if o.get("option_type") == "reference"]
            ids = [i.removeprefix("skill-") for i in ids if i.startswith("skill-")]
            if ids:
                skills_choice = {"n": pc.get("choose", 0), "from": ids}
                break
        profs = [PROF_RU.get(p["name"], p["name"]) for p in c.get("proficiencies", [])
                 if not p["index"].startswith("saving-throw")]
        lv = []
        for n in range(1, 21):
            L = levels.get(f"{cid}-{n}", {})
            row = {"f": [f["index"] for f in L.get("features", [])]}
            sc = L.get("spellcasting")
            if sc:
                row["slots"] = [sc.get(f"spell_slots_level_{i}", 0) for i in range(1, 10)]
                while row["slots"] and row["slots"][-1] == 0:
                    row["slots"].pop()
                if sc.get("cantrips_known"):
                    row["cantrips"] = sc["cantrips_known"]
                if sc.get("spells_known"):
                    row["known"] = sc["spells_known"]
            cs = L.get("class_specific") or {}
            keep = {}
            for k, v in cs.items():
                if isinstance(v, (int, float)) and not k.startswith("mystic_arcanum"):
                    keep[k] = v
                elif isinstance(v, dict) and "dice_value" in v:
                    keep[k] = f'{v.get("dice_count", 1)}d{v["dice_value"]}'
            if keep:
                row["cs"] = keep
            lv.append(row)
        sub = []
        for s in d["Subclasses"]:
            if s["class"]["index"] != cid:
                continue
            slv = {}
            for n in range(1, 21):
                L = levels.get(f'{s["index"]}-{n}')
                if L and L.get("features"):
                    slv[n] = [f["index"] for f in L["features"]]
            sub.append({"id": s["index"], "ru": SUBCLASS_RU.get(s["index"], s["name"]), "en": s["name"],
                        "flavor": s.get("subclass_flavor", ""), "desc": txt(s.get("desc")), "levels": slv})
        start = []
        for se in c.get("starting_equipment", []):
            start.append({"id": se["equipment"]["index"], "qty": se.get("quantity", 1)})
        choices = []
        for so in c.get("starting_equipment_options", []):
            opts = so.get("from", {}).get("options", [])
            variants = [opt_items(o) for o in opts] if opts else []
            if variants and all(v is not None for v in variants):
                choices.append({"desc": so.get("desc", ""), "variants": variants})
            else:
                choices.append({"desc": so.get("desc", ""), "variants": None})
        sp = c.get("spellcasting")
        classes.append({
            "id": cid, "ru": CLASS_RU.get(cid, c["name"]), "en": c["name"], "hd": int(c["hit_die"]),
            "saves": [s["index"] for s in c.get("saving_throws", [])],
            "skills": skills_choice, "profs": profs,
            "caster": CASTER.get(cid), "spell_ability": sp["spellcasting_ability"]["index"] if sp else None,
            "sub_level": min((int(k) for s in sub for k in s["levels"]), default=3),
            "levels": lv, "subclasses": sub, "start": start, "start_choices": choices,
        })

    # ---------------- умения (описания)
    feats = {}
    for f in d["Features"]:
        feats[f["index"]] = {"en": f["name"], "lvl": f.get("level"), "desc": txt(f.get("desc"))}

    # ---------------- расы
    races = []
    for r in d["Races"]:
        rid = r["index"]
        subs = []
        for s in d["Subraces"]:
            if s["race"]["index"] != rid:
                continue
            subs.append({"id": s["index"], "ru": SUBRACE_RU.get(s["index"], s["name"]), "en": s["name"],
                         "asi": {b["ability_score"]["index"]: b["bonus"] for b in s.get("ability_bonuses", [])},
                         "traits": [t["index"] for t in s.get("racial_traits", [])]})
        races.append({
            "id": rid, "ru": RACE_RU.get(rid, r["name"]), "en": r["name"], "speed": r.get("speed", 30),
            "size": r.get("size", "Medium"),
            "asi": {b["ability_score"]["index"]: b["bonus"] for b in r.get("ability_bonuses", [])},
            "asi_choice": (r.get("ability_bonus_options") or {}).get("choose", 0),
            "langs": [LANG_RU.get(x["name"], x["name"]) for x in r.get("languages", [])],
            "traits": [t["index"] for t in r.get("traits", [])], "subraces": subs,
        })
    trait_out = {k: {"en": v["name"], "desc": txt(v.get("desc"))} for k, v in traits.items()}

    # ---------------- заклинания
    spells = []
    ru = load_ru()
    for s in d["Spells"]:
        dm = {}
        for dd in (s.get("damage") or []) if isinstance(s.get("damage"), list) else [s.get("damage") or {}]:
            if not dd:
                continue
            if dd.get("damage_at_slot_level"):
                dm["slot"] = dd["damage_at_slot_level"]
            if dd.get("damage_at_character_level"):
                dm["char"] = dd["damage_at_character_level"]
            if dd.get("damage_type"):
                dm["type"] = dd["damage_type"]["index"]
        heal = s.get("heal_at_slot_level")
        sp = {"id": s["index"], "en": s["name"], "lvl": s["level"], "school": s["school"]["index"],
              "time": s.get("casting_time", ""), "range": s.get("range", ""), "comp": "".join(s.get("components", [])),
              "mat": s.get("material", ""), "dur": s.get("duration", ""), "conc": bool(s.get("concentration")),
              "ritual": bool(s.get("ritual")), "desc": txt(s.get("desc")), "higher": txt(s.get("higher_level")),
              "classes": [c["index"] for c in s.get("classes", [])]}
        if s.get("attack_type"):
            sp["atk"] = s["attack_type"]
        if s.get("dc"):
            sp["save"] = s["dc"]["dc_type"]["index"]
        if dm:
            sp["dmg"] = dm
        if heal:
            sp["heal"] = heal
        r = ru.get(sp["id"])
        if r:
            sp["ru"] = r["name"]
            sp["desc_ru"] = r["desc"]
            if r.get("higher"):
                sp["higher_ru"] = r["higher"]
            if r.get("mat"):
                sp["mat_ru"] = r["mat"]
        else:
            print("  ! нет перевода заклинания:", sp["id"])
        sp["time_ru"], sp["range_ru"], sp["dur_ru"] = ru_measure(sp["time"]), ru_measure(sp["range"]), ru_measure(sp["dur"])
        spells.append(sp)
    spells.sort(key=lambda x: (x["lvl"], x["en"]))

    return {
        "version": 1, "source": "SRD 5.1 (5e-bits/5e-database)",
        "abilities": [{"id": k, "ru": v[0], "ru_s": v[1], "en": v[2], "en_s": v[3]} for k, v in ABIL.items()],
        "skills": [{"id": s[0], "ab": s[1], "ru": s[2], "en": s[3]} for s in SKILLS],
        "classes": classes, "features": feats, "races": races, "traits": trait_out,
        "backgrounds": [{"id": b[0], "ru": b[1], "en": b[2], "skills": b[3], "srd": b[4]} for b in BACKGROUNDS],
        "items": list(items.values()), "spells": spells,
        "conditions": [{"id": c[0], "ru": c[1], "en": c[2], "desc_ru": c[3]} for c in CONDITIONS],
        "exhaustion_ru": EXHAUSTION,
        "schools": SCHOOL_RU, "damage": DAMAGE_RU, "props": PROP_RU, "armor_cat": ARMOR_CAT_RU,
    }


LICENSE = """Данные правил в srd2014.json взяты из System Reference Document 5.1 (Wizards of the Coast),
в машинно-читаемом виде — из проекта 5e-bits/5e-database (https://github.com/5e-bits/5e-database).
SRD 5.1 распространяется по лицензии Creative Commons Attribution 4.0 International
(https://creativecommons.org/licenses/by/4.0/legalcode) и по Open Game License 1.0a.
This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC
and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under
the Creative Commons Attribution 4.0 International License available at
https://creativecommons.org/licenses/by/4.0/legalcode.
Русские названия классов, рас, навыков, снаряжения, краткие описания состояний и перевод заклинаний SRD 5.1
на русский язык — Masters Compendium; перевод распространяется на тех же условиях (CC-BY 4.0).
"""


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    out = build(load(src))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT.parent / "LICENSE-SRD.txt").write_text(LICENSE, encoding="utf-8")
    print(f"{OUT}: {OUT.stat().st_size // 1024} KB · классов {len(out['classes'])}, рас {len(out['races'])}, "
          f"заклинаний {len(out['spells'])}, предметов {len(out['items'])}, умений {len(out['features'])}")


if __name__ == "__main__":
    main()
