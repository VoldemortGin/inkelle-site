#!/usr/bin/env python3
"""Build the Inkelle user-guide static pages from the Markdown source.

The site has no build system: the generated HTML in guide/ is committed as
source. Re-run this script whenever the Markdown source changes.

How to regenerate
-----------------
From the site repo root (/Users/linhan/startup/inkelle-site):

    python3 tools/build_guide.py

By default it reads the Markdown from the sibling app repo
(../Inkelle/docs/user-guide) and writes guide/*.html next to this repo's
index.html. Pass an explicit source directory to override:

    python3 tools/build_guide.py /path/to/user-guide

This is a self-contained, standard-library-only converter (no pip deps). It
covers exactly the Markdown used by the guide: ATX headings (#..###), pipe
tables with alignment, nested ordered/unordered lists, **bold**, `inline code`,
[links](...), blockquotes (rendered as tip boxes) and --- rules. Internal
`.md` links are rewritten to `.html`. It intentionally does NOT support: fenced
code blocks, images, inline emphasis with single * or _, footnotes, or HTML
passthrough -- none of which appear in the source.
"""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

SITE_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = SITE_ROOT / "guide"

# Source lives in the sibling app repo by default; overridable via argv[1].
DEFAULT_SRC = SITE_ROOT.parent / "Inkelle" / "docs" / "user-guide"

APP_VERSION = "v1.6"

# Chapter order drives prev/next navigation.
CHAPTERS = [
    "01-getting-started",
    "02-writing-canvas",
    "03-pages-documents",
    "04-insert-content",
    "05-audio-lecture",
    "06-ai-assistant",
    "07-study-system",
    "08-search-organize",
    "09-sync-backup-export",
    "10-subscription",
    "11-settings-faq",
]

# The source has one dangling reference (03-canvas.md) left over from an earlier
# chapter split; every use is about recording, which now lives in chapter 05.
LINK_ALIASES = {
    "03-canvas": "05-audio-lecture",
}

