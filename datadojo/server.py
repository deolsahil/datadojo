"""DataDojo server: JSON API + static UI. Start it with the `datadojo` command (see __main__.py)."""
import atexit, datetime, re, functools, webbrowser, hashlib, json, os, shutil, sqlite3, subprocess, sys, tempfile, threading, tomllib, urllib.request
from collections import Counter
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from datadojo import content, interview, llm, rounds
from datadojo.paths import DATA_HOME

ROOT = Path(__file__).parent          # read-only app files (problems, static, ...)
PROBLEMS = ROOT / "problems"
TIMEOUT = {"sql": 15, "python": 15, "pyspark": 180}  # spark JVM cold start ~10s
DIFFICULTIES = ("easy", "medium", "hard")
REQUIRED = {"title", "lang", "difficulty", "pattern", "statement", "starter", "solution", "tests"}


_loaded = {}  # parsed files, re-read only when a file changes: every page asked for all 252 problems (~60 ms each time)


def _cached(name, files, build):
    sig = tuple((str(f), f.stat().st_mtime_ns) for f in files)
    if _loaded.get(name, (None,))[0] != sig:
        _loaded[name] = (sig, build())
    return _loaded[name][1]


def load_catalog():
    return _cached("catalog", [PROBLEMS / "catalog.toml"], lambda: tomllib.loads((PROBLEMS / "catalog.toml").read_text()))


def parse_problem(text, stem, catalog):
    """Parse and normalize one problem file. Raises ValueError/TOMLDecodeError if malformed."""
    p = tomllib.loads(text)
    p.setdefault("id", stem)
    missing = REQUIRED - p.keys() | ({"function"} - p.keys() if p.get("lang") in ("python", "pyspark") else set())
    if missing:
        raise ValueError(f"missing keys: {sorted(missing)}")
    patterns = {x["id"]: x["lang"] for x in catalog["patterns"]}
    lists = {x["id"] for x in catalog["lists"]}
    if patterns.get(p["pattern"]) != p["lang"]:
        raise ValueError(f"pattern {p['pattern']!r} is not a {p['lang']} pattern in catalog.toml")
    if p["difficulty"] not in DIFFICULTIES:
        raise ValueError(f"difficulty must be one of {DIFFICULTIES}")
    if set(p.get("lists", [])) - lists:
        raise ValueError(f"unknown lists: {sorted(set(p['lists']) - lists)}")
    if not p["tests"]:
        raise ValueError("no tests")
    for t in p["tests"]:  # TOML has no null: rows/args may be given as a JSON string instead
        if isinstance(t.get("args"), str):
            t["args"] = json.loads(t["args"])
        for tbl in t.get("tables", {}).values():
            if isinstance(tbl["rows"], str):
                tbl["rows"] = json.loads(tbl["rows"])
    return p


def load_problems():
    """All problems by id. Callers must not change the dicts: they are shared until a file changes."""
    return _cached("problems", sorted(PROBLEMS.glob("*/*.toml")) + [PROBLEMS / "catalog.toml"], _parse_problems)


def _parse_problems():
    catalog, out = load_catalog(), {}
    for f in sorted(PROBLEMS.glob("*/*.toml")):
        try:
            p = parse_problem(f.read_text(), f.stem, catalog)
        except (ValueError, KeyError, TypeError, tomllib.TOMLDecodeError) as e:
            print(f"skipping {f.relative_to(PROBLEMS)}: {e}", file=sys.stderr)
            continue
        if p["id"] in out:
            print(f"skipping {f.relative_to(PROBLEMS)}: duplicate id {p['id']!r}", file=sys.stderr)
            continue
        out[p["id"]] = p
    return out


def db():
    con = sqlite3.connect(DATA_HOME / "dojo.db")
    con.execute("CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY, problem TEXT, "
                "passed INTEGER, code TEXT, ts TEXT DEFAULT CURRENT_TIMESTAMP)")
    if "engine" not in {r[1] for r in con.execute("PRAGMA table_info(submissions)")}:
        con.execute("ALTER TABLE submissions ADD COLUMN engine TEXT")
    con.execute("CREATE TABLE IF NOT EXISTS design_progress (lesson TEXT PRIMARY KEY, ts TEXT DEFAULT CURRENT_TIMESTAMP)")
    con.execute("CREATE TABLE IF NOT EXISTS game_scores (id INTEGER PRIMARY KEY, game TEXT, score INTEGER, "
                "ts TEXT DEFAULT CURRENT_TIMESTAMP)")
    con.execute("CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY, kind TEXT, problem TEXT, category TEXT, "
                "rating INTEGER, name TEXT, email TEXT, text TEXT, code TEXT, resolved INTEGER DEFAULT 0, "
                "ts TEXT DEFAULT CURRENT_TIMESTAMP)")
    con.execute("CREATE TABLE IF NOT EXISTS explanations (key TEXT PRIMARY KEY, text TEXT)")
    con.execute("CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, problem TEXT, kind TEXT, ts TEXT DEFAULT CURRENT_TIMESTAMP)")
    con.execute("CREATE TABLE IF NOT EXISTS rounds (id INTEGER PRIMARY KEY, problem TEXT, track TEXT, level TEXT, score INTEGER, "
                "report TEXT, ts TEXT DEFAULT CURRENT_TIMESTAMP)")
    con.execute("CREATE TABLE IF NOT EXISTS interviews (id INTEGER PRIMARY KEY, track TEXT, level TEXT, mode TEXT, topic TEXT, "
                "score INTEGER, items TEXT, ts TEXT DEFAULT CURRENT_TIMESTAMP)")
    return con


FEEDBACK_PUBLIC = ("id", "kind", "problem", "category", "rating", "name", "text", "code", "resolved", "ts")  # never email


def save_feedback(b, probs):
    """Validate and store a review (kind=review) or a problem report (kind=report)."""
    kind, text = b.get("kind"), str(b.get("text", "")).strip()
    if kind not in ("review", "report") or not text:
        return "Please write a few words."
    rating = b.get("rating")
    if kind == "review" and rating not in (1, 2, 3, 4, 5):
        return "Pick a rating from 1 to 5."
    if kind == "report" and b.get("problem") not in probs:
        return "Unknown problem."
    with db() as con:
        con.execute("INSERT INTO feedback (kind, problem, category, rating, name, email, text, code) VALUES (?,?,?,?,?,?,?,?)",
                    (kind, b.get("problem"), str(b.get("category") or "")[:40], rating if kind == "review" else None,
                     str(b.get("name") or "").strip()[:60], str(b.get("email") or "").strip()[:120], text[:4000],
                     str(b.get("code") or "")[:20000] or None))
    return None


# ---- engines -----------------------------------------------------------------
# Reference answers always come from the DEFAULT engine of each language, so a
# dialect/version choice only changes how the learner's code runs, never what is correct.

