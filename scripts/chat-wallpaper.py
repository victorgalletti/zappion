# SPDX-License-Identifier: AGPL-3.0-only
"""Draws Zappion's chat wallpaper: a seamless doodle tile around the chameleon logo.

Writes web/public/images/chat-wallpaper.svg (used by the web) and chat-wallpaper.png (2x, used by the
Windows client through windows/tools/generate-assets.py). The PNG is rendered with headless Chrome or
Edge. Run: python scripts/chat-wallpaper.py
"""
import math
import random
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web/public/images"
TILE = 400  # logical px; the PNG is rendered at 2x
SEED = 7


def spiral():
    # The chameleon's curled tail: an Archimedean spiral that runs out into a short tail.
    pts = []
    for i in range(0, 121):
        t = i / 120 * 3.6 * math.pi
        r = 0.9 * t
        pts.append((r * math.cos(t), r * math.sin(t)))
    x, y = pts[-1]
    pts += [(x + 3, y + 5), (x + 8, y + 7)]
    d = "M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in pts)
    return [f'<path d="{d}"/>']


def star():
    pts = []
    for i in range(10):
        r = 10 if i % 2 == 0 else 4.2
        a = -math.pi / 2 + i * math.pi / 5
        pts.append(f"{r * math.cos(a):.2f} {r * math.sin(a):.2f}")
    return [f'<path d="M{" L".join(pts)} Z"/>']


def sun():
    rays = "".join(
        f"M{6.5 * math.cos(a):.2f} {6.5 * math.sin(a):.2f} L{10 * math.cos(a):.2f} {10 * math.sin(a):.2f} "
        for a in (i * math.pi / 4 for i in range(8))
    )
    return ['<circle r="4"/>', f'<path d="{rays}"/>']


def flower():
    petals = [f'<circle cx="{4.5 * math.cos(a):.2f}" cy="{4.5 * math.sin(a):.2f}" r="3.2"/>'
              for a in (i * 2 * math.pi / 5 for i in range(5))]
    return petals + ['<circle r="1.6" class="f"/>']


# Each icon is drawn in a box from -12 to 12, stroke only ("f" = filled).
ICONS = {
    "tail": spiral(),
    "leaf": ['<path d="M-9 9 C-9 -3 -1 -9 9 -9 C9 1 3 9 -9 9 Z M-9 9 L3 -3"/>'],
    "branch": ['<path d="M-12 9 C-4 5 3 2 12 -4"/>',
               '<path d="M-3 5 C-6 -1 -3 -6 2 -9 C4 -4 2 1 -3 5 Z"/>',
               '<path d="M5 0 C7 -3 11 -3 13 0 C10 3 7 3 5 0 Z"/>'],
    "eye": ['<circle r="8.5"/>', '<circle r="4.5"/>', '<circle cx="1.5" cy="-1.5" r="1.5" class="f"/>'],
    "fly": ['<ellipse cy="3" rx="3" ry="5"/>', '<circle cy="-4" r="2.2"/>',
            '<ellipse cx="-5" cy="-3" rx="4.5" ry="2.5" transform="rotate(-25 -5 -3)"/>',
            '<ellipse cx="5" cy="-3" rx="4.5" ry="2.5" transform="rotate(25 5 -3)"/>',
            '<path d="M-1 -6 L-3 -9 M1 -6 L3 -9"/>'],
    "bubble": ['<path d="M-10 -7 H10 A2 2 0 0 1 12 -5 V5 A2 2 0 0 1 10 7 H-2 L-7 11 V7 H-10 '
               'A2 2 0 0 1 -12 5 V-5 A2 2 0 0 1 -10 -7 Z"/>',
               '<circle cx="-5" r="1.1" class="f"/>', '<circle r="1.1" class="f"/>',
               '<circle cx="5" r="1.1" class="f"/>'],
    "bubble-heart": ['<path d="M0 -10 C7 -10 11 -6 11 -1 C11 5 6 8 0 8 C-2 8 -4 7.6 -5 7 L-10 10 L-8.5 5 '
                     'C-10 3.5 -11 1.5 -11 -1 C-11 -6 -7 -10 0 -10 Z"/>',
                     '<path d="M0 4 C-6 0 -4.5 -5 -1.5 -4.5 C-0.5 -4.3 0 -3.5 0 -3 C0 -3.5 0.5 -4.3 1.5 -4.5 '
                     'C4.5 -5 6 0 0 4 Z"/>'],
    "bolt": ['<path d="M2 -11 L-7 2 H0 L-2 11 L7 -2 H0 Z"/>'],
    "sparkle": ['<path d="M0 -9 Q1 -1 9 0 Q1 1 0 9 Q-1 1 -9 0 Q-1 -1 0 -9 Z"/>'],
    "heart": ['<path d="M0 8 C-12 0 -9 -9 -3 -8 C-1 -7.5 0 -6 0 -5 C0 -6 1 -7.5 3 -8 C9 -9 12 0 0 8 Z"/>'],
    "ticks": ['<path d="M-11 1 L-6 6 L4 -5 M-1 4 L1 6 L11 -5"/>'],
    "envelope": ['<rect x="-10" y="-7" width="20" height="14" rx="2"/>', '<path d="M-10 -5 L0 2 L10 -5"/>'],
    "clock": ['<circle r="9"/>', '<path d="M0 -5 V0 L4 3"/>'],
    "plane": ['<path d="M11 -10 L-11 -1 L-2 2 L1 11 Z M-2 2 L11 -10"/>'],
    "cloud": ['<path d="M-7 6 H7 C11 6 12 0 8 -2 C8 -7 1 -9 -2 -5 C-6 -7 -10 -3 -8 1 C-11 2 -11 6 -7 6 Z"/>'],
    "phone": ['<rect x="-6" y="-11" width="12" height="22" rx="2.5"/>', '<path d="M-2 8 H2"/>'],
    "note": ['<path d="M-3 7 V-8 L8 -10 V5"/>', '<circle cx="-5.5" cy="7" r="2.5"/>',
             '<circle cx="5.5" cy="5" r="2.5"/>'],
    "smile": ['<circle r="9"/>', '<circle cx="-3.2" cy="-2.5" r="1.1" class="f"/>',
              '<circle cx="3.2" cy="-2.5" r="1.1" class="f"/>', '<path d="M-4.5 2 Q0 6.5 4.5 2"/>'],
    "pin": ['<path d="M0 11 C-6 4 -8 0 -8 -3 A8 8 0 0 1 8 -3 C8 0 6 4 0 11 Z"/>', '<circle cy="-3" r="3"/>'],
    "mic": ['<rect x="-3" y="-11" width="6" height="12" rx="3"/>', '<path d="M-7 -2 A7 7 0 0 0 7 -2 M0 5 V10 M-4 10 H4"/>'],
    "star": star(),
    "sun": sun(),
    "flower": flower(),
}

