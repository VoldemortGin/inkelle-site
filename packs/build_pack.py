#!/usr/bin/env python3
"""Build and index Inkelle `.inkellepack` files (store-only zip).

    python3 packs/build_pack.py packs/src/<id>   # validate + write packs/<id>.inkellepack
    python3 packs/build_pack.py --index          # regenerate packs/index.json

Constraints mirror Inkelle/Services/Packs/PackService.swift (see FORMAT.md).
Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

PACKS_DIR = Path(__file__).resolve().parent
EXT = ".inkellepack"
MAX_ITEMS = 500
MAX_ID_LEN = 64
ITEM_TYPES = {"template", "sticker", "cover"}
STICKER_EXTS = {"png", "jpg", "jpeg"}
PAYLOAD_DIRS = ("templates", "stickers", "covers")
MIN_APP_VERSION = "2.0"
ID_RE = re.compile(r"[A-Za-z0-9-]+")


class PackError(Exception):
    pass


def is_safe_path(path: str) -> bool:
    return (
        bool(path) and not path.startswith("/") and "\\" not in path
        and all(seg not in ("", "..") for seg in path.split("/"))
    )


def validate(pack_dir: Path) -> dict:
    manifest_path = pack_dir / "pack.json"
    if not manifest_path.is_file():
        raise PackError(f"missing {manifest_path}")
    try:
        m = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise PackError(f"pack.json malformed: {e}") from e
    if m.get("formatVersion") != 1:
        raise PackError("formatVersion must be 1")
    pid = m.get("id")
    if not isinstance(pid, str) or not pid or len(pid) > MAX_ID_LEN or not ID_RE.fullmatch(pid):
        raise PackError("id must match [A-Za-z0-9-], 1..64 chars")
    if not isinstance(m.get("name"), str) or not m["name"]:
        raise PackError("name required")
    items = m.get("items")
    if not isinstance(items, list) or not items:
        raise PackError("items must be a non-empty list")
    if len(items) > MAX_ITEMS:
        raise PackError(f"too many items ({len(items)} > {MAX_ITEMS})")
    seen: set[str] = set()
    for it in items:
        if it.get("type") not in ITEM_TYPES:
            raise PackError(f"bad item type: {it.get('type')!r}")
        f = it.get("file")
        if not isinstance(f, str) or not is_safe_path(f):
            raise PackError(f"unsafe path: {f!r}")
        if f in seen:
            raise PackError(f"duplicate file: {f}")
        seen.add(f)
        if f.split("/")[0] not in PAYLOAD_DIRS:
            raise PackError(f"payload must live under {PAYLOAD_DIRS}: {f}")
        if it["type"] == "sticker" and f.rsplit(".", 1)[-1].lower() not in STICKER_EXTS:
            raise PackError(f"sticker must be png/jpg/jpeg: {f}")
        data = (pack_dir / f).read_bytes() if (pack_dir / f).is_file() else None
        if data is None:
            raise PackError(f"missing file: {f}")
        if not data.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff")):
            raise PackError(f"not a PNG/JPEG: {f}")
    return m


def build(pack_dir: Path) -> Path:
    m = validate(pack_dir)
    out = PACKS_DIR / f"{m['id']}{EXT}"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        z.write(pack_dir / "pack.json", "pack.json")
        for it in m["items"]:
            z.write(pack_dir / it["file"], it["file"])
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"{out.name}: sha256={digest} size={out.stat().st_size} itemCount={len(m['items'])}")
    return out


def build_index() -> None:
    old: dict[str, dict] = {}
    index_path = PACKS_DIR / "index.json"
    if index_path.is_file():
        old = {p["id"]: p for p in json.loads(index_path.read_text(encoding="utf-8")).get("packs", [])}
    entries = []
    for f in sorted(PACKS_DIR.glob(f"*{EXT}")):
        with zipfile.ZipFile(f) as z:
            m = json.loads(z.read("pack.json"))
        pid = m["id"]
        meta_path = PACKS_DIR / "src" / pid / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
        prev = old.get(pid, {})
        data = f.read_bytes()
        entries.append({
            "id": pid,
            "name": m["name"],
            "author": m.get("author") or "",
            "description": meta.get("description", prev.get("description", "")),
            "category": meta.get("category", prev.get("category", "")),
            "version": meta.get("version", prev.get("version", "1.0.0")),
            "file": f"packs/{f.name}",
            "sha256": hashlib.sha256(data).hexdigest(),
            "sizeBytes": len(data),
            "itemCount": len(m["items"]),
            "thumbnail": f"packs/{pid}.png",
            "minAppVersion": prev.get("minAppVersion", MIN_APP_VERSION),
        })
    index_path.write_text(
        json.dumps({"formatVersion": 1, "packs": entries}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"index.json: {len(entries)} packs")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pack_dir", nargs="?", type=Path, help="pack source dir containing pack.json")
    ap.add_argument("--index", action="store_true", help="regenerate index.json from all .inkellepack files")
    args = ap.parse_args()
    try:
        if args.index:
            build_index()
        elif args.pack_dir:
            build(args.pack_dir)
        else:
            ap.error("give a pack dir or --index")
    except PackError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
