"""Собрать набор иконок для веб-клиента (web/js/icons.js) и программы мастера (mc/ui/icons_data.py).

Иконки — Lucide (лицензия ISC, https://lucide.dev), плюс свой d20 в стиле логотипа.
Запуск:  python tools/build_icons.py <папка lucide-static/icons>
  (npm pack lucide-static && tar xzf lucide-static-*.tgz → package/icons)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# наше имя → имя в Lucide
MAP = {
    "character": "scroll-text", "map": "map", "dice": "dices", "party": "users", "main": "shield",
    "attacks": "swords", "spells": "sparkles", "inventory": "backpack", "features": "book-open", "persona": "drama",
    "star": "star", "edit": "pencil", "more": "ellipsis", "heart": "heart", "speed": "footprints", "init": "zap",
    "hidden": "eye-off", "eye": "eye", "adv": "chevrons-up", "dis": "chevrons-down", "short-rest": "coffee",
    "long-rest": "moon-star", "level-up": "arrow-big-up", "download": "download", "trash": "trash-2",
    "upload": "file-up", "user": "user-round", "camera": "camera", "x": "x", "check": "check", "info": "info",
    "lock": "lock", "coins": "coins", "folder": "folder-open", "save": "save", "power": "power",
    "refresh": "refresh-cw", "copy": "copy", "maximize": "maximize", "help": "circle-help", "phone": "smartphone",
    "radar": "radar", "wand": "wand-sparkles", "plus": "plus", "minus": "minus", "back": "chevron-left",
    "next": "chevron-right", "crit": "flame", "skull": "skull", "pen": "pen-line", "file-new": "file-plus-2",
    "crown": "crown", "alert": "triangle-alert", "shield-half": "shield-half", "sword": "sword", "armor": "shirt",
    "gem": "gem", "sparkle": "sparkle", "heart-pulse": "heart-pulse", "network": "wifi", "city": "building-2",
    "qr": "qr-code", "players": "users-round", "scroll": "scroll", "flask": "flask-conical", "tent": "tent",
    "hand": "hand", "target": "crosshair", "hourglass": "hourglass", "book": "book", "brain": "brain", "volume": "volume-2", "volume-off": "volume-x",
    "c-blinded": "eye-off", "c-charmed": "heart-handshake", "c-deafened": "ear-off", "c-frightened": "ghost",
    "c-grappled": "hand", "c-incapacitated": "circle-slash", "c-invisible": "eye-closed", "c-paralyzed": "zap-off",
    "c-petrified": "mountain", "c-poisoned": "biohazard", "c-prone": "arrow-down-to-line", "c-restrained": "link",
    "c-stunned": "orbit", "c-unconscious": "bed", "c-exhaustion": "battery-low", "c-concentration": "brain",
    "c-flying": "feather", "c-cover_half": "shield-half", "c-cover_3q": "shield", "c-cover_full": "lock",
    "c-surprised": "triangle-alert", "c-ready": "hourglass", "c-hiding": "eye-off", "c-dash": "zap", "c-dodge": "shield-half", "c-disengage": "footprints",
    "ruler": "ruler", "t-circle": "circle", "t-cone": "cone", "t-line": "slash", "t-cube": "square",
    "pointer": "mouse-pointer-2", "ping": "radio", "fog": "cloud-fog", "rect": "square-dashed", "poly": "pentagon",
    "lasso": "lasso-select", "grid": "grid-3x3", "image": "image-up", "layers": "layers", "settings": "settings",
    "locate": "locate", "user-plus": "user-plus", "cast": "cast", "zoom-in": "zoom-in", "zoom-out": "zoom-out",
    "droplet": "droplet", "move": "move", "undo": "undo-2", "map-pin": "map-pin",
    "external": "external-link", "history": "history", "tilt": "rotate-3d", "panel": "panel-right", "group": "boxes",
    "play": "play", "footprints": "footprints", "activity": "activity",
    "snowflake": "snowflake", "sun": "sun", "moon": "moon", "palette": "palette", "copy-plus": "copy-plus",
    "ghost": "ghost", "user-cog": "user-cog", "swords": "swords",
}

# свой d20 (вид спереди, как в логотипе) — контур 24×24
CUSTOM = {
    "d20": '<path d="M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5Z"/><path d="M12 6.8 16.6 15H7.4Z"/>'
           '<path d="M12 2.5v4.3M3.5 7.25l3.9 7.75M20.5 7.25 16.6 15M7.4 15 3.5 16.75M16.6 15l3.9 1.75M7.4 15 12 21.5 16.6 15"/>',
}


def inner_svg(path: Path) -> str:
    s = path.read_text(encoding="utf-8")
    body = re.search(r"<svg[^>]*>(.*)</svg>", s, re.S).group(1)
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    return re.sub(r"\s+", " ", body).strip()


def main() -> None:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "package/icons")
    icons = {}
    for ours, theirs in MAP.items():
        f = src / f"{theirs}.svg"
        if not f.exists():
            raise SystemExit(f"нет иконки {theirs}")
        icons[ours] = inner_svg(f)
    icons.update(CUSTOM)

    js = ("// Сгенерировано tools/build_icons.py — не править руками.\n"
          "// Иконки Lucide (ISC License, https://lucide.dev) + d20 Masters Compendium.\n"
          "(() => {\n  const I = " + json.dumps(icons, ensure_ascii=False, indent=0) + ";\n"
          "  window.MC = window.MC || {};\n"
          "  /** Иконка: MC.icon('dice') или MC.icon('dice', 'big') */\n"
          "  window.MC.icon = (name, cls = '') => `<svg class=\"ic ${cls}\" viewBox=\"0 0 24 24\" fill=\"none\" "
          "stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">${I[name] || ''}</svg>`;\n"
          "  window.MC.ICONS = I;\n})();\n")
    (ROOT / "web" / "js" / "icons.js").write_text(js, encoding="utf-8")

    py = ('"""Сгенерировано tools/build_icons.py — не править руками.\n'
          'Иконки Lucide (ISC License, https://lucide.dev) + d20 Masters Compendium."""\n\n'
          "ICONS = " + json.dumps(icons, ensure_ascii=False, indent=4) + "\n")
    (ROOT / "mc" / "ui" / "icons_data.py").write_text(py, encoding="utf-8")
    lic = (src.parent / "LICENSE").read_text(encoding="utf-8") if (src.parent / "LICENSE").exists() else "ISC License — Lucide Contributors"
    (ROOT / "web" / "js" / "LICENSE-icons.txt").write_text("Icons: Lucide (https://lucide.dev)\n\n" + lic, encoding="utf-8")
    print(f"иконок: {len(icons)}")


if __name__ == "__main__":
    main()
