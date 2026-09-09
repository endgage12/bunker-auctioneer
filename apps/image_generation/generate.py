#!/usr/bin/env python3
"""Universal ComfyUI text-to-image generator via HTTP API.

Stdlib only (Python 3.10+). Requires a running ComfyUI server (default http://127.0.0.1:8188).

Examples:
  python generate.py --prompt "a yellow parrot on a branch"
  python generate.py --prompt "cyberpunk city" --width 896 --height 1152 --steps 30
  python generate.py --prompt "still life" --count 4 --seed 100
  python generate.py --list-models
"""

import argparse
import json
import random
import sys
import time
import uuid
from pathlib import Path
from urllib import request, parse, error

DEFAULT_NEGATIVE = "blurry, low quality, deformed, watermark, text, jpeg artifacts"

SAMPLERS = [
    "euler", "euler_cfg_pp", "euler_ancestral", "heun", "heunpp2", "dpm_2",
    "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral",
    "dpmpp_sde", "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu",
    "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddim", "uni_pc", "uni_pc_bh2", "res_multistep",
]

SCHEDULERS = ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta", "linear_quadratic", "kl_optimal"]


def http_json(server, path, payload=None, timeout=60):
    url = server.rstrip("/") + path
    if payload is None:
        with request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode())
    data = json.dumps(payload).encode()
    req = request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def http_bytes(server, path, timeout=120):
    with request.urlopen(server.rstrip("/") + path, timeout=timeout) as r:
        return r.read()


def list_checkpoints(server):
    info = http_json(server, "/object_info/CheckpointLoaderSimple")
    return list(info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0])


def list_loras(server):
    info = http_json(server, "/object_info/LoraLoader")
    return list(info["LoraLoader"]["input"]["required"]["lora_name"][0])


