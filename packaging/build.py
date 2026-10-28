"""Build the desktop app and its installer for the current OS.

    uv run --extra desktop --with pyinstaller --with pillow python packaging/build.py

macOS  -> dist/release/DataDojo-macOS-<arch>.dmg   (drag-to-Applications disk image)
Windows-> dist/release/DataDojo-Windows-Setup.exe   (Inno Setup installer; needs `iscc` on PATH)
PySpark is deliberately not bundled (~320 MB); the app installs it on first use.
Unsigned: see README for the one-time "Open Anyway" / "Run anyway" step.
"""
import platform, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST, BUILD, OUT = ROOT / "dist", ROOT / "build", ROOT / "dist" / "release"
sys.path.insert(0, str(ROOT))
from datadojo import __version__  # noqa: E402


def pyinstaller():
    sep = ";" if sys.platform == "win32" else ":"
    args = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--windowed", "--name", "DataDojo",
        "--icon", str(ROOT / "packaging" / "icon.png"),
        "--osx-bundle-identifier", "com.deolsahil.datadojo",
        "--distpath", str(DIST), "--workpath", str(BUILD), "--specpath", str(BUILD),
        "--collect-data", "datadojo", "--collect-submodules", "datadojo",
        "--collect-submodules", "sqlglot", "--collect-all", "psycopg_binary",
        "--hidden-import", "duckdb", "--hidden-import", "psycopg",
        "--add-data", f"{ROOT / 'datadojo' / 'runner.py'}{sep}datadojo",
        "--exclude-module", "pyspark", "--exclude-module", "py4j", "--exclude-module", "tkinter",
        str(ROOT / "packaging" / "launch.py"),
    ]
    subprocess.run(args, check=True)


def mac_dmg():
    arch = "arm64" if platform.machine() == "arm64" else "x64"
    stage = BUILD / "dmg"
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    shutil.copytree(DIST / "DataDojo.app", stage / "DataDojo.app", symlinks=True)
    (stage / "Applications").symlink_to("/Applications")
    out = OUT / f"DataDojo-macOS-{arch}.dmg"
    out.unlink(missing_ok=True)
    subprocess.run(["hdiutil", "create", "-volname", "DataDojo", "-srcfolder", str(stage), "-ov", "-format", "UDZO", str(out)],
                   check=True)
    return out


def windows_setup():
    iss = ROOT / "packaging" / "windows.iss"
    iscc = shutil.which("iscc") or r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
    subprocess.run([iscc, f"/DAppVersion={__version__}", f"/DSourceDir={DIST / 'DataDojo'}", f"/DOutDir={OUT}",
                    f"/DIconFile={BUILD / 'DataDojo.ico'}", str(iss)], check=True)
    return OUT / "DataDojo-Windows-Setup.exe"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":  # Inno Setup wants a real .ico
        from PIL import Image
        BUILD.mkdir(exist_ok=True)
        Image.open(ROOT / "packaging" / "icon.png").save(BUILD / "DataDojo.ico", sizes=[(s, s) for s in (16, 32, 48, 64, 128, 256)])
    pyinstaller()
    out = mac_dmg() if sys.platform == "darwin" else windows_setup() if sys.platform == "win32" else None
    print(f"built {out}" if out else f"built {DIST / 'DataDojo'} (no installer format for {sys.platform})")


if __name__ == "__main__":
    main()
