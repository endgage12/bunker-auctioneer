#!/usr/bin/env python3
"""Generate 64x64 icons for every catalog item (auctioneer game).

Fixed seed + prompt template -> uniform composition; radial background
normalization -> identical dark background across the set. Output files
are named by catalog defId (white-0.png, red-7.png, ...).

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

# defId -> English phrase for the prompt (catalog from packages/shared/src/items.ts)
CATALOG = [
    ("white-0", "dusty porcelain vase"),
    ("white-1", "plaster figurine"),
    ("white-2", "tin mug"),
    ("white-3", "wooden comb"),
    ("white-4", "glass orb"),
    ("white-5", "paper fan"),
    ("white-6", "brass button"),
    ("white-7", "ceramic pot"),
    ("white-8", "worn deck of playing cards"),
    ("green-0", "carved wooden box"),
    ("green-1", "bronze hand mirror"),
    ("green-2", "silk scarf"),
    ("green-3", "jade bracelet"),
    ("green-4", "porcelain cup"),
    ("green-5", "copper teapot"),
    ("green-6", "amber bead"),
    ("green-7", "landscape painting scroll"),
    ("green-8", "set of engraving chisels"),
    ("green-9", "compact hunting crossbow"),
    ("blue-0", "silver brooch"),
    ("blue-1", "lacquered casket"),
    ("blue-2", "emerald pendant"),
    ("blue-3", "antique brass compass"),
    ("blue-4", "tapestry with a griffin"),
    ("blue-5", "sapphire ring"),
    ("blue-6", "engraved dagger"),
    ("blue-7", "gilded candelabra"),
    ("blue-8", "ancient map of unknown lands"),
    ("blue-9", "narrow dagger with icy blade"),
    ("blue-10", "harpoon of the sea serpent"),
    ("purple-0", "moonlight amulet"),
    ("purple-1", "starsteel sword"),
    ("purple-2", "rock crystal crown"),
    ("purple-3", "scroll of ancient spells"),
    ("purple-4", "magical cuckoo clock"),
    ("purple-5", "rod of illusions"),
    ("purple-6", "mist knight armor"),
    ("purple-7", "pandora box"),
    ("purple-8", "fortune teller crystal ball"),
    ("purple-9", "storm petrel spear"),
    ("purple-10", "magic flying carpet"),
    ("yellow-0", "perfect amber sphere"),
    ("yellow-1", "citrine gem earrings"),
    ("yellow-2", "sunstone pendant"),
    ("yellow-3", "gilded folding fan"),
    ("yellow-4", "canary yellow diamond"),
    ("yellow-5", "scroll with glowing solar runes"),
    ("yellow-6", "jug of amber honey"),
    ("yellow-7", "imperial topaz gem"),
    ("yellow-8", "sunbeam tiara"),
    ("gold-0", "goblet of eternal feast"),
    ("gold-1", "sunset tiara"),
    ("gold-2", "sea god relic"),
    ("gold-3", "thunderer scepter"),
    ("gold-4", "mirror of truth"),
    ("gold-5", "key to the abyss gates"),
    ("gold-6", "polar star diadem"),
    ("gold-7", "golden griffon statue"),
    ("gold-8", "anchor named Hope"),
    ("gold-9", "royal guard halberd"),
    ("red-0", "glowing dragon heart"),
    ("red-1", "fallen king crown"),
    ("red-2", "all-seeing eye"),
    ("red-3", "seal of primal elements"),
    ("red-4", "blade of fate"),
    ("red-5", "grail of dawn"),
    ("red-6", "invisible emperor cloak"),
    ("red-7", "core of eternity"),
]

TEMPLATE = "game item icon of {item}, centered, dark blurred background, handpainted rpg style, high detail"


def main():
    p = argparse.ArgumentParser(description="Generate catalog item icons")
    p.add_argument("--server", default="http://127.0.0.1:8188")
    p.add_argument("--model", default="dreamshaper_8.safetensors")
    p.add_argument("--lora", default="RPG-Icons-bf16-pruned-128ND.safetensors:0.6")
    p.add_argument("--seed", type=int, default=4242)
    p.add_argument("--gen-size", type=int, default=512)
    p.add_argument("--steps", type=int, default=20)
    p.add_argument("--bg-color", default="20,20,24")
    p.add_argument("--keep-frac", type=float, default=0.55)
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

    base = SimpleNamespace(
        model=args.model, width=args.gen_size, height=args.gen_size,
        negative=generate.DEFAULT_NEGATIVE + ", frame, border, text, watermark",
        steps=args.steps, cfg=7.0, sampler="euler", scheduler="normal",
        denoise=1.0, prefix="cat",
    )

    out_dir = Path(args.out) if args.out else Path(__file__).resolve().parent / "images" / "catalog"
    out_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    for def_id, phrase in CATALOG:
        if only_prefixes and not any(def_id.startswith(pre) for pre in only_prefixes):
            continue
        base.prompt = TEMPLATE.format(item=phrase)
        print("gen: " + def_id + " | " + phrase, flush=True)
        workflow = generate.build_workflow(base, args.seed, loras)
        img = generate.submit_and_collect(args.server, workflow, 600)
        raw = icons.fetch_image_bytes(args.server, img)
        tmp = out_dir / "_tmp.png"
        tmp.write_bytes(raw)
        im = Image.open(tmp).convert("RGB")
        icons.normalize_background(im, target_bg, args.keep_frac)
        im = im.resize((64, 64), Image.LANCZOS)
        dest = out_dir / (def_id + ".png")
        im.save(dest)
        tmp.unlink()
        saved.append(dest)

    preview_name = "catalog_preview.png" if not only_prefixes else "catalog_preview_" + "_".join(only_prefixes) + ".png"
    icons.make_preview(saved, out_dir / preview_name, cell=96)
    print("done: %d icons in %s" % (len(saved), out_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
