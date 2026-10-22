"""Переводы интерфейса ГМ-приложения (RU / EN).

Веб-клиент игроков использует свой файл web/i18n.js.
Использование:  from .i18n import tr;  tr("start.title")
"""
from __future__ import annotations

_lang = "ru"

STRINGS: dict[str, dict[str, str]] = {
    # --- общее ---
    "app.subtitle": {"ru": "Помощник мастера и игроков", "en": "Companion for game masters and players"},
    "common.back": {"ru": "Назад", "en": "Back"},
    "common.cancel": {"ru": "Отмена", "en": "Cancel"},
    "common.ok": {"ru": "ОК", "en": "OK"},
    "common.create": {"ru": "Создать", "en": "Create"},
    "common.open": {"ru": "Открыть", "en": "Open"},
    "common.close": {"ru": "Закрыть", "en": "Close"},
    "common.copy": {"ru": "Копировать", "en": "Copy"},
    "common.copied": {"ru": "Скопировано", "en": "Copied"},
    "common.soon": {"ru": "Скоро", "en": "Soon"},
    "common.error": {"ru": "Ошибка", "en": "Error"},
    "common.yes": {"ru": "Да", "en": "Yes"},
    "common.no": {"ru": "Нет", "en": "No"},
    "common.details": {"ru": "Подробности", "en": "Details"},
    "dnd.show_folder": {"ru": "Показать в папке", "en": "Show in folder"},
    "dnd.forget": {"ru": "Убрать из списка", "en": "Remove from list"},

    # --- стартовый экран ---
    "start.choose": {"ru": "Выбери систему", "en": "Choose a system"},
    "start.dnd.title": {"ru": "Dungeons & Dragons", "en": "Dungeons & Dragons"},
    "start.dnd.desc": {"ru": "5-я редакция · правила 2014", "en": "5th edition · 2014 rules"},
    "start.cp.title": {"ru": "Cyberpunk RED", "en": "Cyberpunk RED"},
    "start.cp.desc": {"ru": "Night City ждёт. В разработке", "en": "Night City awaits. In development"},
    "start.cp.toast": {"ru": "Режим Cyberpunk RED появится после D&D", "en": "Cyberpunk RED mode comes after D&D"},

    # --- меню D&D ---
    "dnd.title": {"ru": "Dungeons & Dragons 5e", "en": "Dungeons & Dragons 5e"},
    "dnd.gm": {"ru": "Я мастер", "en": "I'm the GM"},
    "dnd.gm.desc": {"ru": "Создать или открыть кампанию и пустить игроков", "en": "Create or open a campaign and let players in"},
    "dnd.player": {"ru": "Я игрок", "en": "I'm a player"},
    "dnd.player.desc": {"ru": "Найти игру в своей сети или ввести адрес", "en": "Find a game on your network or enter an address"},
    "dnd.new": {"ru": "Новая кампания", "en": "New campaign"},
    "dnd.open": {"ru": "Открыть файл…", "en": "Open file…"},
    "dnd.recent": {"ru": "Недавние кампании", "en": "Recent campaigns"},
    "dnd.recent.empty": {"ru": "Пока пусто. Создай первую кампанию!", "en": "Nothing yet. Create your first campaign!"},

    # --- создание кампании ---
    "newc.title": {"ru": "Новая кампания", "en": "New campaign"},
    "newc.name": {"ru": "Название кампании", "en": "Campaign name"},
    "newc.name.ph": {"ru": "Например: Проклятие Страда", "en": "E.g. Curse of Strahd"},
    "newc.file": {"ru": "Файл", "en": "File"},
    "newc.browse": {"ru": "Обзор…", "en": "Browse…"},
    "newc.exists": {"ru": "Такой файл уже есть. Перезаписать?", "en": "This file already exists. Overwrite?"},
    "newc.empty": {"ru": "Введи название кампании", "en": "Enter a campaign name"},
    "file.filter": {"ru": "Кампания Masters Compendium (*.campaign)", "en": "Masters Compendium campaign (*.campaign)"},
    "file.open_failed": {"ru": "Не удалось открыть кампанию", "en": "Could not open the campaign"},
    "file.save_failed": {"ru": "Не удалось сохранить кампанию", "en": "Could not save the campaign"},

    # --- лобби ---
    "lobby.players": {"ru": "Игроки", "en": "Players"},
    "lobby.players.empty": {"ru": "Пока никого. Пусть игроки отсканируют QR-код", "en": "No one yet. Let players scan the QR code"},
    "lobby.scan": {"ru": "Отсканируй камерой телефона", "en": "Scan with your phone camera"},
    "lobby.code": {"ru": "Код комнаты", "en": "Room code"},
    "lobby.address": {"ru": "Адрес", "en": "Address"},
    "lobby.network": {"ru": "Сеть", "en": "Network"},
    "lobby.network.hint": {
        "ru": "Для игры через интернет выбери адрес VPN (Radmin VPN, ZeroTier, Tailscale)",
        "en": "For online play pick your VPN address (Radmin VPN, ZeroTier, Tailscale)",
    },
    "lobby.fullscreen_qr": {"ru": "QR на весь экран", "en": "Full-screen QR"},
    "lobby.gm_window": {"ru": "Окно мастера", "en": "GM window"},
    "lobby.gm_window.tip": {"ru": "Листы всех персонажей, броски (и скрытые), журнал — в отдельном окне",
                            "en": "All character sheets, rolls (incl. hidden) and the log — in a separate window"},
    "lobby.chars": {"ru": "Персонажи", "en": "Characters"},
    "lobby.chars.empty": {"ru": "Персонажей пока нет. Игроки создают их у себя на телефоне во вкладке «Персонаж».",
                          "en": "No characters yet. Players create them on their phones in the Character tab."},
    "lobby.chars.import": {"ru": "Импорт .character…", "en": "Import .character…"},
    "lobby.chars.export": {"ru": "Сохранить в файл .character", "en": "Save to a .character file"},
    "lobby.chars.npc": {"ru": "Без игрока (NPC)", "en": "No player (NPC)"},
    "lobby.chars.owner": {"ru": "Чей это персонаж?", "en": "Whose character is it?"},
    "lobby.chars.delete": {"ru": "Удалить персонажа «{name}» из кампании? Сначала можно сохранить его в файл (💾).",
                           "en": "Delete “{name}” from the campaign? You can save it to a file first (💾)."},
    "file.char_filter": {"ru": "Персонаж Masters Compendium (*.character *.json)", "en": "Masters Compendium character (*.character *.json)"},
    "lobby.hp": {"ru": "хиты", "en": "HP"},
    "join.locked": {"ru": "вход закрыт", "en": "locked"},
    "lobby.help": {"ru": "Не подключается?", "en": "Can't connect?"},
    "lobby.inet": {"ru": "Играть через интернет (без VPN)", "en": "Play over the internet (no VPN)"},
    "lobby.inet.tip": {"ru": "Публичный адрес через tuna.am или Cloudflare: игрокам не нужно ничего ставить — только ссылка или QR",
                       "en": "Public address via tuna.am or Cloudflare: players install nothing — just the link or QR"},
    "lobby.inet.item": {"ru": "интернет", "en": "internet"},
    "lobby.inet.download.tuna": {
        "ru": "Нужна программа tuna (несколько МБ, с releases.tuna.am). Скачать сейчас? Это нужно один раз.",
        "en": "The tuna tool is needed (a few MB, from releases.tuna.am). Download now? Needed only once."},
    "lobby.inet.download.cloudflare": {
        "ru": "Нужна программа Cloudflare «cloudflared» (около 60 МБ, с GitHub). Скачать сейчас? Это нужно один раз.",
        "en": "Cloudflare's “cloudflared” is needed (about 60 MB, from GitHub). Download now? Needed only once."},
    "lobby.inet.downloading": {"ru": "Скачиваю программу туннеля… {p}%", "en": "Downloading the tunnel tool… {p}%"},
    "lobby.inet.starting": {"ru": "Открываю доступ из интернета…", "en": "Opening internet access…"},
    "lobby.inet.stop": {"ru": "Закрыть доступ из интернета", "en": "Close internet access"},
    "lobby.inet.on": {
        "ru": "Адрес в интернете выбран в списке «Сеть» — QR и ссылка уже ведут на него. Ссылку можно скинуть в Discord. "
              "Вход по-прежнему только с кодом комнаты. Адрес меняется при каждом запуске.",
        "en": "The internet address is selected under Network — the QR and link point to it. You can share the link on Discord. "
              "Joining still needs the room code. The address changes every launch."},
    "lobby.tunnel_download": {"ru": "Не удалось скачать программу туннеля. Проверь интернет и попробуй ещё раз.",
                              "en": "Couldn't download the tunnel tool. Check the internet connection and try again."},
    "lobby.tunnel_write": {"ru": "Не удалось сохранить программу туннеля в папку данных.",
                           "en": "Couldn't save the tunnel tool to the app's data folder."},
    "lobby.tunnel_start": {"ru": "tuna не запустилась. Возможно, её блокирует антивирус или нет интернета.",
                           "en": "tuna didn't start. An antivirus may block it, or there is no internet."},
    "lobby.tunnel_timeout": {"ru": "tuna не выдала адрес за минуту. Проверь интернет и попробуй ещё раз. Если повторится — пришли лог.",
                             "en": "tuna didn't give an address within a minute. Check the internet and retry."},
    "lobby.tunnel_closed": {"ru": "Доступ из интернета прервался. Нажми кнопку ещё раз — будет новый адрес.",
                            "en": "Internet access dropped. Press the button again — you'll get a new address."},
    "lobby.tunnel_no_token": {"ru": "Для tuna нужен токен — вставь его в окне настройки.",
                               "en": "tuna needs a token — paste it in the settings window."},
    "lobby.tunnel_bad_token": {"ru": "tuna не принял токен. Скопируй его заново на my.tuna.am → «Токен».",
                                "en": "tuna rejected the token. Copy it again at my.tuna.am → Token."},
    "lobby.tunnel_start_cf": {
        "ru": "Cloudflare не подключился. В России он ограничен — без VPN обычно не работает. Попробуй tuna (работает без VPN).",
        "en": "Cloudflare didn't connect. It's restricted in Russia and usually needs a VPN. Try tuna instead."},
    "lobby.tunnel_closed_cf": {
        "ru": "Связь с Cloudflare прервалась (часто — после выключения VPN: в России Cloudflare ограничен). "
              "Для игры без VPN выбери tuna.",
        "en": "The Cloudflare connection dropped (often after turning off a VPN — Cloudflare is restricted in Russia). "
              "To play without VPN choose tuna."},
    "lobby.tunnel_timeout_cf": {
        "ru": "Cloudflare не выдал адрес за минуту. В России без VPN он обычно не работает — выбери tuna.",
        "en": "Cloudflare gave no address within a minute. In Russia it usually needs a VPN — choose tuna."},
    "tun.title": {"ru": "Игра через интернет", "en": "Playing over the internet"},
    "tun.intro": {
        "ru": "Программа откроет публичный адрес, который ведёт на твой компьютер. Игрокам ничего ставить не нужно — "
              "только ссылка или QR и код комнаты. Выбери сервис:",
        "en": "The app opens a public address leading to your computer. Players install nothing — just the link or QR "
              "and the room code. Choose a service:"},
    "tun.tuna": {"ru": "tuna.am — сервера в России, работает без VPN (рекомендуется)",
                 "en": "tuna.am — servers in Russia, works without VPN (recommended in Russia)"},
    "tun.tuna.d": {
        "ru": "Бесплатно, но нужна регистрация: зайди на <a href=\"https://my.tuna.am/\" style=\"color:#a78bfa\">my.tuna.am</a> "
              "и открой раздел с токеном, скопируй его и вставь сюда. Один раз.",
        "en": "Free, but needs sign-up: go to <a href=\"https://my.tuna.am/\" style=\"color:#a78bfa\">my.tuna.am</a>, "
              "open the token page, copy the token and paste it here. Only once."},
    "tun.token.ph": {"ru": "Токен tuna", "en": "tuna token"},
    "tun.token.get": {"ru": "Получить токен", "en": "Get a token"},
    "tun.cf": {"ru": "Cloudflare — без регистрации", "en": "Cloudflare — no sign-up"},
    "tun.cf.d": {"ru": "Самый простой вариант за пределами России. В России Cloudflare ограничен: без VPN у мастера "
                       "и у всех игроков обычно не работает.",
                 "en": "The simplest option outside Russia. In Russia Cloudflare is restricted: without a VPN on the GM's "
                       "and every player's device it usually doesn't work."},
    "tun.start": {"ru": "Открыть доступ", "en": "Open access"},
    "tun.sub": {"ru": "Постоянный адрес:", "en": "Permanent address:"},
    "tun.sub.ph": {"ru": "например, kettu-dnd (необязательно)", "en": "e.g. kettu-dnd (optional)"},
    "tun.sub.d": {
        "ru": "Без него ссылка новая при каждом запуске, и телефоны игроков не узнают её — приходится входить заново. "
              "Один постоянный адрес у tuna бесплатный: <a href=\"https://my.tuna.am/\" style=\"color:#a78bfa\">my.tuna.am</a> "
              "→ «Поддомены» → зарезервируй имя и впиши его сюда. Тогда игроки заходят под собой сами.",
        "en": "Without it the link changes on every start and players' phones don't recognise it, so they have to sign in again. "
              "tuna gives one permanent address for free: <a href=\"https://my.tuna.am/\" style=\"color:#a78bfa\">my.tuna.am</a> "
              "→ Subdomains → reserve a name and type it here. Then players are signed in automatically."},
    "lobby.tunnel_bad_sub": {"ru": "tuna не дал этот постоянный адрес. Проверь, что он зарезервирован на my.tuna.am → «Поддомены», "
                                   "и имя вписано без ошибок (или очисти поле).",
                             "en": "tuna refused this permanent address. Check that it's reserved at my.tuna.am → Subdomains "
                                   "and spelled correctly (or clear the field)."},
    "lobby.tunnel_no_exe": {"ru": "Установи cloudflared (brew install cloudflared) и попробуй снова.",
                            "en": "Install cloudflared (brew install cloudflared) and try again."},
    "lobby.lock": {"ru": "Закрыть вход новым игрокам", "en": "Lock the lobby for new players"},
    "lobby.new_code": {"ru": "Новый код", "en": "New code"},
    "lobby.end": {"ru": "Завершить сессию", "en": "End session"},
    "lobby.end.confirm": {
        "ru": "Завершить сессию? Игроки будут отключены, кампания сохранится.",
        "en": "End the session? Players will be disconnected, the campaign will be saved.",
    },
    "lobby.online": {"ru": "в сети", "en": "online"},
    "lobby.offline": {"ru": "не в сети", "en": "offline"},
    "lobby.kick": {"ru": "Выгнать", "en": "Kick"},
    "lobby.remove": {"ru": "Удалить", "en": "Remove"},
    "lobby.kick.confirm": {
        "ru": "Убрать игрока «{name}» из кампании? Он сможет зайти снова только по коду.",
        "en": "Remove player “{name}” from the campaign? They can rejoin only with the code.",
    },
    "lobby.server_failed": {"ru": "Не удалось запустить сервер", "en": "Could not start the server"},
    "lobby.status.running": {"ru": "Сервер запущен · порт {port}", "en": "Server running · port {port}"},
    "lobby.status.starting": {"ru": "Запуск сервера…", "en": "Starting server…"},
    "lobby.next_stage_old": {
        "ru": "Дальше: листы персонажей, кубики и карта — следующие этапы",
        "en": "Next up: character sheets, dice and the map — upcoming stages",
    },
    "lobby.saved": {"ru": "Сохранено", "en": "Saved"},
    "lobby.joined": {"ru": "{name} подключился", "en": "{name} joined"},
    "lobby.left": {"ru": "{name} отключился", "en": "{name} left"},

    # --- подключение игрока с ПК ---
    "join.title": {"ru": "Подключиться к игре", "en": "Join a game"},
    "join.searching": {"ru": "Ищу игры в локальной сети…", "en": "Looking for games on the local network…"},
    "join.found": {"ru": "Найденные игры", "en": "Games found"},
    "join.manual": {"ru": "Или введи адрес вручную (его видно у мастера под QR-кодом)", "en": "Or type the address (the GM sees it under the QR code)"},
    "join.connect": {"ru": "Подключиться", "en": "Connect"},
    "join.hint": {
        "ru": "Игра откроется в браузере. Совет: с телефона проще отсканировать QR-код с экрана мастера.",
        "en": "The game opens in your browser. Tip: on a phone just scan the QR code on the GM's screen.",
    },
    "join.bad_address": {"ru": "Похоже, адрес неправильный", "en": "This address doesn't look right"},

    # --- настройки / прочее ---
    "lang.label": {"ru": "Язык", "en": "Language"},
    "error.unexpected": {"ru": "Что-то пошло не так", "en": "Something went wrong"},
    "error.details": {"ru": "Подробности записаны в MastersCompendium_data/masters_compendium.log", "en": "Details were written to MastersCompendium_data/masters_compendium.log"},
    "close.confirm": {
        "ru": "Идёт сессия. Закрыть программу? Кампания сохранится, игроки будут отключены.",
        "en": "A session is running. Quit? The campaign will be saved and players disconnected.",
    },
}


def set_lang(lang: str) -> None:
    global _lang
    _lang = lang if lang in ("ru", "en") else "ru"


def get_lang() -> str:
    return _lang


def tr(key: str, **kwargs: object) -> str:
    entry = STRINGS.get(key)
    if entry is None:
        return key
    text = entry.get(_lang) or entry.get("ru") or key
    if kwargs:
        try:
            text = text.format(**kwargs)
        except (KeyError, IndexError, ValueError):
            pass
    return text
