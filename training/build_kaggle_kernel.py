#!/usr/bin/env python3
"""Build the self-contained Kaggle kernel (payload embedded as base64).

Regenerates kaggle_kernel/kaggle_main.py from the current pipeline scripts.
Run after editing any of: run_all.py, train.py, data_utils.py,
download_data_hf.py, evaluate.py, requirements-kaggle.txt
"""
import base64
import io
import zipfile
from pathlib import Path

SRC = Path(__file__).resolve().parent
KDIR = SRC / "kaggle_kernel"
FILES = [
    "run_all.py",
    "train.py",
    "data_utils.py",
    "download_data_hf.py",
    "evaluate.py",
    "requirements-kaggle.txt",
]

MAIN_TEMPLATE = '''#!/usr/bin/env python3
"""Self-contained Kaggle entry point: pipeline payload embedded as base64."""
import base64
import io
import runpy
import subprocess
import sys
import zipfile
from pathlib import Path

PAYLOAD_B64 = "__PAYLOAD__"
WORK = Path("/kaggle/working")
PKG = WORK / "pkg"


def main():
    PKG.mkdir(parents=True, exist_ok=True)
    print("Extracting payload ...", flush=True)
    data = base64.b64decode(PAYLOAD_B64)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(PKG)
    py = sys.executable
    print("Installing requirements ...", flush=True)
    subprocess.check_call(
        [py, "-m", "pip", "install", "--quiet", "-r",
         str(PKG / "requirements-kaggle.txt")]
    )
    print("Requirements installed. Starting pipeline ...", flush=True)
    runpy.run_path(str(PKG / "run_all.py"), run_name="__main__")


if __name__ == "__main__":
    main()
'''


def main():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in FILES:
            p = SRC / f
            assert p.exists(), f"missing {f}"
            z.write(p, f)
    b64 = base64.b64encode(buf.getvalue()).decode()
    out = KDIR / "kaggle_main.py"
    out.write_text(MAIN_TEMPLATE.replace("__PAYLOAD__", b64))
    print(f"wrote {out} ({len(b64)} b64 chars)")


if __name__ == "__main__":
    main()
