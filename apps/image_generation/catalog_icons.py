#!/usr/bin/env python3
"""Generate item icons for every catalog item (auctioneer game), sized to the item.

Each inventory cell is 64px, so the icon matches the item's footprint:
a 1x3 item gets a 64x192 icon, a 3x1 item a 192x64 icon, etc.
ComfyUI renders at the item's aspect ratio (max side = --gen-size), the
background is normalized to one dark color and the result is resized to
w*64 x h*64. Output files are named by catalog defId (white-0.png ... red-7.png).

Run with ComfyUI embedded python (has Pillow):
  D:/ComfyUI/python_embeded/python.exe catalog_icons.py
"""

import argparse
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image

import generate
import icons

# defId -> (English phrase for the prompt, w, h) — catalog from packages/shared/src/items.ts
CATALOG = [
    ("white-0", "dusty porcelain vase", 1, 2),
    ("white-1", "plaster figurine", 1, 2),
    ("white-2", "tin mug", 1, 1),
    ("white-3", "wooden comb", 1, 2),
    ("white-4", "glass orb", 1, 1),
    ("white-5", "paper fan", 1, 2),
    ("white-6", "brass button", 2, 2),
    ("white-7", "ceramic pot", 2, 2),
    ("white-8", "worn deck of playing cards", 1, 2),
    ("green-0", "carved wooden box", 2, 2),
    ("green-1", "bronze hand mirror", 1, 2),
    ("green-2", "silk scarf", 1, 2),
    ("green-3", "jade bracelet", 1, 1),
    ("green-4", "porcelain cup", 1, 1),
    ("green-5", "copper teapot", 2, 2),
    ("green-6", "amber bead", 1, 1),
    ("green-7", "landscape painting scroll", 1, 3),
    ("green-8", "set of engraving chisels", 2, 3),
    ("green-9", "compact hunting crossbow", 2, 1),
    ("blue-0", "silver brooch", 1, 1),
    ("blue-1", "lacquered casket", 2, 2),
    ("blue-2", "emerald pendant", 1, 1),
    ("blue-3", "antique brass compass", 1, 2),
    ("blue-4", "tapestry with a griffin", 3, 3),
    ("blue-5", "sapphire ring", 1, 1),
    ("blue-6", "engraved dagger", 1, 3),
    ("blue-7", "gilded candelabra", 1, 2),
    ("blue-8", "ancient map of unknown lands", 2, 2),
    ("blue-9", "narrow dagger with icy blade", 2, 1),
    ("blue-10", "harpoon of the sea serpent", 3, 1),
    ("purple-0", "moonlight amulet", 1, 1),
    ("purple-1", "starsteel sword", 1, 4),
    ("purple-2", "rock crystal crown", 2, 2),
    ("purple-3", "scroll of ancient spells", 1, 3),
    ("purple-4", "magical cuckoo clock", 2, 2),
    ("purple-5", "rod of illusions", 1, 3),
    ("purple-6", "mist knight armor", 2, 3),
    ("purple-7", "pandora box", 2, 2),
    ("purple-8", "fortune teller crystal ball", 1, 1),
    ("purple-9", "storm petrel spear", 3, 1),
    ("purple-10", "magic flying carpet", 3, 2),
    ("yellow-0", "perfect amber sphere", 2, 3),
    ("yellow-1", "citrine gem earrings", 1, 1),
    ("yellow-2", "sunstone pendant", 1, 1),
    ("yellow-3", "gilded folding fan", 1, 2),
    ("yellow-4", "canary yellow diamond", 2, 3),
    ("yellow-5", "scroll with glowing solar runes", 1, 2),
    ("yellow-6", "jug of amber honey", 2, 2),
    ("yellow-7", "imperial topaz gem", 1, 1),
    ("yellow-8", "sunbeam tiara", 1, 2),
    ("gold-0", "goblet of eternal feast", 1, 2),
    ("gold-1", "sunset tiara", 1, 2),
    ("gold-2", "sea god relic", 1, 2),
    ("gold-3", "thunderer scepter", 1, 3),
    ("gold-4", "mirror of truth", 1, 3),
    ("gold-5", "key to the abyss gates", 1, 2),
    ("gold-6", "polar star diadem", 1, 2),
    ("gold-7", "golden griffon statue", 2, 2),
    ("gold-8", "anchor named Hope", 2, 3),
    ("gold-9", "royal guard halberd", 4, 1),
    ("red-0", "glowing dragon heart", 2, 2),
    ("red-1", "fallen king crown", 2, 2),
    ("red-2", "all-seeing eye", 1, 1),
    ("red-3", "seal of primal elements", 1, 1),
    ("red-4", "blade of fate", 1, 4),
    ("red-5", "grail of dawn", 1, 2),
    ("red-6", "invisible emperor cloak", 2, 3),
    ("red-7", "core of eternity", 1, 1),
]

