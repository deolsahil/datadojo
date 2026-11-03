"""In-app update for the desktop app, the way most desktop apps do it: download in the background,
then "Restart to update" (or it installs on its own the next time DataDojo quits, never mid-task).

macOS: copy the new DataDojo.app next to the running one; a small shell script waits for this process
to exit, swaps the bundles, and reopens DataDojo only if the learner chose Restart. Windows: once
DataDojo has exited, the Inno Setup installer runs silently, then DataDojo starts again if asked.
Anything unexpected falls back to opening the download (or the release page) to finish by hand.
"""
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

ALLOWED = "https://github.com/deolsahil/datadojo/releases/download/"  # only ever download our own release files
state = {"phase": "idle", "done": 0, "total": 0, "error": None, "fallback": None, "version": None}
RELAUNCH = Path(tempfile.gettempdir()) / f"datadojo-relaunch-{os.getpid()}"  # exists = reopen DataDojo after installing
quit_app = None  # set by desktop.py: closes the window so the process can exit and be replaced


def supported():
    return getattr(sys, "frozen", False) and sys.platform in ("darwin", "win32")


def start(url, name, release_page, version=None):
    if state["phase"] in ("downloading", "installing", "ready", "restarting"):
        return state
    if not supported() or not (url or "").startswith(ALLOWED):
        state.update(phase="error", error="This copy of DataDojo can't update itself.", fallback=release_page)
        return state
    state.update(phase="downloading", done=0, total=0, error=None, fallback=release_page, version=version)
    threading.Thread(target=_run, args=(url, name), daemon=True).start()
    return state


def _run(url, name):
    try:
        folder = Path(tempfile.mkdtemp(prefix="datadojo-update-"))
        file = folder / name
        with urllib.request.urlopen(url, timeout=30) as r, open(file, "wb") as out:
            state["total"] = int(r.headers.get("Content-Length") or 0)
            while chunk := r.read(256 * 1024):
                out.write(chunk)
                state["done"] += len(chunk)
        state["fallback"] = str(file)  # from here on, the download itself is the way out if installing fails
        state["phase"] = "installing"
        (_install_mac if sys.platform == "darwin" else _install_windows)(file)
        state["phase"] = "ready"  # installs when DataDojo quits; restart() makes that happen now and reopens it
    except Exception as e:  # keep the learner unblocked: the popup offers the download or the release page
        from datadojo.llm import _reason
        state.update(phase="error", error=(_reason(e) if isinstance(e, urllib.error.URLError) else f"{type(e).__name__}: {e}")[:300])


def restart():
    """Restart to update: close the window; the waiting installer swaps the app and reopens it."""
    if state["phase"] != "ready" or not quit_app:
        return state
    RELAUNCH.touch()
    state["phase"] = "restarting"
    threading.Timer(0.4, quit_app).start()  # let this answer reach the page first
    return state


def _install_mac(dmg):
    bundle = Path(sys.executable).resolve().parents[2]  # .../DataDojo.app/Contents/MacOS/DataDojo
    if bundle.suffix != ".app" or not os.access(bundle.parent, os.W_OK):
        raise PermissionError(f"can't write to {bundle.parent}")
    mount = Path(tempfile.mkdtemp(prefix="datadojo-dmg-"))
    staged = bundle.with_name(".DataDojo-update.app")
    subprocess.run(["hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint", str(mount), str(dmg)], check=True, capture_output=True)
    try:
        shutil.rmtree(staged, ignore_errors=True)
        subprocess.run(["ditto", str(mount / "DataDojo.app"), str(staged)], check=True, capture_output=True)
    finally:
        subprocess.run(["hdiutil", "detach", str(mount), "-quiet"], capture_output=True)
    old = bundle.with_name(".DataDojo-old.app")
    # after this process exits: swap the bundles, drop the old one, reopen (the running app must not be moved mid-flight)
    b, o, n = (shlex.quote(str(p)) for p in (bundle, old, staged))
    r = shlex.quote(str(RELAUNCH))
    script = (f"while kill -0 {os.getpid()} 2>/dev/null; do sleep 0.3; done; rm -rf {o}; mv {b} {o} && mv {n} {b} && rm -rf {o}; "
              f"if [ -f {r} ]; then rm -f {r}; open {b}; fi")
    subprocess.Popen(["/bin/sh", "-c", script], start_new_session=True, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _install_windows(setup):
    exe = Path(sys.executable).resolve()
    ps = (f"Wait-Process -Id {os.getpid()} -ErrorAction SilentlyContinue; "
          f"Start-Process -Wait -FilePath '{setup}' -ArgumentList '/SILENT','/SUPPRESSMSGBOXES','/NORESTART'; "
          f"if (Test-Path '{RELAUNCH}') {{ Remove-Item '{RELAUNCH}'; Start-Process -FilePath '{exe}' }}")
    subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
                     creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