DEFAULT_ENGINE = {"sql": "duckdb", "python": f"{sys.version_info[0]}.{sys.version_info[1]}", "pyspark": "default"}
EMULATED = {"mysql": "MySQL", "snowflake": "Snowflake", "bigquery": "BigQuery", "tsql": "SQL Server (T-SQL)",
            "oracle": "Oracle", "redshift": "Redshift"}
PG_DIR, PG_PORT = DATA_HOME / "pg", "55432"
PG_SOCKETS = Path(tempfile.gettempdir()) / f"datadojo-pg-{os.getuid() if hasattr(os, 'getuid') else 'win'}"  # short, space-free


@functools.cache
def java17_home():
    """A Java 17+ home for PySpark 4.x environments, or None."""
    for cand in (os.environ.get("JAVA17_HOME"), sh("/usr/libexec/java_home", "-v", "17+") if sys.platform == "darwin" else None,
                 "/opt/homebrew/opt/openjdk@17", "/opt/homebrew/opt/openjdk@21", "/usr/lib/jvm/java-17-openjdk-amd64",
                 "/usr/lib/jvm/java-21-openjdk-amd64"):
        if cand and (Path(cand) / "bin" / ("java.exe" if os.name == "nt" else "java")).exists():
            return cand
    return None
_pg_lock = threading.Lock()


def sh(*cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


@functools.cache
def engines():
    import duckdb
    try:  # the pip install ships PySpark; the desktop app installs it on demand (see install_pyspark)
        import pyspark
        bundled_spark = pyspark.__version__
    except ImportError:
        bundled_spark = None
    sql = [{"id": "duckdb", "label": f"DuckDB {duckdb.__version__}", "kind": "native"},
           {"id": "sqlite", "label": f"SQLite {sqlite3.sqlite_version}", "kind": "native"}]
    if shutil.which("pg_ctl") and shutil.which("initdb"):
        sql.append({"id": "postgres", "label": sh("postgres", "--version").replace("postgres (PostgreSQL)", "PostgreSQL"),
                    "kind": "native"})
    sql += [{"id": k, "label": f"{v} (emulated)", "kind": "emulated"} for k, v in EMULATED.items()]

    python = []
    for minor in range(10, 16):
        v = f"3.{minor}"
        path = sys.executable if v == DEFAULT_ENGINE["python"] else sh("uv", "python", "find", v)
        if path:
            # never run sys.executable to ask its version: in the desktop app it IS DataDojo, and a second
            # window opened on the setup screen every time a problem loaded the engine list
            label = f"Python {sys.version.split()[0]}" if path == sys.executable else sh(path, "--version") or f"Python {v}"
            python.append({"id": v, "label": label, "kind": "native", "path": path})

    pyspark_envs = [{"id": "default", "label": f"PySpark {bundled_spark}", "kind": "native",
                     "path": sys.executable, "java": None}] if bundled_spark else []
    for env in sorted([*(DATA_HOME / "envs").glob("pyspark-*/bin/python"), *(DATA_HOME / "envs").glob("pyspark-*/Scripts/python.exe")]):
        ver = sh(str(env), "-c", "import pyspark; print(pyspark.__version__)")
        if ver:
            java = java17_home() if int(ver.split(".")[0]) >= 4 else None
            if int(ver.split(".")[0]) >= 4 and not java:
                continue  # Spark 4 needs Java 17+
            pyspark_envs.append({"id": env.parent.parent.name, "label": f"PySpark {ver}" + (" · Java 17" if java else ""),
                                 "kind": "native", "path": str(env), "java": java})
    if pyspark_envs:  # Spark SQL runs in the first PySpark environment
        sql.insert(3 if len(sql) > 2 and sql[2]["id"] == "postgres" else 2,
                   {"id": "spark-sql", "label": pyspark_envs[0]["label"].replace("PySpark", "Spark SQL").split(" ·")[0],
                    "kind": "native", "path": pyspark_envs[0]["path"], "java": pyspark_envs[0]["java"]})
    return {"sql": sql, "python": python, "pyspark": pyspark_envs}


def default_engine(lang):
    """Reference answers come from this engine. PySpark's is whichever environment exists first."""
    if lang == "pyspark":
        envs = engines()["pyspark"]
        return envs[0]["id"] if envs else None
    return DEFAULT_ENGINE[lang]


spark_install = {"status": "idle"}
_release = {"checked": 0.0, "data": None}


def latest_release():
    """Current version vs the newest GitHub release (checked at most every 6 hours, never blocks the UI long)."""
    import time
    from datadojo import __version__
    if time.time() - _release["checked"] > 6 * 3600:
        _release["checked"] = time.time()
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(
                "https://api.github.com/repos/deolsahil/datadojo/releases/latest",
                headers={"Accept": "application/vnd.github+json"}), timeout=4))
            _release["data"] = {"tag": r["tag_name"], "url": r["html_url"], "notes": (r.get("body") or "")[:6000],
                                "assets": {a["name"]: a["browser_download_url"] for a in r.get("assets", [])}}
        except Exception:
            _release["data"] = None
    data = _release["data"] or {}
    latest = data.get("tag", "").lstrip("v")
    try:
        newer = bool(latest) and tuple(map(int, latest.split("."))) > tuple(map(int, __version__.split(".")))
    except ValueError:  # a tag like v1.0.0-beta: don't offer it
        newer = False
    import platform
    arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
    asset = {"darwin": f"DataDojo-macOS-{arch}.dmg", "win32": "DataDojo-Windows-Setup.exe"}.get(sys.platform, "DataDojo-Linux-x64.tar.gz")
    return {"version": __version__, "latest": latest or None, "update": newer, "url": data.get("url"), "notes": data.get("notes", ""),
            "install": "desktop" if getattr(sys, "frozen", False) else "terminal",  # frozen = the packaged desktop app
            "download": data.get("assets", {}).get(asset), "os": {"darwin": "Mac", "win32": "Windows"}.get(sys.platform, "Linux")}


def uv_binary():
    """uv on PATH, or a private copy in the data folder (downloaded once from astral-sh/uv releases)."""
    found = shutil.which("uv")
    if found:
        return found
    exe = DATA_HOME / "bin" / ("uv.exe" if os.name == "nt" else "uv")
    if exe.exists():
        return str(exe)
    import platform, tarfile, zipfile
    arch = {"arm64": "aarch64", "aarch64": "aarch64"}.get(platform.machine().lower(), "x86_64")
    target = {"darwin": f"{arch}-apple-darwin", "win32": f"{arch}-pc-windows-msvc"}.get(sys.platform, f"{arch}-unknown-linux-gnu")
    ext = "zip" if os.name == "nt" else "tar.gz"
    url = f"https://github.com/astral-sh/uv/releases/latest/download/uv-{target}.{ext}"
    archive = DATA_HOME / "bin" / f"uv.{ext}"
    archive.parent.mkdir(exist_ok=True)
    urllib.request.urlretrieve(url, archive)
    name = exe.name
    if ext == "zip":
        with zipfile.ZipFile(archive) as z:
            member = next(m for m in z.namelist() if m.endswith("/" + name) or m == name)
            exe.write_bytes(z.read(member))
    else:
        with tarfile.open(archive) as t:
            member = next(m for m in t.getmembers() if m.name.endswith("/" + name) or m.name == name)
            exe.write_bytes(t.extractfile(member).read())
    exe.chmod(0o755)
    archive.unlink()
    return str(exe)