# ---------------------------------------------------------------------------
# Shared style block: reuses index.html's design tokens verbatim, plus the
# guide-specific typography/layout rules. Kept in one place so every generated
# page stays visually identical to the site.
# ---------------------------------------------------------------------------
STYLE = """
  :root {
    --ink: #1f1912;
    --ink-soft: #4a4234;
    --muted: #6b6151;
    --rule: #e7ddc8;
    --bg: #fdf8f0;
    --surface: #ffffff;
    --paper: #faf3e3;
    --accent: #3b78c4;
    --accent-ink: #2c5fa3;
    --r-btn: 12px;
    --r-card: 16px;
    --r-device: 24px;
    --shadow-tint: 31, 25, 18;
    --code-bg: #f1e9d8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #f0e8d8;
      --ink-soft: #cfc5b0;
      --muted: #9a8f7a;
      --rule: #322b20;
      --bg: #161209;
      --surface: #1f1a10;
      --paper: #241e12;
      --accent: #6aa1dd;
      --accent-ink: #8db8e8;
      --shadow-tint: 0, 0, 0;
      --code-bg: #2a2416;
    }
  }

  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", system-ui, sans-serif;
    line-height: 1.7; font-size: 17px;
    -webkit-font-smoothing: antialiased;
  }
  .serif { font-family: "Songti SC", "Noto Serif SC", Georgia, "Times New Roman", serif; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  img { display: block; max-width: 100%; height: auto; }
  .wrap { max-width: 1160px; margin: 0 auto; padding: 0 24px; }

  /* ---- nav (shared with index.html) ---- */
  .nav {
    position: sticky; top: 0; z-index: 10; height: 64px;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border-bottom: 1px solid var(--rule);
  }
  .nav-inner { max-width: 1160px; margin: 0 auto; padding: 0 24px; height: 64px; display: flex; align-items: center; gap: 28px; }
  .brand { display: flex; align-items: center; gap: 10px; color: var(--ink); font-weight: 600; font-size: 19px; }
  .brand:hover { text-decoration: none; }
  .brand img { width: 28px; height: 28px; border-radius: 7px; }
  .nav-links { display: flex; gap: 22px; margin-left: auto; font-size: 15px; }
  .nav-links a { color: var(--ink-soft); }
  .nav-links a:hover { color: var(--ink); }
  .nav .btn { margin-left: 4px; }
  @media (max-width: 760px) { .nav-links { display: none; } .nav .btn { margin-left: auto; } }

  .btn {
    display: inline-flex; align-items: center; gap: 9px;
    background: var(--ink); color: var(--bg);
    border-radius: var(--r-btn); padding: 12px 22px;
    font-size: 16px; font-weight: 600; letter-spacing: .01em;
    transition: transform .18s cubic-bezier(.16,1,.3,1), background .18s;
  }
  .btn:hover { transform: translateY(-1px); text-decoration: none; }
  .btn:active { transform: scale(.98); }
  .btn svg { width: 18px; height: 18px; fill: currentColor; }
  .btn.small { padding: 8px 16px; font-size: 14px; }

  /* ---- breadcrumb ---- */
  .crumb { font-size: 14.5px; color: var(--muted); padding: 26px 0 0; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .crumb a { color: var(--ink-soft); }
  .crumb a:hover { color: var(--ink); }
  .crumb .sep { color: var(--rule); }

  /* ---- guide layout: article + sticky TOC ---- */
  .guide-layout {
    max-width: 1080px; margin: 0 auto; padding: 8px 24px 24px;
    display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 56px; align-items: start;
  }
  .toc { position: sticky; top: 88px; font-size: 14.5px; }
  .toc-title { text-transform: uppercase; letter-spacing: .12em; font-size: 12px; color: var(--muted); margin: 0 0 12px; }
  .toc ol { list-style: none; margin: 0; padding: 0; border-left: 1px solid var(--rule); }
  .toc li { margin: 0; }
  .toc a { display: block; color: var(--ink-soft); padding: 5px 0 5px 14px; margin-left: -1px; border-left: 2px solid transparent; line-height: 1.45; }
  .toc a:hover { color: var(--ink); border-left-color: var(--accent); text-decoration: none; }
  @media (max-width: 900px) { .guide-layout { grid-template-columns: 1fr; gap: 0; } .toc { display: none; } }

  /* ---- article typography ---- */
  article { min-width: 0; }
  article h1 { font-size: clamp(30px, 4.4vw, 42px); line-height: 1.25; font-weight: 700; margin: 18px 0 8px; letter-spacing: .01em; }
  .lede { color: var(--muted); font-size: 15px; margin: 0 0 8px; }
  article h2 { font-size: clamp(22px, 2.8vw, 28px); line-height: 1.35; font-weight: 700; margin: 52px 0 14px; padding-top: 8px; scroll-margin-top: 84px; }
  article h2:first-of-type { margin-top: 32px; }
  article h3 { font-size: 19px; font-weight: 650; margin: 32px 0 10px; scroll-margin-top: 84px; }
  article p { margin: 0 0 16px; color: var(--ink); }
  article ul, article ol { margin: 0 0 16px; padding-left: 26px; }
  article li { margin: 6px 0; }
  article li > ul, article li > ol { margin: 6px 0 4px; }
  article strong { font-weight: 650; }
  article a { color: var(--accent); font-weight: 500; }
  code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    background: var(--code-bg); padding: 1.5px 6px; border-radius: 5px; font-size: .88em;
  }
  article hr { border: none; border-top: 1px solid var(--rule); margin: 44px 0; }

  /* ---- tip / blockquote ---- */
  blockquote.tip {
    margin: 22px 0; padding: 14px 18px;
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
    border: 1px solid var(--rule); border-left: 3px solid var(--accent);
    border-radius: var(--r-btn); color: var(--ink-soft); font-size: 15.5px;
  }
  blockquote.tip p { margin: 0 0 8px; }
  blockquote.tip p:last-child { margin: 0; }
  blockquote.tip strong { color: var(--ink); }

  /* ---- tables ---- */
  .table-scroll { overflow-x: auto; margin: 20px 0; border: 1px solid var(--rule); border-radius: var(--r-card); }
  article table { border-collapse: collapse; width: 100%; font-size: 15px; }
  article th, article td { text-align: left; padding: 11px 16px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  article thead th { background: var(--paper); font-weight: 650; color: var(--ink); white-space: nowrap; }
  article tbody tr:last-child td { border-bottom: none; }
  article td code { white-space: nowrap; }

  /* ---- prev / next ---- */
  .pager { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 56px 0 8px; }
  .pager a, .pager span {
    display: flex; flex-direction: column; gap: 4px;
    border: 1px solid var(--rule); border-radius: var(--r-card); padding: 16px 20px;
    background: var(--surface); transition: transform .18s cubic-bezier(.16,1,.3,1), border-color .18s;
  }
  .pager a:hover { transform: translateY(-2px); border-color: var(--muted); text-decoration: none; }
  .pager .dir { font-size: 13px; color: var(--muted); }
  .pager .ttl { font-size: 16px; font-weight: 600; color: var(--ink); }
  .pager .next { text-align: right; }
  .pager span { opacity: .45; }
  @media (max-width: 560px) { .pager { grid-template-columns: 1fr; } .pager .next { text-align: left; } }

  /* ---- guide index (TOC hub) ---- */
  .guide-hero { padding: 44px 0 8px; max-width: 720px; }
  .badge {
    display: inline-block; font-size: 13px; font-weight: 600; letter-spacing: .02em;
    color: var(--accent-ink); background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--rule));
    border-radius: 999px; padding: 4px 14px; margin-bottom: 20px;
  }
  .guide-hero h1 { font-size: clamp(34px, 4.6vw, 50px); line-height: 1.2; font-weight: 700; margin: 0 0 16px; }
  .guide-hero p { font-size: 18px; color: var(--ink-soft); margin: 0; }
  .card-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 40px 0 8px; }
  .gcard {
    display: flex; gap: 16px; align-items: flex-start;
    background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-card);
    padding: 22px; transition: transform .2s cubic-bezier(.16,1,.3,1), box-shadow .2s;
  }
  .gcard:hover { transform: translateY(-3px); box-shadow: 0 14px 38px rgba(var(--shadow-tint), .10); text-decoration: none; }
  .gcard .num {
    flex: none; width: 38px; height: 38px; border-radius: 10px;
    background: var(--paper); border: 1px solid var(--rule);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 15px; color: var(--accent-ink);
  }
  .gcard h3 { margin: 2px 0 6px; font-size: 18px; font-weight: 650; color: var(--ink); }
  .gcard p { margin: 0; font-size: 14.5px; color: var(--ink-soft); line-height: 1.6; }
  @media (max-width: 720px) { .card-grid { grid-template-columns: 1fr; } }

  .conventions { max-width: 760px; margin: 64px 0 8px; }
  .conventions h2 { font-size: 24px; font-weight: 700; margin: 0 0 14px; }
  .conventions ul { padding-left: 22px; color: var(--ink-soft); }
  .conventions li { margin: 8px 0; }
  .conventions strong { color: var(--ink); }

  /* ---- footer (shared with index.html) ---- */
  footer { border-top: 1px solid var(--rule); padding: 40px 0 56px; margin-top: 40px; }
  .foot-inner { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
  .foot-inner .brand { font-size: 17px; }
  .foot-links { display: flex; gap: 20px; margin-left: auto; font-size: 14.5px; flex-wrap: wrap; }
  .foot-links a { color: var(--ink-soft); }
  .foot-links a:hover { color: var(--ink); }
  .copyright { width: 100%; color: var(--muted); font-size: 13.5px; margin-top: 14px; }
"""

