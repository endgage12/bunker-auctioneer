import os, sys, time, urllib.request

JOBS = [
    ("https://civitai.com/api/download/models/123588",
     "D:/ComfyUI/ComfyUI/models/loras/bg3_items_offset.safetensors"),
    ("https://huggingface.co/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors",
     "D:/ComfyUI/ComfyUI/models/checkpoints/dreamshaper_8.vae.safetensors"),
]

for url, dest in JOBS:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print("downloading:", os.path.basename(dest), flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "dsh-installer"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        total, last = 0, 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            total += len(chunk)
            if total - last >= 100 * (1 << 20):
                last = total
                print("  " + str(total // (1 << 20)) + " MB", flush=True)
    print("done " + os.path.basename(dest) + " bytes=" + str(total) + " sec=" + str(int(time.time() - t0)), flush=True)
print("ALL DONE", flush=True)
