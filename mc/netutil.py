"""Сетевые мелочи: список адресов компьютера, поиск свободного порта."""
from __future__ import annotations

import ipaddress
import socket
import sys
from dataclasses import dataclass

DISCOVERY_PORT = 47665      # UDP, отдельно от диапазона игровых портов 8765+
DISCOVERY_MAGIC = b"MASTERS_COMPENDIUM_DISCOVER_1"


@dataclass
class LocalAddress:
    ip: str
    label: str          # имя адаптера (Wi-Fi, Radmin VPN, ZeroTier ...)
    kind: str           # "lan" | "vpn" | "other"

    @property
    def is_vpn(self) -> bool:
        return self.kind == "vpn"


VPN_HINTS = ("radmin", "zerotier", "tailscale", "hamachi", "wireguard", "openvpn", "vpn", "tap-", "tun")
SKIP_HINTS = ("vmware", "virtualbox", "vbox", "hyper-v", "vethernet", "wsl", "docker", "loopback", "bluetooth")


def classify(ip: str, label: str) -> str:
    low = label.lower()
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return "other"
    if any(h in low for h in VPN_HINTS):
        return "vpn"
    # Tailscale выдаёт адреса 100.64.0.0/10, Radmin VPN — 26.0.0.0/8
    if addr in ipaddress.ip_network("100.64.0.0/10") or addr in ipaddress.ip_network("26.0.0.0/8"):
        return "vpn"
    if addr.is_private:
        return "lan"
    return "other"


def is_skipped(label: str) -> bool:
    low = label.lower()
    return any(h in low for h in SKIP_HINTS)


def primary_ip() -> str | None:
    """Адрес, через который компьютер ходит в сеть (без реальной отправки пакетов)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None
    finally:
        s.close()


def sort_addresses(items: list[LocalAddress], preferred: str = "") -> list[LocalAddress]:
    """Сначала выбранный ранее, потом основной адрес, потом остальные LAN, потом VPN."""
    main = primary_ip()
    rank = {"lan": 1, "vpn": 2, "other": 3}

    def key(a: LocalAddress):
        return (0 if a.ip == preferred else 1, 0 if a.ip == main else 1, rank.get(a.kind, 9), a.ip)

    seen, out = set(), []
    for a in sorted(items, key=key):
        if a.ip not in seen:
            seen.add(a.ip)
            out.append(a)
    return out


def stdlib_addresses() -> list[LocalAddress]:
    """Запасной способ без Qt (для тестов и консоли)."""
    out: list[LocalAddress] = []
    main = primary_ip()
    if main:
        out.append(LocalAddress(main, "LAN", classify(main, "")))
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                out.append(LocalAddress(ip, "", classify(ip, "")))
    except OSError:
        pass
    return sort_addresses(out)


def port_is_free(port: int, host: str = "0.0.0.0") -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if sys.platform != "win32":
        # так же, как сервер: соединения в TIME_WAIT после прошлой сессии не мешают
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def find_free_port(start: int, tries: int = 20) -> int:
    for p in range(start, start + tries):
        if port_is_free(p):
            return p
    raise OSError(f"no free port in {start}..{start + tries - 1}")


def player_url(ip: str, port: int, code: str = "") -> str:
    url = f"http://{ip}:{port}/"
    return f"{url}?code={code}" if code else url
