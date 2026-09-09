#!/usr/bin/env python3
"""Batch game icon generator with consistent background.

How it works:
1. Fixed seed + prompt template (only the item word changes) -> SD keeps the same
   composition, so backgrounds come out nearly identical.
2. Post-normalization: pixels outside the central area are blended toward one
   target background color (sampled from the first icon corners), making the
   background uniform across the whole set.
3. Result is resized to 64x64 (LANCZOS) and saved as PNG.

Requires PIL -> run with ComfyUI embedded python:
  D:/ComfyUI/python_embeded/python.exe icons.py --items "sword,potion,shield"

Run with system python if Pillow is installed there too.
"""

import argparse
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from urllib import request, parse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image

import generate

DEFAULT_TEMPLATE = "game item icon of {item}, centered, dark blurred background, handpainted rpg style, high detail"


def fetch_image_bytes(server, img):
    q = parse.urlencode({"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": "output"})
    return generate.http_bytes(server, "/view?" + q)


def corner_bg(img, patch=8):
    w, h = img.size
    px = img.load()
    patches = [
        (0, 0, patch, patch),
        (w - patch, 0, w, patch),
        (0, h - patch, patch, h),
        (w - patch, h - patch, w, h),
    ]
    rs = gs = bs = n = 0
    for x0, y0, x1, y1 in patches:
        for y in range(y0, y1):
            for x in range(x0, x1):
                r, g, b = px[x, y][:3]
                rs += r; gs += g; bs += b; n += 1
    return (rs // n, gs // n, bs // n)


def normalize_background(img, target, keep_frac=0.55):
    w, h = img.size
    px = img.load()
    cx, cy = w / 2.0, h / 2.0
    max_r = min(w, h) / 2.0
    keep_r = max_r * keep_frac
    tr, tg, tb = target
    for y in range(h):
        for x in range(w):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d <= keep_r:
                continue
            t = min(1.0, (d - keep_r) / (max_r - keep_r)) ** 1.5
            r, g, b = px[x, y][:3]
            px[x, y] = (int(r + (tr - r) * t), int(g + (tg - g) * t), int(b + (tb - b) * t))
    return img


def make_preview(icons, dest, cell=192, gap=16):
    n = len(icons)
    cols = min(4, n)
    rows = (n + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell + (cols + 1) * gap, rows * cell + (rows + 1) * gap), (18, 18, 22))
    for i, path in enumerate(icons):
        im = Image.open(path).convert("RGB").resize((cell, cell), Image.NEAREST)
        r, c = divmod(i, cols)
        sheet.paste(im, (gap + c * (cell + gap), gap + r * (cell + gap)))
    sheet.save(dest)


def main(argv=None):
    p = argparse.ArgumentParser(description="Generate a set of 64x64 item icons with uniform background")
    p.add_argument("--items", required=True, help="comma-separated item names, e.g. sword,potion,shield")
    p.add_argument("--template", default=DEFAULT_TEMPLATE, help="prompt template with {item} placeholder")
    p.add_argument("--model", default="dreamshaper_8.safetensors", help="checkpoint name")
    p.add_argument("--lora", action="append", default=[], metavar="NAME:STRENGTH", help="LoRA (repeatable)")
    p.add_argument("--negative", default=generate.DEFAULT_NEGATIVE + ", frame, border, text, watermark", help="negative prompt")
    p.add_argument("--gen-size", type=int, default=512, help="generation resolution (square, default 512)")
    p.add_argument("--steps", type=int, default=22, help="sampling steps")
    p.add_argument("--cfg", type=float, default=7.0, help="CFG scale")
    p.add_argument("--seed", type=int, default=4242, help="fixed seed for the whole set (consistency!)")
    p.add_argument("--keep-frac", type=float, default=0.55, help="fraction of radius kept untouched by bg normalization")
    p.add_argument("--bg-color", default=None, help="target bg RGB as r,g,b; default: sampled from first icon corners")
    p.add_argument("--out", default=None, help="output dir (default: ./images/icons)")
    p.add_argument("--server", default="http://127.0.0.1:8188", help="ComfyUI base URL")
    args = p.parse_args(argv)

    items = [s.strip() for s in args.items.split(",") if s.strip()]
    if not items:
        print("ERROR: --items is empty", file=sys.stderr)
        return 2

    loras = []
    available = generate.list_loras(args.server)
    for spec in args.lora:
        parts = spec.rsplit(":", 1)
        name = parts[0]
        strength = float(parts[1]) if len(parts) == 2 else 0.8
        if name not in available:
            print("ERROR: lora not found: " + name, file=sys.stderr)
            return 2
        loras.append((name, strength))

    out_dir = Path(args.out) if args.out else Path(__file__).resolve().parent / "images" / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)

    base = SimpleNamespace(
        model=args.model, width=args.gen_size, height=args.gen_size,
        negative=args.negative, steps=args.steps, cfg=args.cfg,
        sampler="euler", scheduler="normal", denoise=1.0, prefix="icon",
    )

    target_bg = None
    if args.bg_color:
        target_bg = tuple(int(v) for v in args.bg_color.split(","))
        if len(target_bg) != 3:
            print("ERROR: --bg-color must be r,g,b", file=sys.stderr)
            return 2

    saved = []
    for i, item in enumerate(items):
        base.prompt = args.template.format(item=item)
        print("item: %s (seed %d)" % (item, args.seed), flush=True)
        workflow = generate.build_workflow(base, args.seed, loras)
        img = generate.submit_and_collect(args.server, workflow, 600)
        raw = fetch_image_bytes(args.server, img)

        tmp = out_dir / ("raw_" + item.replace(" ", "_") + ".png")
        tmp.write_bytes(raw)
        im = Image.open(tmp).convert("RGB")

        before = corner_bg(im)
        if target_bg is None:
            target_bg = before
            print("target bg sampled from first icon:", target_bg)
        normalize_background(im, target_bg, args.keep_frac)
        after = corner_bg(im)

        im = im.resize((64, 64), Image.LANCZOS)
        dest = out_dir / ("icon_" + item.replace(" ", "_") + ".png")
        im.save(dest)
        tmp.unlink()
        saved.append(dest)
        print("  saved %s | corner bg before=%s after=%s" % (dest.name, before, after), flush=True)

    preview = out_dir / "icons_preview.png"
    make_preview(saved, preview)
    print("preview: %s" % preview)
    print("done: %d icons, uniform bg target=%s" % (len(saved), target_bg))
    return 0


if __name__ == "__main__":
    sys.exit(main())
