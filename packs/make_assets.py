#!/usr/bin/env python3
"""Generate the source material (PNG templates / stickers / thumbnails) for the
official packs under packs/src/<id>/. Standard library only (hand-written PNG
encoder). Run from the site repo root: python3 packs/make_assets.py
"""

from __future__ import annotations

import json
from pathlib import Path
import struct
import zlib

SRC_DIR = Path(__file__).resolve().parent / "src"
W, H = 1200, 1600

WHITE = (255, 255, 255)
LINE = (180, 195, 215)
RED = (225, 120, 120)
INK = (70, 90, 130)
GREEN = (110, 170, 130)


class Canvas:
    def __init__(self, w: int, h: int, bg: tuple[int, ...] = WHITE) -> None:
        self.w, self.h, self.ch = w, h, len(bg)
        self.rows = [bytearray(bg * w) for _ in range(h)]

    def rect(self, x0: int, y0: int, x1: int, y1: int, color: tuple[int, ...]) -> None:
        x0, x1 = max(0, x0), min(self.w, x1)
        px = bytes(color) * max(0, x1 - x0)
        for y in range(max(0, y0), min(self.h, y1)):
            self.rows[y][x0 * self.ch : x1 * self.ch] = px

    def hline(self, y: int, x0: int, x1: int, color: tuple[int, ...], t: int = 2) -> None:
        self.rect(x0, y, x1, y + t, color)

    def vline(self, x: int, y0: int, y1: int, color: tuple[int, ...], t: int = 2) -> None:
        self.rect(x, y0, x + t, y1, color)

    def box(self, x0: int, y0: int, x1: int, y1: int, color: tuple[int, ...], t: int = 3) -> None:
        self.hline(y0, x0, x1, color, t)
        self.hline(y1 - t, x0, x1, color, t)
        self.vline(x0, y0, y1, color, t)
        self.vline(x1 - t, y0, y1, color, t)

    def png(self) -> bytes:
        ctype = {1: 0, 3: 2, 4: 6}[self.ch]
        raw = b"".join(b"\x00" + bytes(r) for r in self.rows)

        def chunk(tag: bytes, data: bytes) -> bytes:
            body = tag + data
            return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

        ihdr = struct.pack(">IIBBBBB", self.w, self.h, 8, ctype, 0, 0, 0)
        return (
            b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
        )