APPSTORE_SVG = (
    '<svg viewBox="0 0 384 512" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 '
    "50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 "
    "141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 "
    "31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 "
    "24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z\"/></svg>"
)

APPSTORE_URL = "https://apps.apple.com/app/id6774624375"


def nav_html() -> str:
    return f"""<nav class="nav">
  <div class="nav-inner">
    <a class="brand" href="index.html"><img src="../assets/app-icon.png" alt="Inkelle 图标" width="28" height="28" /><span class="serif">Inkelle</span></a>
    <div class="nav-links">
      <a href="../index.html">官网首页</a>
      <a href="index.html">使用指南</a>
      <a href="../index.html#faq">常见问题</a>
    </div>
    <a class="btn small" href="{APPSTORE_URL}">{APPSTORE_SVG}在 App Store 下载</a>
  </div>
</nav>"""


def footer_html() -> str:
    return """<footer>
  <div class="wrap foot-inner">
    <span class="brand"><img src="../assets/app-icon.png" alt="" width="28" height="28" /><span class="serif">Inkelle <span style="color:var(--muted); font-weight:400;">墨笺</span></span></span>
    <div class="foot-links">
      <a href="index.html">使用指南</a>
      <a href="../privacy.html">隐私政策</a>
      <a href="../terms.html">使用条款</a>
      <a href="mailto:gin.linhan@gmail.com">联系我们</a>
      <a href="%s">在 App Store 下载</a>
    </div>
    <p class="copyright">© 2026 Inkelle · Han Lin</p>
  </div>
</footer>""" % APPSTORE_URL


