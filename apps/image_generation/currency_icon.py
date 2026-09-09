#!/usr/bin/env python3
"""Pick the best currency icon candidate by heuristic and produce a 32x32 final.

Scoring: gold-pixel coverage inside the bounding box (solid coin), how round the
mask's bounding box is, how centered the coin is. The winner is re-cropped around
the coin centroid and downscaled to 32x32 (LANCZOS).
"""
import glob
import math
import os
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
CAND_DIR = HERE / "images" / "currency"
OUT = Path(r"D:\projects\auctioneer\apps\web\src\assets\currency.png")


def is_gold(r, g, b):
    # warm bright yellow/orange, red dominant, clearly separated from dark bg
    return r > 120 and g > 90 and b < 110 and r > b + 40 and g > b + 20


def mask_and_stats(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            if is_gold(*px[x, y][:3]):
                xs.append(x)
                ys.append(y)
    if not xs:
        return im, None
    n = len(xs)
    cx, cy = sum(xs) / n, sum(ys) / n
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    bw, bh = maxx - minx + 1, maxy - miny + 1
    cov = n / (bw * bh)          # how solid the coin disc is
    ratio = bw / bh              # roundness
    off = math.hypot(cx - w / 2, cy - h / 2) / (w / 2)  # 0 = centered
    score = cov * 100 - abs(math.log(ratio)) * 30 - off * 40
    return im, dict(n=n, cx=cx, cy=cy, bw=bw, bh=bh, cov=round(cov, 3),
                    ratio=round(ratio, 3), off=round(off, 3), score=round(score, 2))


def main():
    cands = sorted(glob.glob(str(CAND_DIR / "currency_*.png")))
    if not cands:
        print("ERROR: no candidates", file=sys.stderr)
        return 2
    best = None
    for c in cands:
        im, s = mask_and_stats(c)
        print(os.path.basename(c), s, flush=True)
        if s and (best is None or s["score"] > best[1]["score"]):
            best = (im, s, c)
    if not best:
        print("ERROR: no gold pixels anywhere", file=sys.stderr)
        return 2
    im, s, src = best
    # crop a square window around the coin centroid: diameter * 1.28 gives a thin rim
    half = max(s["bw"], s["bh"]) / 2.0 * 1.28
    x0 = max(0, int(round(s["cx"] - half)))
    y0 = max(0, int(round(s["cy"] - half)))
    x1 = min(im.size[0], int(round(s["cx"] + half)))
    y1 = min(im.size[1], int(round(s["cy"] + half)))
    box_w = min(x1 - x0, y1 - y0)
    # keep it square and inside bounds
    if x0 + box_w > im.size[0]:
        x0 = im.size[0] - box_w
    if y0 + box_w > im.size[1]:
        y0 = im.size[1] - box_w
    crop = im.crop((x0, y0, x0 + box_w, y0 + box_w))
    final = crop.resize((32, 32), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    final.save(OUT)
    print("winner:", os.path.basename(src), "crop:", (x0, y0, x0 + box_w, y0 + box_w))
    print("saved 32x32:", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
