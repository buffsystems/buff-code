#!/usr/bin/env python3
"""Сводит два файла обновления macOS (arm64 и x64) в один.

Архитектуры собираются поочерёдно, потому что внутрь каждого пакета кладётся свой
консольный бинарь; electron-builder при этом каждый раз перезаписывает latest-mac.yml.
Без слияния обновлятор предложит владельцу Apple Silicon сборку под Intel.
"""
import re
import sys
from pathlib import Path

desktop, out = Path(sys.argv[1]), Path(sys.argv[2])
arm_file, x64_file = desktop / "latest-mac-arm64.yml", desktop / "latest-mac-x64.yml"
if not (arm_file.exists() and x64_file.exists()):
    sys.exit(0)

def entries(text: str) -> list[str]:
    return [e.rstrip() for e in re.findall(r"  - url: .*?(?=\n  - url: |\npath: )", text, re.S)]

arm_text, x64_text = arm_file.read_text(), x64_file.read_text()
version = re.search(r"^version: (.+)$", arm_text, re.M).group(1)
date = re.search(r"^releaseDate: (.+)$", arm_text, re.M).group(1)
# По умолчанию отдаём сборку под Apple Silicon: на ней сегодня почти все.
default = re.search(r"^path: (.+)$", arm_text, re.M).group(1)
sha = re.search(r"^sha512: (.+)$", arm_text, re.M).group(1)
files = entries(arm_text) + entries(x64_text)
(out / "latest-mac.yml").write_text(
    "version: {}\nfiles:\n{}\npath: {}\nsha512: {}\nreleaseDate: {}\n".format(
        version, "\n".join(files), default, sha, date
    )
)
for stale in ("latest-mac-arm64.yml", "latest-mac-x64.yml"):
    (out / stale).unlink(missing_ok=True)
print(f"  latest-mac.yml: архитектур в списке — {len(files)}")