def page_shell(title: str, description: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="zh-Hans">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(description)}" />
<link rel="icon" type="image/png" href="../assets/app-icon.png" />
<meta property="og:title" content="{html.escape(title)}" />
<meta property="og:description" content="{html.escape(description)}" />
<meta property="og:type" content="article" />
<meta property="og:image" content="https://inkelle.pages.dev/assets/screenshot-1.png" />
<style>{STYLE}</style>
</head>
<body>
{nav_html()}
{body}
{footer_html()}
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Inline + block Markdown conversion
# ---------------------------------------------------------------------------

_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
_BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
_CODE_RE = re.compile(r"`([^`]+)`")


def rewrite_link(url: str) -> str:
    """Rewrite an internal .md link target to .html (applying aliases)."""
    if url.startswith(("http://", "https://", "mailto:", "#")):
        return url
    frag = ""
    if "#" in url:
        url, frag = url.split("#", 1)
        frag = "#" + frag
    url = url[2:] if url.startswith("./") else url
    if url.endswith(".md"):
        stem = url[:-3]
        stem = LINK_ALIASES.get(stem, stem)
        return f"{stem}.html{frag}"
    return url + frag


def inline(text: str) -> str:
    """Convert inline Markdown (code, links, bold) to HTML, escaping the rest."""
    codes: list[str] = []

    def stash_code(m: re.Match) -> str:
        codes.append(html.escape(m.group(1)))
        return f"\x00{len(codes) - 1}\x00"

    text = _CODE_RE.sub(stash_code, text)
    text = html.escape(text, quote=False)
    text = _LINK_RE.sub(
        lambda m: f'<a href="{html.escape(rewrite_link(m.group(2)), quote=True)}">{m.group(1)}</a>',
        text,
    )
    text = _BOLD_RE.sub(r"<strong>\1</strong>", text)
    text = re.sub(r"\x00(\d+)\x00", lambda m: f"<code>{codes[int(m.group(1))]}</code>", text)
    return text


_LIST_ITEM_RE = re.compile(r"^(\s*)([-*]|\d+\.)\s+(.*)$")


def _build_nested(items: list[tuple[int, bool, str]]) -> str:
    """Turn a flat (indent, ordered, content) item list into nested <ul>/<ol>."""
    pos = 0

    def build(current_indent: int) -> str:
        nonlocal pos
        ordered = items[pos][1]
        tag = "ol" if ordered else "ul"
        out = [f"<{tag}>"]
        while pos < len(items):
            indent, _ordered, content = items[pos]
            if indent < current_indent:
                break
            if indent > current_indent:
                nested = build(indent)
                out[-1] = out[-1][: -len("</li>")] + nested + "</li>"
            else:
                pos += 1
                out.append(f"<li>{inline(content)}</li>")
        out.append(f"</{tag}>")
        return "".join(out)

    return build(items[0][0])


def _split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _is_table_sep(line: str) -> bool:
    return bool(re.match(r"^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$", line)) and "-" in line