CELL = 64
TEMPLATE = "game item icon of {item}, centered, dark blurred background, handpainted rpg style, high detail"


def gen_size(w, h, max_side):
    """Размер генерации: пропорции предмета, длинная сторона = max_side (кратно 8)."""
    unit = max_side / max(w, h)
    gw = max(8, round((w * unit) / 8) * 8)
    gh = max(8, round((h * unit) / 8) * 8)
    return gw, gh


def normalize_background_ellipse(img, target, keep_frac=0.6):
    """Фон к единому цвету по эллипсу, повторяющему пропорции картинки —
    длинные предметы (жезл 1x3, алебарда 4x1) не теряют края."""
    w, h = img.size
    px = img.load()
    cx, cy = w / 2.0, h / 2.0
    tr, tg, tb = target
    for y in range(h):
        for x in range(w):
            d = max(abs(x - cx) / cx, abs(y - cy) / cy)
            if d <= keep_frac:
                continue
            t = min(1.0, (d - keep_frac) / (1.0 - keep_frac)) ** 1.5
            r, g, b = px[x, y][:3]
            px[x, y] = (int(r + (tr - r) * t), int(g + (tg - g) * t), int(b + (tb - b) * t))
    return img


def make_preview_aspect(icons, dest, cell=96, gap=16):
    """Лист-превью: иконки в квадратных ячейках с сохранением пропорций."""
    n = len(icons)
    cols = min(6, n)
    rows = (n + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell + (cols + 1) * gap, rows * cell + (rows + 1) * gap), (18, 18, 22))
    for i, path in enumerate(icons):
        im = Image.open(path).convert("RGB")
        im.thumbnail((cell - 8, cell - 8), Image.LANCZOS)
        r, c = divmod(i, cols)
        x = gap + c * (cell + gap) + (cell - im.width) // 2
        y = gap + r * (cell + gap) + (cell - im.height) // 2
        sheet.paste(im, (x, y))
    sheet.save(dest)


def main():
    p = argparse.ArgumentParser(description="Generate catalog item icons sized to the item")
    p.add_argument("--server", default="http://127.0.0.1:8188")
    p.add_argument("--model", default="dreamshaper_8.safetensors")
    p.add_argument("--lora", default="RPG-Icons-bf16-pruned-128ND.safetensors:0.6")
    p.add_argument("--seed", type=int, default=4242)
    p.add_argument("--gen-size", type=int, default=512, help="длинная сторона при генерации")
    p.add_argument("--steps", type=int, default=20)
    p.add_argument("--bg-color", default="20,20,24")
    p.add_argument("--keep-frac", type=float, default=0.6)
    p.add_argument("--out", default=None)
    p.add_argument("--only", default=None, help="comma-separated defId prefixes to limit generation (e.g. yellow-)")
    args = p.parse_args()

    only_prefixes = [s.strip() for s in (args.only or "").split(",") if s.strip()]

    lora_name, lora_strength = args.lora.rsplit(":", 1)
    loras = [(lora_name, float(lora_strength))]
    target_bg = tuple(int(v) for v in args.bg_color.split(","))
    if len(target_bg) != 3:
        print("ERROR: --bg-color must be r,g,b", file=sys.stderr)
        return 2

    out_dir = Path(args.out) if args.out else Path(__file__).resolve().parent / "images" / "catalog"
    out_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    for def_id, phrase, w, h in CATALOG:
        if only_prefixes and not any(def_id.startswith(pre) for pre in only_prefixes):
            continue
        gw, gh = gen_size(w, h, args.gen_size)
        base = SimpleNamespace(
            model=args.model, width=gw, height=gh,
            negative=generate.DEFAULT_NEGATIVE + ", frame, border, text, watermark",
            steps=args.steps, cfg=7.0, sampler="euler", scheduler="normal",
            denoise=1.0, prefix="cat",
        )
        base.prompt = TEMPLATE.format(item=phrase)
        print("gen: %s | %s | %dx%d cells -> %dx%d px" % (def_id, phrase, w, h, w * CELL, h * CELL), flush=True)
        workflow = generate.build_workflow(base, args.seed, loras)
        img = generate.submit_and_collect(args.server, workflow, 600)
        raw = icons.fetch_image_bytes(args.server, img)
        tmp = out_dir / "_tmp.png"
        tmp.write_bytes(raw)
        im = Image.open(tmp).convert("RGB")
        normalize_background_ellipse(im, target_bg, args.keep_frac)
        im = im.resize((w * CELL, h * CELL), Image.LANCZOS)
        dest = out_dir / (def_id + ".png")
        im.save(dest)
        tmp.unlink()
        saved.append(dest)

    preview_name = "catalog_preview.png" if not only_prefixes else "catalog_preview_" + "_".join(only_prefixes) + ".png"
    make_preview_aspect(saved, out_dir / preview_name)
    print("done: %d icons in %s" % (len(saved), out_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