def install_pyspark():
    """Create DATA_HOME/envs/pyspark-3.5 (Python 3.12 + PySpark 3.5) in the background; ~350 MB."""
    if spark_install["status"] in ("downloading uv", "creating environment", "installing pyspark"):
        return

    def work():
        env = DATA_HOME / "envs" / "pyspark-3.5"
        flags = {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0), "capture_output": True, "text": True}
        try:
            spark_install.update(status="downloading uv", error=None)
            uv = uv_binary()
            spark_install["status"] = "creating environment"
            r = subprocess.run([uv, "venv", "--python", "3.12", str(env)], **flags)
            if r.returncode:
                raise RuntimeError(r.stderr[-400:])
            spark_install["status"] = "installing pyspark"
            py = env / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            r = subprocess.run([uv, "pip", "install", "--python", str(py), "pyspark==3.5.*"], **flags)
            if r.returncode:
                raise RuntimeError(r.stderr[-400:])
            engines.cache_clear()
            spark_install["status"] = "done"
        except Exception as e:
            spark_install.update(status="error", error=str(e)[:400])

    threading.Thread(target=work, daemon=True).start()


def ensure_postgres():
    """Start DataDojo's own Postgres cluster in data/pg (unix socket only, no TCP)."""
    with _pg_lock:
        if not (PG_DIR / "PG_VERSION").exists():
            subprocess.run(["initdb", "-D", str(PG_DIR), "-U", "dojo", "--auth=trust", "-E", "UTF8"],
                           check=True, capture_output=True)
        # unix socket in a short temp dir (no TCP) on macOS/Linux; Windows has no unix sockets, so loopback TCP
        host = "127.0.0.1" if os.name == "nt" else str(PG_SOCKETS)
        opts = f"-c listen_addresses=127.0.0.1 -p {PG_PORT}" if os.name == "nt" else f"-c listen_addresses='' -k {PG_SOCKETS} -p {PG_PORT}"
        if subprocess.run(["pg_ctl", "-D", str(PG_DIR), "status"], capture_output=True).returncode != 0:
            PG_SOCKETS.mkdir(mode=0o700, exist_ok=True)
            subprocess.run(["pg_ctl", "-D", str(PG_DIR), "-w", "-l", str(PG_DIR / "server.log"), "-o", opts, "start"],
                           check=True, capture_output=True)
            atexit.register(lambda: subprocess.run(["pg_ctl", "-D", str(PG_DIR), "-m", "fast", "stop"], capture_output=True))
    return {"DOJO_PG_HOST": host, "DOJO_PG_PORT": PG_PORT}