FILLERS = {
    "dot": ['<circle r="1.3" class="f"/>'],
    "ring": ['<circle r="2.6"/>'],
    "plus": ['<path d="M-3 0 H3 M0 -3 V3"/>'],
    "spark": ['<path d="M0 -4 Q0.5 -0.5 4 0 Q0.5 0.5 0 4 Q-0.5 0.5 -4 0 Q-0.5 -0.5 0 -4 Z"/>'],
}


def torus_dist(a, b):
    dx = abs(a[0] - b[0]); dy = abs(a[1] - b[1])
    return math.hypot(min(dx, TILE - dx), min(dy, TILE - dy))


def place(rng, placed, radius, tries=4000):
    for _ in range(tries):
        p = (rng.uniform(0, TILE), rng.uniform(0, TILE))
        if all(torus_dist(p, q) >= radius + r + 6 for q, r in placed):
            return p
    return None


def build_svg():
    rng = random.Random(SEED)
    placed, items = [], []
    names = list(ICONS)
    for i in range(400):
        name = names[i % len(names)] if i < len(names) * 3 else rng.choice(names)
        scale = rng.uniform(1.15, 1.5)
        p = place(rng, placed, 12 * scale)
        if not p:
            break
        placed.append((p, 12 * scale)); items.append((name, ICONS[name], p, scale, rng.uniform(-35, 35)))
    fillers = list(FILLERS)
    for _ in range(600):
        name = rng.choice(fillers)
        p = place(rng, placed, 4, tries=200)
        if p:
            placed.append((p, 4)); items.append((name, FILLERS[name], p, 1, rng.uniform(0, 90)))

    body = []
    for name, shapes, (x, y), scale, rot in items:
        reach = 13 * scale
        for dx in (-TILE, 0, TILE):
            for dy in (-TILE, 0, TILE):
                cx, cy = x + dx, y + dy
                if -reach < cx < TILE + reach and -reach < cy < TILE + reach:
                    body.append(f'<g transform="translate({cx:.1f} {cy:.1f}) rotate({rot:.0f}) scale({scale:.2f})">'
                                + "".join(shapes) + "</g>")
    style = ("g{fill:none;stroke:#000;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}"
             "path,circle,ellipse,rect{vector-effect:non-scaling-stroke}.f{fill:#000;stroke:none}")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{TILE}" height="{TILE}" viewBox="0 0 {TILE} {TILE}">'
            f"<style>{style}</style>" + "".join(body) + "</svg>\n")


def find_browser():
    for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
        if Path(p).exists():
            return p
    return shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("msedge")


def render_png(svg_path, png_path):
    browser = find_browser()
    if not browser:
        raise SystemExit("Chrome or Edge is needed to render the PNG")
    with tempfile.TemporaryDirectory() as tmp:
        html = Path(tmp) / "tile.html"
        html.write_text(f'<html><body style="margin:0;background:transparent">'
                        f'<img src="{svg_path.as_uri()}" width="{TILE * 2}" height="{TILE * 2}"></body></html>')
        subprocess.run([browser, "--headless", "--disable-gpu", "--hide-scrollbars",
                        "--default-background-color=00000000", f"--window-size={TILE * 2},{TILE * 2}",
                        f"--user-data-dir={tmp}", f"--screenshot={png_path}", html.as_uri()],
                       check=True, capture_output=True)


if __name__ == "__main__":
    svg = OUT / "chat-wallpaper.svg"
    svg.write_text(build_svg(), encoding="utf-8")
    render_png(svg, OUT / "chat-wallpaper.png")
    print(f"wrote {svg} and chat-wallpaper.png")
