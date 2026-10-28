"""Where per-user data lives: progress DB, settings (incl. API keys), the private Postgres cluster, extra PySpark envs.

Kept outside the installed package so upgrades never touch it. Override with DATADOJO_HOME.
"""
import os
import sys
from pathlib import Path


def _default_home():
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "DataDojo"
    if os.name == "nt":
        return Path(os.environ.get("APPDATA", Path.home())) / "DataDojo"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "datadojo"


DATA_HOME = Path(os.environ["DATADOJO_HOME"]) if os.environ.get("DATADOJO_HOME") else _default_home()
DATA_HOME.mkdir(parents=True, exist_ok=True)