def execute(p, code, engine, map=False, scale=False):
    """Run code over all tests of p with the given engine; returns runner output or {"error"}."""
    lang = p["lang"]
    # Each engine owns its Spark: drop an inherited SPARK_HOME/PYSPARK_* (e.g. a local Spark install),
    # which would otherwise override the pip pyspark of the selected environment.
    env = {k: v for k, v in os.environ.items() if k not in ("SPARK_HOME", "PYSPARK_PYTHON", "PYSPARK_DRIVER_PYTHON")}
    by_id = {e["id"]: e for e in engines()[lang]}
    if engine not in by_id:
        return {"error": f"Engine {engine!r} is not available for {lang}"}
    python = sys.executable
    if lang == "python":
        python = by_id[engine]["path"]
    elif lang == "pyspark" or engine == "spark-sql":
        python = by_id[engine]["path"]
        if by_id[engine]["java"]:
            env["JAVA_HOME"] = by_id[engine]["java"]
    elif engine == "postgres":
        try:
            env |= ensure_postgres()
        except (OSError, subprocess.CalledProcessError) as e:
            return {"error": f"Could not start PostgreSQL: {e}"}
    env["PYSPARK_PYTHON"] = env["PYSPARK_DRIVER_PYTHON"] = python
    limit = TIMEOUT[lang] + (240 if scale else 0)  # at scale: several big runs of two solutions
    # ponytail: fresh process + timeout only, no memory cap/sandbox; fine for your own code on your own machine
    with tempfile.TemporaryDirectory() as tmp:
        req, res = Path(tmp) / "request.json", Path(tmp) / "result.json"
        req.write_text(json.dumps({"problem": p, "code": code, "engine": engine, "map": map, "scale": scale}), encoding="utf-8")
        # a frozen desktop build has no python to call: it re-runs itself in runner mode
        cmd = ([sys.executable, "--runner"] if python == sys.executable and getattr(sys, "frozen", False)
               else [python, "-I", str(ROOT / "runner.py")])
        try:
            r = subprocess.run(cmd + [str(req), str(res)], cwd=tmp, env=env, capture_output=True, text=True,
                               timeout=limit, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.TimeoutExpired:
            return {"error": f"Timed out after {limit}s"}
        try:
            return json.loads(res.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {"error": (r.stdout + r.stderr)[-4000:] or f"runner exited {r.returncode}"}


_expected = {}


def expected(p):
    key = (p["id"], hashlib.sha256(json.dumps([p["solution"], p["tests"]], sort_keys=True).encode()).hexdigest())
    if key not in _expected:
        res = execute(p, p["solution"], default_engine(p["lang"]))
        if "error" in res:
            return res  # don't cache failures
        _expected[key] = res
    return _expected[key]


_ref_maps = {}


def execution_map(p, code, engine=None):
    """What the engine did with the learner's code, next to the reference solution's map."""
    engine = engine or default_engine(p["lang"])
    key = (p["id"], engine if p["lang"] == "sql" and engine == "spark-sql" else "", hashlib.sha256(p["solution"].encode()).hexdigest())
    ref_engine = "spark-sql" if engine == "spark-sql" else default_engine(p["lang"])
    ref, box = _ref_maps.get(key), {}
    t = None if ref else threading.Thread(target=lambda: box.update(r=execute(p, p["solution"], ref_engine, map=True)))
    if t:
        t.start()  # both maps at once: each Spark process takes seconds to start
    yours = execute(p, code, engine, map=True)
    if t:
        t.join()
        ref = box["r"]
        if "error" not in ref:
            _ref_maps[key] = ref
    return {"yours": yours, "reference": ref}


TRANSLATION_ERRORS = re.compile(r"ParseError|TokenError|Parser Error|Binder Error|Catalog Error|Unsupported|not supported|"
                                r"No function matches|Invalid expression", re.I)
_ai_sql = {}


def translation_failed(got):
    errs = [got.get("error") or ""] + [o.get("error") or "" for o in got.get("outputs", [])]
    return any(TRANSLATION_ERRORS.search(e) for e in errs)


def ai_translate(p, code, dialect):
    """Translate another SQL dialect to DuckDB with the coach's model when sqlglot can't. Faithful, never "fixed":
    a wrong answer must stay wrong. Accepted only if it parses as one or more read-only queries. None on any failure."""
    import sqlglot
    from sqlglot import exp
    key = hashlib.sha256(f"{dialect}\0{code}".encode()).hexdigest()
    if key in _ai_sql:
        return _ai_sql[key]
    schema = "\n".join(f"CREATE TABLE {n} ({tb['columns']});" for n, tb in p["tests"][0]["tables"].items())
    system = f"""You translate SQL from {EMULATED[dialect]} to DuckDB SQL.
Translate exactly. Keep the query's meaning, column names, aliases, ordering and row results identical, INCLUDING any
mistakes: never fix, simplify, optimize or change the logic. Only change syntax and function names so DuckDB runs it.
Reply with only the DuckDB SQL, no explanation and no code fences.

Tables:
{schema}"""
    try:
        out = llm.chat(system, [{"role": "user", "content": code}], strict=True).strip()
        out = re.sub(r"^```\w*\s*|\s*```$", "", out).strip()
        trees = [e for e in sqlglot.parse(out, read="duckdb") if e is not None]
        if not trees or not all(isinstance(e, exp.Query) for e in trees):  # SELECT / WITH / UNION only: nothing that writes
            return None
    except Exception:
        return None
    _ai_sql[key] = out
    return out


def format_code(lang, code, engine):
    """Pretty-print the learner's code: black for Python and PySpark, sqlglot in the engine's own SQL dialect."""
    try:
        if lang == "sql":
            import sqlglot
            dialect = {"spark-sql": "spark", "postgres": "postgres", "sqlite": "sqlite"}.get(engine or "duckdb", engine or "duckdb")
            out = ";\n\n".join(e.sql(dialect=dialect, pretty=True) for e in sqlglot.parse(code, read=dialect) if e)
            return {"code": out + ("\n" if out else "")}
        import ast, black
        out = black.format_str(code, mode=black.Mode()).split("\n")
        # black puts two blank lines before top-level defs (PEP 8); one reads better in short solutions. Only the gaps
        # right before top-level statements change, found with ast, so blank lines inside strings are never touched.
        starts = {min([n.lineno] + [d.lineno for d in getattr(n, "decorator_list", [])]) - 1 for n in ast.parse("\n".join(out)).body}
        keep = [ln for i, ln in enumerate(out) if not (ln == "" and i + 1 in starts and i >= 1 and out[i - 1] == "")]
        return {"code": "\n".join(keep)}
    except Exception as e:
        line = getattr(e, "errors", None) and e.errors[0].get("line")  # sqlglot
        line = line or (re.search(r"(\d+):\d+", str(e)) or [None, None])[1]  # black: "Cannot parse ...: 3:7: ..."
        return {"error": "Can't format yet: fix the syntax error first" + (f" (line {line})." if line else ".")}


def same(got, want, ordered):
    if not ordered and isinstance(got, list) and isinstance(want, list):
        got, want = sorted(got, key=repr), sorted(want, key=repr)
    return got == want


def clip(v, n=50):
    return v[:n] + [f"... {len(v) - n} more"] if isinstance(v, list) and len(v) > n else v


def run(p, code, engine=None):
    engine = engine or default_engine(p["lang"])
    if engine is None:
        return {"error": "PySpark isn't installed yet.", "needs": "pyspark"}
    exp = expected(p)
    if "error" in exp:
        return {"error": "Reference solution failed (this is a problem bug, not yours):\n" + exp["error"]}
    got = execute(p, code, engine)
    ai = None
    if engine in EMULATED and translation_failed(got):
        ai = ai_translate(p, code, engine)  # the automatic translator choked: ask the coach's model, then re-run on DuckDB
        if ai:
            got = execute(p, ai, "duckdb") | {"translated": ai}
    if "error" in got:
        return got | {"engine": engine}
    results = []
    for i, (t, e, g) in enumerate(zip(p["tests"], exp["outputs"], got["outputs"])):
        r = {"test": i + 1, "input": t.get("tables") or t.get("args")}
        if "error" in e:
            r.update(passed=False, error="reference solution failed: " + e["error"])
        else:
            r["expected"], r["expected_columns"] = clip(e["value"]), e.get("columns")
            if "error" in g:
                r.update(passed=False, error=g["error"])
            else:
                r.update(got=clip(g["value"]), got_columns=g.get("columns"), passed=same(g["value"], e["value"], p.get("ordered", False)))
        results.append(r)
    return {"results": results, "stdout": got.get("stdout", ""), "translated": got.get("translated"), "engine": engine,
            "translated_by": "ai" if ai else None}


STAGES = {
    "understand": "Check they understand the problem: inputs, output shape, edge cases. Ask them to restate it.",
    "approach": "Help them pick an approach in words or pseudocode before code. Ask what pattern applies.",
    "build": "They are writing code. Point at bugs or missing cases in their code. Never write the solution.",
    "edge-cases": "Push on edge cases: NULLs, ties, duplicates, empty input, boundaries. Ask which they handle.",
    "optimize": "Discuss cost: complexity, shuffles/joins in Spark, indexes/scans in SQL, and cleaner idioms.",
    "review": "They solved it. Review the code briefly, name the pattern, and suggest one related problem idea.",
    "interviewer": "You are the interviewer in a timed coding round. Do not give hints, code or the approach. Answer clarifying "
                   "questions about the problem only, briefly, like a real interviewer would. Encourage them to think out loud.",
}


def coach(p, code, result, stage, messages, solution=False):
    rules = f"""The learner already opened the reference solution below and wants to understand it.
EXPLAIN it directly: do not quiz them, do not answer with questions, do not hold anything back. Walk through
the solution clause by clause in plain words, using the problem's example rows to show what each part does
(e.g. which values become 0, what each COUNT returns). If their own code differs, say what it is missing.
At most 10 short sentences or bullets. Only at the very end, you may ask one short check question.

Reference solution:
{p['solution']}""" if solution else f"""The learner
wants to build skill, not be handed answers. Reply in at most 5 short sentences, ask one question at a
time, and never write the full solution (small snippets of syntax are fine).
Current stage: {stage}. {STAGES.get(stage, '')}"""
    system = f"""You are Sensei, a coach for SQL, Python and PySpark interview practice. {rules}

Problem ({p['lang']}, {p['difficulty']}): {p['title']}
{p['statement']}

Learner's current code:
{code}

Latest test run (may be empty):
{json.dumps(result)[:2500]}"""
    return chat(system, messages)


def explain(p):
    """A walkthrough of the reference solution, generated once per solution and cached in dojo.db."""
    key = p["id"] + ":v2:" + hashlib.sha256(p["solution"].encode()).hexdigest()[:16]
    with db() as con:
        row = con.execute("SELECT text FROM explanations WHERE key=?", (key,)).fetchone()
    if row:
        return {"explanation": row[0]}
    system = f"""You explain reference solutions to people practising {p['lang']} for data interviews.
Write a clear walkthrough in Markdown (paragraphs, `code`, **bold**, - bullets only; no headings, no tables):
1. One or two sentences on the core idea / pattern.
2. A bullet per step or clause of the solution, in the order it runs, saying what it does and why it is needed.
3. "Watch out:" with the edge cases it handles (NULLs, ties, duplicates, empty input) and common wrong attempts.
Keep it under 250 words. Do not repeat the full code, and never put `code` inside **bold**.

Problem: {p['title']}
{p['statement']}

Reference solution:
{p['solution']}"""
    try:
        text = llm.chat(system, [{"role": "user", "content": "Explain this solution."}], strict=True).strip()
    except Exception as e:
        return {"error": f"Couldn't reach the coach ({llm._reason(e)}). Check coach setup."}
    with db() as con:
        con.execute("INSERT OR REPLACE INTO explanations VALUES (?,?)", (key, text))
    return {"explanation": text}


def coach_lesson(d, messages):
    system = f"""You are Sensei, a friendly data engineering mentor. The learner is reading a data system
design {'case study' if d['kind'] == 'case_study' else 'lesson'} and can see the page below. Answer their question in at most
6 short sentences, ground it in this page, prefer concrete numbers and trade-offs, and end with one
question that checks their understanding.

Title: {d['title']}
Big idea: {d['big_idea']}
{d['summary']}
{chr(10).join(b['heading'] + ': ' + b['body'] for b in d.get('blocks', []))[:6000]}"""
    return chat(system, messages)


def chat(system, messages):
    return llm.chat(system, messages)


def stats():
    con = db()
    probs = load_problems()
    solved = {r[0] for r in con.execute("SELECT DISTINCT problem FROM submissions WHERE passed")} & probs.keys()
    days = dict(con.execute("SELECT date(ts, 'localtime') d, COUNT(*) FROM (SELECT ts FROM submissions UNION ALL "
                            "SELECT ts FROM game_scores UNION ALL SELECT ts FROM design_progress) GROUP BY d"))
    runs = con.execute("SELECT COUNT(*) FROM submissions").fetchone()[0]
    streak, d = 0, datetime.date.today()
    if d.isoformat() not in days:  # today not practiced yet: streak still counts up to yesterday
        d -= datetime.timedelta(days=1)
    while d.isoformat() in days:
        streak, d = streak + 1, d - datetime.timedelta(days=1)
    langs = Counter(probs[r[0]]["lang"] for r in con.execute("SELECT problem FROM submissions") if r[0] in probs)
    total = Counter(p["difficulty"] for p in probs.values())
    done = Counter(probs[i]["difficulty"] for i in solved)
    return {"solved": len(solved), "total": len(probs), "streak": streak, "runs": runs,
            "main_language": langs.most_common(1)[0][0] if langs else None, "days": days,
            "by_difficulty": {k: {"solved": done[k], "total": total[k]} for k in DIFFICULTIES}}


REVIEW_GAPS = (1, 3, 7)  # days until the next review; three clean reviews and a problem is mastered


def practice():
    """The practice queue: struggled problems come back on a 1-3-7 day schedule, attempted-but-unsolved ones right away,
    plus the patterns with the lowest first-try success. Struggled = 2+ failed runs before the first pass, a hint, or
    the solution. A review counts when the problem passes on its first run that day, on or after the due date."""
    con, probs = db(), load_problems()
    today = datetime.date.today()
    runs, helped = {}, {}
    for pid, passed, ts in con.execute("SELECT problem, passed, datetime(ts, 'localtime') FROM submissions ORDER BY ts, id"):
        if pid in probs:
            runs.setdefault(pid, []).append((ts, bool(passed)))
    for pid, kind, ts in con.execute("SELECT problem, kind, datetime(ts, 'localtime') FROM events ORDER BY ts"):
        helped.setdefault(pid, []).append((ts, kind))
    day = lambda ts: datetime.date.fromisoformat(ts[:10])
    due, upcoming = [], []
    for pid, rs in runs.items():
        p = probs[pid]
        item = {"id": pid, "title": p["title"], "lang": p["lang"], "pattern": p["pattern"], "difficulty": p["difficulty"]}
        first = next((i for i, (_, ok) in enumerate(rs) if ok), None)
        if first is None:
            due.append(item | {"reason": "Not solved yet", "stage": 0, "since": (today - day(rs[-1][0])).days})
            continue
        fails = sum(1 for _, ok in rs[:first] if not ok)
        used = {k for ts, k in helped.get(pid, []) if ts <= rs[first][0]}
        if fails < 2 and not used:
            continue  # solved without struggling: nothing to review
        reason = ("Looked at the solution" if "solution" in used else "Used a hint" if "hint" in used
                  else f"{fails} failed runs before passing")
        stage, last = 0, day(rs[first][0])
        by_day = {}
        for ts, ok in rs[first + 1:]:
            by_day.setdefault(day(ts), []).append(ok)
        for d in sorted(by_day):
            if d > last and d >= last + datetime.timedelta(days=REVIEW_GAPS[min(stage, 2)]):
                stage, last = (stage + 1, d) if by_day[d][0] else (0, d)  # a failed review starts the schedule over
        if stage >= len(REVIEW_GAPS):
            continue  # mastered
        when = last + datetime.timedelta(days=REVIEW_GAPS[stage])
        entry = item | {"reason": reason, "stage": stage, "due": when.isoformat(), "since": (today - last).days}
        (due if when <= today else upcoming).append(entry)
    due.sort(key=lambda x: (x["reason"] != "Not solved yet", x.get("due", "")))
    upcoming.sort(key=lambda x: x["due"])
    # weak spots: first-try success per pattern, lowest first
    catalog = load_catalog()
    names = {pt["id"]: pt for pt in catalog["patterns"]}
    order = {"easy": 0, "medium": 1, "hard": 2}
    per = {}
    for pid, rs in runs.items():
        per.setdefault(probs[pid]["pattern"], []).append(rs[0][1])
    solved = {pid for pid, rs in runs.items() if any(ok for _, ok in rs)}
    weak = []
    for pat, firsts in per.items():
        rate = sum(firsts) / len(firsts)
        if rate >= 0.75 or len(firsts) < 2 or pat not in names:  # one attempt says nothing about a pattern
            continue
        nxt = sorted((q for q in probs.values() if q["pattern"] == pat and q["id"] not in solved),
                     key=lambda q: (order.get(q["difficulty"], 3), q["title"]))[:3]
        weak.append({"pattern": pat, "title": names[pat]["title"], "lang": names[pat]["lang"], "rate": round(rate * 100),
                     "attempted": len(firsts), "next": [{"id": q["id"], "title": q["title"], "difficulty": q["difficulty"]} for q in nxt]})
    weak.sort(key=lambda w: (w["rate"], -w["attempted"]))
    return {"due": due, "upcoming": upcoming[:5], "upcoming_count": len(upcoming), "weak": weak[:3]}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / "static"), **kw)

    def log_message(self, *args):  # keep the terminal quiet; errors still surface in the UI
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")  # always revalidate static files after an update
        super().end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parts = self.path.split("?")[0].strip("/").split("/")
        if parts == ["auth", "callback"]:  # "Sign in with ChatGPT" returns here in the browser
            from urllib.parse import parse_qsl, urlsplit
            from html import escape
            err = llm.openai_callback(dict(parse_qsl(urlsplit(self.path).query)))
            page = (f"<h2>Sign-in didn't finish</h2><p>{escape(err)}</p>" if err else
                    "<h2>Signed in to ChatGPT ✓</h2><p>You can close this tab and go back to DataDojo.</p>")
            data = f"<!doctype html><meta charset=utf-8><title>DataDojo</title><body style='font:15px system-ui;padding:40px'>{page}".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if parts[0] != "api":
            return super().do_GET()
        probs = load_problems()  # re-read each time so edited TOML shows up without restart
        if parts[1:] == ["catalog"]:
            solved = {r[0] for r in db().execute("SELECT DISTINCT problem FROM submissions WHERE passed")}
            summary = [{k: p.get(k) for k in ("id", "title", "lang", "difficulty", "pattern", "lists")}
                       | {"solved": p["id"] in solved} for p in probs.values()]
            return self.send_json(load_catalog() | {"problems": summary})
        if parts[1:] == ["engines"]:
            return self.send_json({lang: [{k: e[k] for k in ("id", "label", "kind")} for e in es]
                                   for lang, es in engines().items()}
                                  | {"default": {lang: default_engine(lang) for lang in DEFAULT_ENGINE},
                                     "java": bool(shutil.which("java") or os.environ.get("JAVA_HOME")), "spark_install": spark_install})
        if parts[1:] == ["profile"]:
            return self.send_json(tomllib.loads((ROOT / "profile.toml").read_text()))
        if parts[1:] == ["feedback"]:
            rows = db().execute(f"SELECT {', '.join(FEEDBACK_PUBLIC)} FROM feedback ORDER BY resolved, id DESC").fetchall()
            return self.send_json([dict(zip(FEEDBACK_PUBLIC, r)) for r in rows])
        if parts[1:2] == ["design"]:
            cat, lessons = content.load_design()
            done = {r[0] for r in db().execute("SELECT lesson FROM design_progress")}
            if len(parts) == 2:
                keys = ("id", "title", "section", "order", "kind", "difficulty", "companies", "big_idea")
                return self.send_json(cat | {"lessons": [{k: d.get(k) for k in keys} | {"done": d["id"] in done}
                                                         for d in lessons.values()]})
            if parts[2] in lessons:
                ids = list(lessons)
                i = ids.index(parts[2])
                return self.send_json(lessons[parts[2]] | {"done": parts[2] in done,
                                                           "prev": ids[i - 1] if i else None, "next": ids[i + 1] if i + 1 < len(ids) else None})
        if parts[1:2] == ["games"]:
            if len(parts) == 2:
                best = dict(db().execute("SELECT game, MAX(score) FROM game_scores GROUP BY game"))
                plays = dict(db().execute("SELECT game, COUNT(*) FROM game_scores GROUP BY game"))
                return self.send_json([g | {"best": best.get(g["id"]), "plays": plays.get(g["id"], 0)} for g in content.GAME_LIST])
            if parts[3:] == ["rounds"] and parts[2] in {g["id"] for g in content.GAME_LIST}:
                return self.send_json(content.rounds(parts[2]))
        if parts[1:2] == ["interview"]:
            tracks = content.load_interview()
            if len(parts) == 2:
                rows = db().execute("SELECT id, track, level, mode, topic, score, ts FROM interviews ORDER BY id DESC LIMIT 30")
                return self.send_json({
                    "tracks": [{k: t[k] for k in ("id", "title", "desc", "topics")} | {"count": len(t["questions"]), "sheet": len(t["sheet"])}
                               for t in tracks.values()],
                    "history": [dict(zip(("id", "track", "level", "mode", "topic", "score", "ts"), r)) for r in rows],
                    "voice": interview.whisper_status(), "coach": llm.public()})
            if parts[2] == "session" and len(parts) == 4:
                r = db().execute("SELECT id, track, level, mode, topic, score, items, ts FROM interviews WHERE id=?", (parts[3],)).fetchone()
                if r:
                    d = dict(zip(("id", "track", "level", "mode", "topic", "score", "items", "ts"), r))
                    d["items"] = json.loads(d["items"])
                    return self.send_json(d | {"report": interview.report(d["items"])})
            if parts[2] in tracks:
                t = tracks[parts[2]]
                if parts[3:] == ["cheatsheet"]:
                    return self.send_json({"id": t["id"], "title": t["title"], "sheet": t["sheet"]})
                if len(parts) == 3:
                    return self.send_json({k: t[k] for k in ("id", "title", "desc", "topics")} | {"count": len(t["questions"]),
                                          "sheet": len(t["sheet"]), "voice": interview.whisper_status()})
        if parts[1:] == ["setup"]:
            return self.send_json({"settings": llm.public(), "ollama": llm.ollama_status(),
                                   "local_models": llm.LOCAL_MODELS, "signin": llm.signin_state(),
                                   "providers": {k: v | {"models": llm.catalog_models(k)} for k, v in llm.PROVIDERS.items()}})
        if parts[1:] == ["coach-brain"]:  # which model the coaches use, shown on home and in the coach panel
            return self.send_json(llm.coach_brain())
        if parts[1:] == ["version"]:
            return self.send_json(latest_release())
        if parts[1:2] == ["rounds"] and len(parts) == 3:  # one past round's report
            row = db().execute("SELECT report FROM rounds WHERE id = ?", (parts[2],)).fetchone()
            return self.send_json(json.loads(row[0]) if row else {"error": "not found"}, 200 if row else 404)
        if parts[1:] == ["rounds"]:  # past coding rounds, newest first
            probs = load_problems()
            rows = db().execute("SELECT id, problem, track, level, score, ts FROM rounds ORDER BY id DESC LIMIT 10").fetchall()
            return self.send_json([{"id": i, "problem": pid, "title": probs.get(pid, {}).get("title", pid), "track": tr,
                                    "level": lv, "score": sc, "ts": ts} for i, pid, tr, lv, sc, ts in rows])
        if parts[1:] == ["practice"]:
            return self.send_json(practice())
        if parts[1:] == ["stats"]:
            return self.send_json(stats())
        if len(parts) >= 3 and parts[1] == "problems" and parts[2] in probs:
            p = probs[parts[2]]
            if parts[3:] == ["solution"]:
                return self.send_json({"solution": p["solution"]})
            subs = [dict(zip(("id", "passed", "code", "ts", "engine"), r)) for r in db().execute(
                "SELECT id, passed, code, ts, engine FROM submissions WHERE problem=? ORDER BY id DESC LIMIT 50", (p["id"],))]
            if parts[3:] == ["submissions"]:
                return self.send_json(subs)
            reports = db().execute("SELECT COUNT(*) FROM feedback WHERE kind='report' AND problem=? AND NOT resolved",
                                   (p["id"],)).fetchone()[0]
            return self.send_json({k: v for k, v in p.items() if k != "solution"}
                                  | {"sample": p["tests"][0], "tests": len(p["tests"]), "open_reports": reports,
                                     "test_rows": max((len(t["rows"]) for x in p["tests"] for t in x.get("tables", {}).values()), default=0),
                                     "last_code": subs[0]["code"] if subs else None,
                                     "solved": any(s["passed"] for s in subs)})
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path.startswith("/api/transcribe"):  # raw audio from MediaRecorder, not JSON
            n = int(self.headers.get("Content-Length", 0))
            if not 0 < n <= 25_000_000:
                return self.send_json({"error": "recording is empty or too long"}, 400)
            kind = self.headers.get("Content-Type", "")
            suffix = ".mp4" if "mp4" in kind else ".ogg" if "ogg" in kind else ".wav" if "wav" in kind else ".webm"
            return self.send_json(interview.transcribe(self.rfile.read(n), suffix))
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or "{}")
        if self.path == "/api/setup/save":
            cur = llm.load()
            provider = body.get("provider", cur["provider"])
            if provider != "ollama" and provider not in llm.PROVIDERS:
                return self.send_json({"error": "unknown provider"}, 400)
            model = str(body.get("model") or cur["model"]).strip()
            key = cur["api_key"] if body.get("api_key") is None else str(body["api_key"]).strip()  # None keeps the saved key
            signin = provider in llm.PROVIDERS and bool(body.get("signin"))  # signed in instead of a key
            if provider == "ollama" or signin:
                key = ""
            if body.get("verify", True) and not signin and (err := llm.test(provider, model, key)):  # sign-in verified itself
                return self.send_json({"error": err}, 400)
            if signin and llm.signins[provider]["status"] != "done" and not (provider == "openai" and (cur.get("openai_oauth") or {}).get("access_token")):
                return self.send_json({"error": "Sign in first."}, 400)
            extra = {"gcp_project": llm.signins["gemini"].get("project") or cur.get("gcp_project")} if signin and provider == "gemini" else {}
            llm.save(cur | {"provider": provider, "model": model, "api_key": key, "auth": "signin" if signin else "key", "setup_done": True, "coach_skipped": False} | extra)
            return self.send_json({"ok": True, "settings": llm.public()})
        if self.path == "/api/setup/models":  # the key typed in setup, else the saved one for that provider
            cur, provider = llm.load(), body.get("provider")
            if provider not in llm.PROVIDERS:
                return self.send_json({"error": "unknown provider"}, 400)
            key = (body.get("api_key") or "").strip() or (cur["api_key"] if cur["provider"] == provider else "")
            return self.send_json(llm.list_models(provider, key))
        if self.path == "/api/setup/signin":  # sign in with a Claude, ChatGPT or Google account instead of a key
            provider = body.get("provider")
            if provider not in llm.PROVIDERS:
                return self.send_json({"error": "unknown provider"}, 400)
            res = llm.start_signin(provider, body.get("project"), f"http://127.0.0.1:{self.server.server_address[1]}/auth/callback",
                                   install=bool(body.get("install")))
            if res.get("url"):
                webbrowser.open(res["url"])  # the system browser, also from the desktop app's window
            return self.send_json(res)
        if self.path == "/api/setup/skip":
            llm.save(llm.load() | {"setup_done": True, "coach_skipped": True})  # solve freely; coaches explain they are off
            return self.send_json({"ok": True})
        if self.path == "/api/setup/pyspark":
            install_pyspark()
            return self.send_json(spark_install)
        if self.path == "/api/setup/pull":
            if body.get("model") not in {m["id"] for m in llm.LOCAL_MODELS}:
                return self.send_json({"error": "unknown model"}, 400)
            llm.pull(body["model"])
            return self.send_json({"ok": True})
        if self.path == "/api/games/score":
            if body.get("game") not in {g["id"] for g in content.GAME_LIST} or not isinstance(body.get("score"), int):
                return self.send_json({"error": "bad score"}, 400)
            with db() as con:
                best = con.execute("SELECT MAX(score) FROM game_scores WHERE game=?", (body["game"],)).fetchone()[0]
                con.execute("INSERT INTO game_scores (game, score) VALUES (?, ?)", (body["game"], max(0, body["score"])))
            return self.send_json({"best": max(best or 0, body["score"]), "new_best": best is None or body["score"] > best})
        if self.path == "/api/design/done":
            with db() as con:
                if con.execute("DELETE FROM design_progress WHERE lesson=?", (body.get("lesson"),)).rowcount == 0:
                    con.execute("INSERT INTO design_progress (lesson) VALUES (?)", (body.get("lesson"),))
            return self.send_json({"ok": True})
        if self.path == "/api/coach" and body.get("lesson"):
            lesson = content.load_design()[1].get(body["lesson"])
            if not lesson:
                return self.send_json({"error": "unknown lesson"}, 404)
            return self.send_json({"reply": coach_lesson(lesson, body.get("messages", []))})
        if self.path == "/api/feedback":
            err = save_feedback(body, load_problems())
            return self.send_json({"error": err} if err else {"ok": True}, 400 if err else 200)
        if self.path == "/api/feedback/resolve":
            with db() as con:
                con.execute("UPDATE feedback SET resolved = NOT resolved WHERE id = ?", (body.get("fid"),))
            return self.send_json({"ok": True})
        if self.path == "/api/setup/whisper":
            interview.install_whisper(uv_binary)
            return self.send_json(interview.whisper_status())
        if self.path == "/api/interview/delete":  # one session by id, or every session with {"all": true}
            with db() as con:
                if body.get("all"):
                    con.execute("DELETE FROM interviews")
                else:
                    con.execute("DELETE FROM interviews WHERE id=?", (body.get("session"),))
            return self.send_json({"ok": True})
        if self.path.startswith("/api/interview/"):
            t = content.load_interview().get(body.get("track"))
            if not t:
                return self.send_json({"error": "unknown track"}, 404)
            level = body.get("level") if body.get("level") in interview.LEVELS else "mid"
            if self.path == "/api/interview/start":
                return self.send_json({"questions": interview.pick(t, level, body.get("mode", "mock"), body.get("topic"))})
            if self.path == "/api/interview/grade":
                q = t["questions"].get(body.get("id"))
                if not q:
                    return self.send_json({"error": "unknown question"}, 404)
                return self.send_json(interview.grade(t, q, str(body.get("answer", ""))[:8000], body.get("seconds")))
            if self.path == "/api/interview/finish":
                items = body.get("items") or []
                rep = interview.report(items)
                with db() as con:
                    cur = con.execute("INSERT INTO interviews (track, level, mode, topic, score, items) VALUES (?,?,?,?,?,?)",
                                      (t["id"], level, body.get("mode"), body.get("topic"), rep["score"], json.dumps(items)))
                return self.send_json({"id": cur.lastrowid, "report": rep})
        if self.path == "/api/round/start":  # pick a problem for a mock coding round
            if body.get("track") not in rounds.TRACKS:
                return self.send_json({"error": "unknown track"}, 400)
            solved = {r[0] for r in db().execute("SELECT DISTINCT problem FROM submissions WHERE passed")}
            return self.send_json(rounds.start(body["track"], body.get("level", "mid"), load_problems(), load_catalog(), solved))
        if self.path == "/api/round/grade":  # the follow-up answer, graded like an interview answer
            if body.get("followup") not in rounds.FOLLOWUPS:
                return self.send_json({"error": "unknown follow-up"}, 400)
            q = rounds.followup_question(body["followup"], body.get("level", "mid"))
            return self.send_json(interview.grade({"title": "Coding round"}, q, str(body.get("answer", ""))[:6000], body.get("seconds")))
        if self.path == "/api/round/finish":
            probs = load_problems()
            if body.get("id") not in probs:
                return self.send_json({"error": "unknown problem"}, 404)
            num = lambda k, d=0: float(body.get(k) or d)
            rep = rounds.score(min(1.0, max(0.0, num("passed_fraction"))), body.get("eff_ok"), bool(body.get("improved")),
                               num("seconds"), num("minutes", 25), int(num("hints")), num("followup_score"))
            rep |= {"title": probs[body["id"]]["title"], "track": body.get("track"), "level": body.get("level"),
                    "seconds": int(num("seconds")), "minutes": int(num("minutes", 25)), "eff_say": body.get("eff_say") or "",
                    "followup": body.get("followup_q") or "", "followup_feedback": body.get("followup_feedback") or {}}
            with db() as con:
                cur = con.execute("INSERT INTO rounds (problem, track, level, score, report) VALUES (?,?,?,?,?)",
                                  (body["id"], body.get("track"), body.get("level"), rep["total"], json.dumps(rep)))
            return self.send_json(rep | {"round": cur.lastrowid})
        p = load_problems().get(body.get("id"))
        if not p:
            return self.send_json({"error": "unknown problem"}, 404)
        if self.path == "/api/run":
            res = run(p, body["code"], body.get("engine"))
            passed = bool(res.get("results")) and all(t["passed"] for t in res["results"])
            with db() as con:
                con.execute("INSERT INTO submissions (problem, passed, code, engine) VALUES (?,?,?,?)",
                            (p["id"], passed, body["code"], res.get("engine")))
            return self.send_json(res | {"passed": passed})
        if self.path == "/api/coach":
            return self.send_json({"reply": coach(p, body.get("code", ""), body.get("result"),
                                                  body.get("stage", "build"), body.get("messages", []),
                                                  bool(body.get("solution")))})
        if self.path == "/api/round/check":  # after the tests pass: is it as efficient as the reference?
            m = execution_map(p, body.get("code", ""), body.get("engine"))
            ok, say = rounds.efficiency(p["lang"], m.get("yours"), m.get("reference"))
            return self.send_json({"ok": ok, "say": say})
        if self.path == "/api/event":  # a hint revealed or the solution opened: feeds the practice queue
            if body.get("kind") in ("hint", "solution"):
                with db() as con:
                    con.execute("INSERT INTO events (problem, kind) VALUES (?, ?)", (p["id"], body["kind"]))
            return self.send_json({"ok": True})
        if self.path == "/api/format":
            return self.send_json(format_code(p["lang"], body.get("code", ""), body.get("engine")))
        if self.path == "/api/scale":  # the map's "At scale" view: both solutions timed on grown data
            return self.send_json(execute(p, body.get("code", ""), body.get("engine") or default_engine(p["lang"]), scale=True))
        if self.path == "/api/map":
            return self.send_json(execution_map(p, body.get("code", ""), body.get("engine")))
        if self.path == "/api/explain":
            return self.send_json(explain(p))
        self.send_json({"error": "not found"}, 404)