def convert(md: str) -> tuple[str, str, list[tuple[str, str]]]:
    """Convert one chapter's Markdown body.

    Returns (title, body_html, toc) where toc is a list of (anchor_id, text).
    The leading H1 becomes the title (and an <h1>); H2s get sequential ids and
    populate the TOC.
    """
    lines = md.split("\n")
    n = len(lines)
    i = 0
    title = ""
    toc: list[tuple[str, str]] = []
    h2_count = 0
    out: list[str] = []

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped == "":
            i += 1
            continue

        # horizontal rule
        if re.match(r"^-{3,}$", stripped):
            out.append("<hr />")
            i += 1
            continue

        # headings
        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            content = m.group(2).strip()
            if level == 1 and not title:
                title = content
                out.append(f'<h1 class="serif">{inline(content)}</h1>')
            elif level == 2:
                h2_count += 1
                anchor = f"s{h2_count}"
                toc.append((anchor, content))
                out.append(f'<h2 id="{anchor}">{inline(content)}</h2>')
            else:
                tag = f"h{min(level, 6)}"
                out.append(f"<{tag}>{inline(content)}</{tag}>")
            i += 1
            continue

        # blockquote (tip box) -- consume consecutive '>' lines
        if stripped.startswith(">"):
            quote_lines: list[str] = []
            while i < n and lines[i].strip().startswith(">"):
                quote_lines.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            paras = []
            for chunk in re.split(r"\n\s*\n", "\n".join(quote_lines)):
                chunk = chunk.strip()
                if chunk:
                    paras.append(f"<p>{inline(chunk)}</p>")
            out.append(f'<blockquote class="tip">{"".join(paras)}</blockquote>')
            continue

        # table -- header row followed by separator row
        if stripped.startswith("|") and i + 1 < n and _is_table_sep(lines[i + 1]):
            header = _split_row(lines[i])
            aligns_raw = _split_row(lines[i + 1])
            aligns = []
            for a in aligns_raw:
                left, right = a.startswith(":"), a.endswith(":")
                aligns.append("center" if left and right else "right" if right else "left" if left else "")
            i += 2
            body_rows = []
            while i < n and lines[i].strip().startswith("|"):
                body_rows.append(_split_row(lines[i]))
                i += 1

            def cell(tag: str, text: str, idx: int) -> str:
                align = aligns[idx] if idx < len(aligns) else ""
                style = f' style="text-align:{align}"' if align else ""
                return f"<{tag}{style}>{inline(text)}</{tag}>"

            thead = "<tr>" + "".join(cell("th", h, j) for j, h in enumerate(header)) + "</tr>"
            tbody = "".join(
                "<tr>" + "".join(cell("td", c, j) for j, c in enumerate(row)) + "</tr>" for row in body_rows
            )
            out.append(f'<div class="table-scroll"><table><thead>{thead}</thead><tbody>{tbody}</tbody></table></div>')
            continue

        # list block
        if _LIST_ITEM_RE.match(line):
            items: list[tuple[int, bool, str]] = []
            while i < n:
                lm = _LIST_ITEM_RE.match(lines[i])
                if lm:
                    indent = len(lm.group(1))
                    ordered = bool(re.match(r"\d+\.", lm.group(2)))
                    items.append((indent, ordered, lm.group(3)))
                    i += 1
                elif lines[i].strip() == "":
                    j = i + 1
                    while j < n and lines[j].strip() == "":
                        j += 1
                    if j < n and _LIST_ITEM_RE.match(lines[j]):
                        i = j
                    else:
                        break
                else:
                    break
            # normalize indents to nesting levels so mixed 2/3-space indents nest cleanly
            uniq = sorted({it[0] for it in items})
            level_of = {v: k for k, v in enumerate(uniq)}
            items = [(level_of[ind], ordered, content) for ind, ordered, content in items]
            out.append(_build_nested(items))
            continue

        # paragraph
        out.append(f"<p>{inline(stripped)}</p>")
        i += 1

    return title, "\n".join(out), toc


# ---------------------------------------------------------------------------
# Page assembly
# ---------------------------------------------------------------------------

# Short titles + descriptions parsed from README, but the chapter->title map is
# derived from each file's own H1 at build time; descriptions come from README.


def build_chapter(stem: str, idx: int, descriptions: dict[str, str]) -> str:
    src = SRC / f"{stem}.md"
    title, body, toc = convert(src.read_text(encoding="utf-8"))
    number = stem.split("-", 1)[0]
    desc = descriptions.get(stem, f"Inkelle 使用指南 · {title}")

    toc_html = ""
    if toc:
        links = "".join(f'<li><a href="#{a}">{inline(t)}</a></li>' for a, t in toc)
        toc_html = f"""
    <aside class="toc" aria-label="本页目录">
      <p class="toc-title">本页目录</p>
      <ol>{links}</ol>
    </aside>"""

    # prev / next
    prev_link = (
        f'<a class="prev" href="index.html"><span class="dir">← 上一页</span><span class="ttl">指南目录</span></a>'
        if idx == 0
        else _pager_link("prev", "← 上一章", CHAPTERS[idx - 1])
    )
    next_link = (
        f'<span class="next"><span class="dir">下一章 →</span><span class="ttl">已是最后一章</span></span>'
        if idx == len(CHAPTERS) - 1
        else _pager_link("next", "下一章 →", CHAPTERS[idx + 1])
    )

    body_html = f"""<div class="crumb wrap">
  <a href="../index.html">官网首页</a><span class="sep">/</span>
  <a href="index.html">使用指南</a><span class="sep">/</span>
  <span>第 {number} 章</span>
</div>
<div class="guide-layout">
    <article>
      <p class="lede">Inkelle 使用指南 · 第 {number} 章 · 对应 App {APP_VERSION}</p>
      {body}
      <nav class="pager" aria-label="章节导航">
        {prev_link}
        {next_link}
      </nav>
    </article>{toc_html}
</div>"""

    return page_shell(f"{title} — Inkelle 使用指南", desc, body_html)