def build_workflow(args, seed, loras):
    graph = {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": args.model}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": args.width, "height": args.height, "batch_size": 1}},
    }
    model_src, clip_src = ["4", 0], ["4", 1]
    for i, (name, strength) in enumerate(loras):
        node_id = str(10 + i)
        graph[node_id] = {"class_type": "LoraLoader", "inputs": {
            "model": model_src, "clip": clip_src, "lora_name": name,
            "strength_model": strength, "strength_clip": strength,
        }}
        model_src, clip_src = [node_id, 0], [node_id, 1]
    graph["6"] = {"class_type": "CLIPTextEncode", "inputs": {"text": args.prompt, "clip": clip_src}}
    graph["7"] = {"class_type": "CLIPTextEncode", "inputs": {"text": args.negative, "clip": clip_src}}
    graph["3"] = {"class_type": "KSampler", "inputs": {
        "model": model_src, "positive": ["6", 0], "negative": ["7", 0],
        "latent_image": ["5", 0], "seed": seed, "steps": args.steps, "cfg": args.cfg,
        "sampler_name": args.sampler, "scheduler": args.scheduler, "denoise": args.denoise,
    }}
    graph["8"] = {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}}
    graph["9"] = {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": args.prefix}}
    return graph


def submit_and_collect(server, workflow, timeout):
    client_id = "gen-" + uuid.uuid4().hex[:8]
    resp = http_json(server, "/prompt", {"prompt": workflow, "client_id": client_id})
    pid = resp.get("prompt_id")
    if not pid:
        raise RuntimeError("server rejected prompt: " + json.dumps(resp)[:500])

    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(3)
        entry = http_json(server, "/history/" + pid).get(pid)
        if not entry:
            continue
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            msgs = status.get("messages", [])
            raise RuntimeError("generation failed: " + "; ".join(msgs[:3]))
        outputs = entry.get("outputs", {})
        if outputs and outputs.get("9", {}).get("images"):
            return outputs["9"]["images"][0]
    raise TimeoutError("no result within %d s" % timeout)


def save_image(server, img, out_dir, seed):
    q = parse.urlencode({"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": "output"})
    data = http_bytes(server, "/view?" + q)
    name = img["filename"] or "img_%d.png" % seed
    dest = Path(out_dir) / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return dest


def main(argv=None):
    p = argparse.ArgumentParser(description="Generate images with a local ComfyUI server")
    p.add_argument("--server", default="http://127.0.0.1:8188", help="ComfyUI base URL")
    p.add_argument("--prompt", default=None, help="positive prompt (required unless --list-models)")
    p.add_argument("--negative", default=DEFAULT_NEGATIVE, help="negative prompt")
    p.add_argument("--model", default=None, help="checkpoint name; default: first available")
    p.add_argument("--lora", action="append", default=[], metavar="NAME:STRENGTH",
                   help="apply a LoRA (repeatable); strength defaults to 0.8")
    p.add_argument("--width", type=int, default=1024, help="image width (default 1024)")
    p.add_argument("--height", type=int, default=1024, help="image height (default 1024)")
    p.add_argument("--steps", type=int, default=20, help="sampling steps (default 20)")
    p.add_argument("--cfg", type=float, default=7.0, help="CFG scale (default 7.0)")
    p.add_argument("--sampler", default="euler", choices=SAMPLERS, help="sampler (default euler)")
    p.add_argument("--scheduler", default="normal", choices=SCHEDULERS, help="scheduler (default normal)")
    p.add_argument("--denoise", type=float, default=1.0, help="denoise strength (default 1.0)")
    p.add_argument("--seed", type=int, default=None, help="seed; default: random")
    p.add_argument("--count", type=int, default=1, help="how many images to generate (default 1)")
    p.add_argument("--out", default=None, help="output directory (default: ./images next to this script)")
    p.add_argument("--prefix", default="gen", help="SaveImage filename prefix (default: gen)")
    p.add_argument("--timeout", type=int, default=600, help="per-image timeout seconds (default 600)")
    p.add_argument("--list-models", action="store_true", help="list available checkpoints and exit")
    args = p.parse_args(argv)

    try:
        if args.list_models:
            print("Checkpoints:")
            for name in list_checkpoints(args.server):
                print("  - " + name)
            print("LoRAs:")
            for name in list_loras(args.server):
                print("  - " + name)
            return 0

        checkpoints = list_checkpoints(args.server)
        if not checkpoints:
            print("ERROR: no checkpoints found on the server", file=sys.stderr)
            return 2
        if args.model is None:
            args.model = checkpoints[0]
            print("model: %s (auto)" % args.model)
        elif args.model not in checkpoints:
            print("ERROR: model not found: " + args.model + ". Available:", file=sys.stderr)
            for name in checkpoints:
                print("  - " + name, file=sys.stderr)
            return 2

        loras = []
        available_loras = list_loras(args.server)
        for spec in args.lora:
            parts = spec.rsplit(":", 1)
            name = parts[0]
            strength = float(parts[1]) if len(parts) == 2 else 0.8
            if name not in available_loras:
                print("ERROR: lora not found: " + name + ". Available:", file=sys.stderr)
                for item in available_loras:
                    print("  - " + item, file=sys.stderr)
                return 2
            loras.append((name, strength))
            print("lora: %s @ %.2f" % (name, strength))

        if not args.prompt:
            print("ERROR: --prompt is required", file=sys.stderr)
            return 2

        out_dir = Path(args.out) if args.out else Path(__file__).resolve().parent / "images"
        out_dir.mkdir(parents=True, exist_ok=True)

        results = []
        for i in range(args.count):
            seed = args.seed + i if args.seed is not None else random.randint(0, 2147483647)
            t0 = time.time()
            workflow = build_workflow(args, seed, loras)
            img = submit_and_collect(args.server, workflow, args.timeout)
            dest = save_image(args.server, img, out_dir, seed)
            results.append({"seed": seed, "file": str(dest), "seconds": round(time.time() - t0, 1)})
            print(json.dumps(results[-1]))

        print("saved %d image(s) to %s" % (len(results), out_dir))
        return 0

    except (error.URLError, TimeoutError, RuntimeError) as exc:
        print("ERROR:", exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
