#!/usr/bin/env python3
"""Favicon via ComfyUI: golden auction gavel striking, auction/gambling style.

1. Generate candidates (dreamshaper_8 + RPG-Icons LoRA, 512x512):
   D:/ComfyUI/python_embeded/python.exe favicon_icon.py gen --count 4

2. Pick the best candidate from images/favicons/candidates_preview.png, then
   normalize background, round the corners and write the favicon set
   (favicon.ico + png sizes + apple-touch-icon) into apps/web/public:

   D:/ComfyUI/python_embeded/python.exe favicon_icon.py finalize images/favicons/candidate_1.png
"""

import argparse
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw

import generate
import icons

PROMPT = (
    "game item icon of a golden auction gavel hammer striking down, "
    "spark burst on impact, dynamic motion lines, centered, "
    "dark navy background, handpainted rpg style, high detail"
)

WEB_PUBLIC = Path(__file__).resolve().parent.parent / "web" / "public"

# единый тёмно-синий фон (близко к фону приложения #020617)
TARGET_BG = (8, 12, 26)


def cmd_gen(args):
    out_dir = Path(args.out) if args.out else Path(__file__).resolve().parent / "images" / "favicons"
    out_dir.mkdir(parents=True, exist_ok=True)
    lora_name, lora_strength = args.lora.rsplit(":", 1)
    base = SimpleNamespace(
        model=args.model,
        width=512,
        height=512,
        prompt=PROMPT,
        negative=generate.DEFAULT_NEGATIVE + ", frame, border, text, watermark, letters, clock, hands",
        steps=args.steps,
        cfg=7.0,
        sampler="euler",
        scheduler="normal",
        denoise=1.0,
        prefix="fav",
    )
    saved = []
    for i in range(args.count):
        seed = args.seed + i
        print("candidate %d (seed %d)" % (i, seed), flush=True)
        workflow = generate.build_workflow(base, seed, [(lora_name, float(lora_strength))])
        img = generate.submit_and_collect(args.server, workflow, 600)
        raw = icons.fetch_image_bytes(args.server, img)
        dest = out_dir / ("candidate_%d.png" % i)
        dest.write_bytes(raw)
        saved.append(dest)
        print("  saved %s" % dest, flush=True)
    preview = out_dir / "candidates_preview.png"
    icons.make_preview(saved, preview, cell=256)
    print("preview: %s" % preview)
    return 0


def rounded_alpha(size, radius):
    """RGBA-альфа: скруглённый квадрат на прозрачном фоне."""
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def cmd_finalize(args):
    src = Path(args.src)
    if not src.exists():
        print("ERROR: не найден %s" % src, file=sys.stderr)
        return 2
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)

    im = Image.open(src).convert("RGB")
    icons.normalize_background(im, TARGET_BG, keep_frac=0.52)
    base = im.resize((512, 512), Image.LANCZOS).convert("RGBA")

    def save_size(size, radius, name):
        out = base.resize((size, size), Image.LANCZOS)
        if radius > 0:
            out.putalpha(rounded_alpha(size, radius))
        out.save(WEB_PUBLIC / name)
        print("  %s (%dx%d)" % (name, size, size))

    save_size(256, 56, "favicon-256.png")
    save_size(32, 7, "favicon-32x32.png")
    save_size(16, 4, "favicon-16x16.png")
    # apple-touch: полный квадрат, iOS скругляет сам
    save_size(180, 0, "apple-touch-icon.png")
    # многоразмерный ICO (16/32/48 — BMP, 256 — PNG внутри ICO)
    base.save(WEB_PUBLIC / "favicon.ico", format="ICO",
              sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
    print("  favicon.ico (16/32/48/256)")
    print("favicon set -> %s" % WEB_PUBLIC)
    return 0


def main():
    p = argparse.ArgumentParser(description="Auction gavel favicon via ComfyUI")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("gen", help="сгенерировать кандидатов")
    g.add_argument("--server", default="http://127.0.0.1:8188")
    g.add_argument("--model", default="dreamshaper_8.safetensors")
    g.add_argument("--lora", default="RPG-Icons-bf16-pruned-128ND.safetensors:0.6")
    g.add_argument("--seed", type=int, default=8801)
    g.add_argument("--count", type=int, default=4)
    g.add_argument("--steps", type=int, default=22)
    g.add_argument("--out", default=None)
    g.set_defaults(fn=cmd_gen)

    f = sub.add_parser("finalize", help="собрать favicon-набор из выбранного кандидата")
    f.add_argument("src", help="путь к PNG-кандидату")
    f.set_defaults(fn=cmd_finalize)

    args = p.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