def _pager_link(cls: str, dir_label: str, stem: str) -> str:
    title = _chapter_titles[stem]
    return (
        f'<a class="{cls}" href="{stem}.html">'
        f'<span class="dir">{dir_label}</span><span class="ttl">{html.escape(title)}</span></a>'
    )


def parse_readme() -> tuple[str, list[dict], list[str]]:
    """Parse README.md -> (intro_paragraph_html, chapter rows, conventions items)."""
    text = (SRC / "README.md").read_text(encoding="utf-8")
    lines = text.split("\n")

    # intro: first non-empty, non-heading, non-blockquote paragraph
    intro = ""
    for ln in lines:
        s = ln.strip()
        if s and not s.startswith(("#", ">", "|")):
            intro = s
            break

    # table rows under '## 目录'
    rows: list[dict] = []
    row_re = re.compile(r"^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(.*?)\s*\|$")
    for ln in lines:
        m = row_re.match(ln.strip())
        if m:
            label, href, desc = m.group(1), m.group(2), m.group(3)
            # label like "01 · 快速上手"
            num, _, ttl = label.partition("·")
            rows.append(
                {
                    "num": num.strip(),
                    "title": ttl.strip(),
                    "stem": rewrite_link(href)[:-5],  # strip .html
                    "desc": desc,
                }
            )

    # conventions: list items under '## 阅读约定'
    conventions: list[str] = []
    in_conv = False
    for ln in lines:
        if ln.strip().startswith("## 阅读约定"):
            in_conv = True
            continue
        if in_conv:
            if ln.strip().startswith("## "):
                break
            if re.match(r"^\s*-\s+", ln):
                conventions.append(re.sub(r"^\s*-\s+", "", ln).strip())

    return intro, rows, conventions


def build_index(intro: str, rows: list[dict], conventions: list[str]) -> str:
    cards = []
    for r in rows:
        cards.append(
            f'<a class="gcard" href="{r["stem"]}.html">'
            f'<span class="num">{html.escape(r["num"])}</span>'
            f'<span><h3>{inline(r["title"])}</h3><p>{inline(r["desc"])}</p></span>'
            f"</a>"
        )
    conv_items = "".join(f"<li>{inline(c)}</li>" for c in conventions)

    body = f"""<div class="crumb wrap">
  <a href="../index.html">官网首页</a><span class="sep">/</span>
  <span>使用指南</span>
</div>
<header class="guide-hero wrap">
  <span class="badge">对应 App 版本 {APP_VERSION}</span>
  <h1 class="serif">Inkelle 使用指南</h1>
  <p>{inline(intro)}</p>
</header>
<div class="wrap">
  <div class="card-grid">
    {"".join(cards)}
  </div>
  <section class="conventions">
    <h2 class="serif">阅读约定</h2>
    <ul>{conv_items}</ul>
  </section>
</div>"""

    return page_shell(
        "Inkelle 使用指南 — 从上手到用满每一项能力",
        f"Inkelle 使用指南（对应 App {APP_VERSION}）：手写画布、录音课堂、AI 助手、间隔重复学习系统、搜索整理、同步备份与订阅的完整分章说明。",
        body,
    )


def main() -> None:
    global SRC, _chapter_titles
    SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_SRC
    if not SRC.is_dir():
        raise SystemExit(f"source dir not found: {SRC}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    intro, rows, conventions = parse_readme()
    descriptions = {r["stem"]: r["desc"] for r in rows}
    _chapter_titles = {}
    for stem in CHAPTERS:
        first_line = (SRC / f"{stem}.md").read_text(encoding="utf-8").split("\n", 1)[0]
        _chapter_titles[stem] = first_line.lstrip("# ").strip()

    (OUT_DIR / "index.html").write_text(build_index(intro, rows, conventions), encoding="utf-8")
    print("wrote guide/index.html")
    for idx, stem in enumerate(CHAPTERS):
        (OUT_DIR / f"{stem}.html").write_text(build_chapter(stem, idx, descriptions), encoding="utf-8")
        print(f"wrote guide/{stem}.html")


_chapter_titles: dict[str, str] = {}
SRC: Path = DEFAULT_SRC

if __name__ == "__main__":
    main()
