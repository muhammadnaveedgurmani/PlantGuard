#!/usr/bin/env python3
"""Monitor the PlantGuard v2 Kaggle kernel until complete, then download artifacts.

Polls every 10 minutes. When the run completes, downloads:
  - best_model.keras, metrics.json, history.json, training_log.csv, labels.json
to ~/workspace/plantguard-deploy/cnn-training/artifacts/v2/
Writes a STATUS file with progress.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

TOKEN = open(os.path.expanduser("~/.kaggle/access_token")).read().strip()
KERNEL = "muhammadnaveedg/plantguard-cnn-training-v2"
OUT_DIR = Path.home() / "workspace/plantguard-deploy/cnn-training/artifacts/v2"
STATUS_FILE = OUT_DIR / "STATUS.txt"
POLL_SECS = 600  # 10 minutes
MAX_WAIT_SECS = 5 * 3600  # 5 hours max

OUT_DIR.mkdir(parents=True, exist_ok=True)


def api_get(path):
    req = urllib.request.Request(
        f"https://www.kaggle.com/api/v1{path}",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return -1, str(e).encode()


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(STATUS_FILE, "a") as f:
        f.write(line + "\n")


def main():
    log(f"Starting monitor for {KERNEL}")
    log(f"Output dir: {OUT_DIR}")
    start = time.time()

    while time.time() - start < MAX_WAIT_SECS:
        elapsed = (time.time() - start) / 60
        # Try to list kernel output files
        status, data = api_get(f"/kernels/output/{KERNEL}")
        if status == 200 and not data.startswith(b"<!DOCTYPE"):
            log(f"Output available after {elapsed:.0f} min! Downloading...")
            # data is a zip of outputs
            import io, zipfile
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    z.extractall(OUT_DIR)
                log("Downloaded and extracted outputs.")
                for f in sorted(OUT_DIR.rglob("*")):
                    if f.is_file() and f.name != "STATUS.txt":
                        log(f"  {f.name} ({f.stat().st_size/1e6:.2f} MB)")
                # Quick metrics check
                mf = OUT_DIR / "outputs" / "metrics.json"
                if not mf.exists():
                    mf = OUT_DIR / "metrics.json"
                if mf.exists():
                    m = json.loads(mf.read_text())
                    log(f"TEST ACCURACY: {m.get('test_accuracy')}")
                    log(f"VAL (from history): check history.json")
                log("MONITOR COMPLETE")
                return 0
            except Exception as e:
                log(f"Download/extract failed: {e}")
        else:
            log(f"Still running/waiting ({elapsed:.0f} min elapsed, status={status})")

        time.sleep(POLL_SECS)

    log("TIMEOUT after 5 hours. Manual check needed.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