def check(selectors=(), engine=None):
    """Validate problems: the solution passes its tests, and the starter code does not.
    With engine, instead report whether each reference solution also passes on that engine. For an emulated dialect
    the solution is first written in that dialect (sqlglot), so this measures the translation a learner relies on."""
    bad = 0
    for p in load_problems().values():
        if selectors and not {p["id"], p["pattern"], p["lang"]} & set(selectors):
            continue
        if engine:
            code = p["solution"]
            if p["lang"] == "sql" and engine in EMULATED:
                import sqlglot
                try:
                    code = ";\n".join(sqlglot.transpile(code, read="duckdb", write=engine, pretty=True))
                except Exception as e:
                    bad += 1
                    print(f"NO  {p['id']}  can't write it in {engine}: {str(e).splitlines()[0][:120]}")
                    continue
            res = run(p, code, engine)
            ok = bool(res.get("results")) and all(t["passed"] for t in res["results"])
            bad += not ok
            err = res.get("error") or next((t.get("error", "wrong result") for t in res.get("results", []) if not t["passed"]), "")
            print(f"{'ok ' if ok else 'NO '} {p['id']}" + ("" if ok else f"  {err.splitlines()[0][:150] if err else ''}"))
            continue
        res = run(p, p["solution"])
        ok = bool(res.get("results")) and all(t["passed"] for t in res["results"])
        starter = run(p, p["starter"])
        if starter.get("results") and all(t["passed"] for t in starter["results"]):
            ok, res = False, {"error": "starter code passes every test; tests are too weak"}
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} {p['lang']:8} {p['id']}" + ("" if ok else f"  {json.dumps(res)[:800]}"))
    return bad == 0