def scale_down(src: Canvas, w: int, h: int) -> Canvas:
    """Nearest-neighbour thumbnail (templates are line art, good enough)."""
    out = Canvas(w, h)
    for y in range(h):
        row = src.rows[y * src.h // h]
        out.rows[y] = bytearray(b"".join(bytes(row[(x * src.w // w) * 3 : (x * src.w // w) * 3 + 3]) for x in range(w)))
    return out


# ---------- templates ----------

def tpl_essay_grid() -> Canvas:
    """Kaoyan big-essay manuscript: 20 columns x 22 rows of square cells."""
    c = Canvas(W, H)
    cell, cols, rows = 54, 20, 25
    x0, y0 = (W - cols * cell) // 2, 140
    for i in range(cols + 1):
        c.vline(x0 + i * cell, y0, y0 + rows * cell, LINE, 2)
    for j in range(rows + 1):
        c.hline(y0 + j * cell, x0, x0 + cols * cell + 2, LINE, 2)
    for j in range(5, rows, 5):
        c.hline(y0 + j * cell, x0, x0 + cols * cell + 2, RED, 3)
    c.hline(90, x0, x0 + cols * cell, INK, 3)
    return c


def tpl_essay_lined() -> Canvas:
    """Letter / small-essay ruled page with a margin and a header block."""
    c = Canvas(W, H)
    c.box(100, 80, W - 100, 220, INK)
    c.vline(300, 80, 220, INK)
    for y in range(300, H - 100, 64):
        c.hline(y, 100, W - 100, LINE)
    c.vline(160, 240, H - 100, RED, 3)
    return c


def tpl_essay_outline() -> Canvas:
    """Essay planning sheet: topic, 3 paragraphs boxes, conclusion."""
    c = Canvas(W, H)
    c.box(100, 80, W - 100, 260, INK)
    top = 320
    for i, h in enumerate((280, 340, 340, 240)):
        c.box(100, top, W - 100, top + h, INK if i < 3 else GREEN)
        for y in range(top + 60, top + h - 20, 56):
            c.hline(y, 130, W - 130, LINE)
        top += h + 40
    return c


def tpl_chem_balance() -> Canvas:
    """Equation balancing table: 12 rows of  [coef]A + [coef]B -> [coef]C + [coef]D."""
    c = Canvas(W, H)
    x0, x1, y0, rh = 80, W - 80, 160, 110
    for r in range(12):
        y = y0 + r * rh
        c.box(x0, y, x1, y + rh - 10, LINE, 2)
        slots = 4
        sw = (x1 - x0) // slots
        for s in range(slots):
            sx = x0 + s * sw
            c.box(sx + 14, y + 20, sx + 74, y + rh - 30, INK, 2)  # coefficient box
            c.hline(y + rh - 28, sx + 90, sx + sw - 70, LINE, 2)  # formula underline
            sign_x = sx + sw - 50
            if s == 1:  # arrow
                c.hline(y + 48, sign_x - 20, sign_x + 30, RED, 4)
                c.rect(sign_x + 20, y + 38, sign_x + 30, y + 58, RED)
            elif s in (0, 2):  # plus
                c.hline(y + 48, sign_x, sign_x + 30, INK, 3)
                c.vline(sign_x + 14, y + 34, y + 62, INK, 3)
    c.box(x0, 60, x1, 130, INK)
    return c


def tpl_chem_notes() -> Canvas:
    """Reaction notes: conditions / observation / mole-calculation panels."""
    c = Canvas(W, H)
    c.box(80, 80, W - 80, 220, INK)
    c.vline(W // 2, 80, 220, INK)
    top = 270
    for h, col in ((420, LINE), (420, LINE), (560, GREEN)):
        c.box(80, top, W - 80, top + h, col)
        for y in range(top + 70, top + h - 20, 60):
            c.hline(y, 110, W - 110, LINE)
        top += h + 30
    return c


def tpl_pomodoro_daily() -> Canvas:
    """Daily Pomodoro plan: top-3 goals + 8 pomodoro rows with 4 tomato checkboxes."""
    c = Canvas(W, H)
    c.box(80, 70, W - 80, 170, INK)
    c.box(80, 210, W - 80, 560, INK)
    for i in range(3):
        y = 260 + i * 100
        c.box(110, y, 170, y + 60, RED, 3)
        c.hline(y + 58, 200, W - 110, LINE)
    for r in range(8):
        y = 600 + r * 115
        c.box(80, y, W - 80, y + 100, LINE, 2)
        c.vline(330, y, y + 100, LINE)
        c.hline(y + 70, 360, W - 110, LINE)
        for k in range(4):
            c.box(110 + k * 52, y + 30, 150 + k * 52, y + 70, RED, 3)
    return c


def tpl_pomodoro_timeline() -> Canvas:
    """Hour timeline 06:00-22:00 split in 30-minute slots, with a notes column."""
    c = Canvas(W, H)
    x0, x1, y0, sh = 80, 780, 120, 44
    c.box(x0, 40, W - 80, 100, INK)
    for i in range(32):
        y = y0 + i * sh
        c.hline(y, x0, x1, INK if i % 2 == 0 else LINE, 3 if i % 2 == 0 else 2)
    c.hline(y0 + 32 * sh, x0, x1, INK, 3)
    c.vline(x0, y0, y0 + 32 * sh, INK, 3)
    c.vline(x0 + 130, y0, y0 + 32 * sh, LINE)
    c.vline(x1, y0, y0 + 32 * sh, INK, 3)
    c.box(830, y0, W - 80, y0 + 560, GREEN)
    c.box(830, y0 + 600, W - 80, y0 + 32 * sh, INK)
    return c


def tpl_pomodoro_weekly() -> Canvas:
    """Weekly pomodoro tracker: 7 day rows x 12 tomato boxes + weekly review."""
    c = Canvas(W, H)
    c.box(80, 70, W - 80, 170, INK)
    for d in range(7):
        y = 220 + d * 135
        c.box(80, y, W - 80, y + 120, LINE, 2)
        c.vline(260, y, y + 120, LINE)
        for k in range(12):
            c.box(290 + k * 70, y + 40, 330 + k * 70, y + 80, RED, 3)
    c.box(80, 1190, W - 80, 1540, GREEN)
    for y in range(1260, 1520, 60):
        c.hline(y, 110, W - 110, LINE)
    return c


# ---------- stickers ----------

def _sticker(inside, color: tuple[int, int, int], size: int = 64, ss: int = 4) -> Canvas:
    c = Canvas(size, size, (0, 0, 0, 0))
    for y in range(size):
        for x in range(size):
            hits = sum(
                inside((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size)
                for i in range(ss) for j in range(ss)
            )
            if hits:
                c.rows[y][x * 4 : x * 4 + 4] = bytes((*color, round(255 * hits / (ss * ss))))
    return c


def _seg_dist(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5


def _in_poly(px: float, py: float, pts: list[tuple[float, float]]) -> bool:
    inside = False
    for (ax, ay), (bx, by) in zip(pts, pts[1:] + pts[:1]):
        if (ay > py) != (by > py) and px < (bx - ax) * (py - ay) / (by - ay) + ax:
            inside = not inside
    return inside


def _star_pts() -> list[tuple[float, float]]:
    import math
    return [
        (0.5 + (0.46 if i % 2 == 0 else 0.19) * math.sin(i * math.pi / 5),
         0.54 - (0.46 if i % 2 == 0 else 0.19) * math.cos(i * math.pi / 5))
        for i in range(10)
    ]


def stickers() -> dict[str, Canvas]:
    star = _star_pts()
    return {
        "check": _sticker(
            lambda x, y: min(_seg_dist(x, y, .18, .52, .42, .76), _seg_dist(x, y, .42, .76, .82, .26)) < .08,
            (60, 170, 100)),
        "cross": _sticker(
            lambda x, y: min(_seg_dist(x, y, .2, .2, .8, .8), _seg_dist(x, y, .8, .2, .2, .8)) < .08,
            (220, 80, 80)),
        "star": _sticker(lambda x, y: _in_poly(x, y, star), (250, 190, 40)),
        "circle": _sticker(lambda x, y: (x - .5) ** 2 + (y - .5) ** 2 < .42 ** 2, (70, 130, 220)),
        "square": _sticker(lambda x, y: .1 < x < .9 and .1 < y < .9, (150, 100, 210)),
        "triangle": _sticker(lambda x, y: _in_poly(x, y, [(.5, .1), (.92, .88), (.08, .88)]), (240, 140, 60)),
    }


# ---------- packs ----------

def write_pack(pack_id: str, name: str, desc: str, category: str, items: list[dict], images: dict[str, bytes],
               thumb: bytes) -> None:
    d = SRC_DIR / pack_id
    for rel, data in images.items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    manifest = {"formatVersion": 1, "id": pack_id, "name": name, "author": "Inkelle", "items": items}
    (d / "pack.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (d / "meta.json").write_text(
        json.dumps({"description": desc, "category": category, "version": "1.0.0"}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    (SRC_DIR.parent / f"{pack_id}.png").write_bytes(thumb)


def main() -> None:
    def tpl_pack(pid: str, name: str, desc: str, cat: str, specs: list[tuple[str, str, Canvas]]) -> None:
        images = {f"templates/{fn}.png": cv.png() for fn, _, cv in specs}
        items = [{"type": "template", "file": f"templates/{fn}.png", "category": cat, "name": nm} for fn, nm, _ in specs]
        write_pack(pid, name, desc, cat, items, images, scale_down(specs[0][2], 360, 480).png())

    tpl_pack("kaoyan-english-writing", "考研英语作文格", "考研英语大小作文稿纸：方格稿纸、书信横线页、作文提纲页。", "考研",
             [("big-essay-grid", "大作文方格稿纸", tpl_essay_grid()),
              ("small-essay-lined", "小作文横线页", tpl_essay_lined()),
              ("essay-outline", "作文提纲页", tpl_essay_outline())])
    tpl_pack("chem-equation-balance", "化学方程式配平表", "方程式配平练习表与反应笔记页。", "化学",
             [("balance-table", "配平练习表", tpl_chem_balance()),
              ("reaction-notes", "反应笔记页", tpl_chem_notes())])
    tpl_pack("pomodoro-daily-planner", "每日 Pomodoro 计划", "每日番茄钟计划、时间轴与每周追踪。", "效率",
             [("daily-plan", "每日番茄计划", tpl_pomodoro_daily()),
              ("timeline", "时间轴", tpl_pomodoro_timeline()),
              ("weekly-tracker", "每周番茄追踪", tpl_pomodoro_weekly())])

    st = stickers()
    names = {"check": "对勾", "cross": "叉", "star": "星形", "circle": "圆", "square": "方块", "triangle": "三角"}
    sheet = Canvas(360, 480)
    for i, cv in enumerate(st.values()):
        ox, oy = 20 + (i % 3) * 112, 120 + (i // 3) * 140
        for y in range(64):
            for x in range(64):
                r, g, b, a = cv.rows[y][x * 4 : x * 4 + 4]
                px = sheet.rows[oy + y][(ox + x) * 3 : (ox + x) * 3 + 3]
                sheet.rows[oy + y][(ox + x) * 3 : (ox + x) * 3 + 3] = bytes(
                    (p * (255 - a) + q * a) // 255 for p, q in zip(px, (r, g, b)))
    write_pack("basic-shape-stickers", "基础标记贴纸", "对勾、叉、星形与基础几何图形，批注和打卡通用。", "贴纸",
               [{"type": "sticker", "file": f"stickers/{k}.png", "category": "标记", "name": names[k]} for k in st],
               {f"stickers/{k}.png": v.png() for k, v in st.items()}, sheet.png())


if __name__ == "__main__":
    main()
