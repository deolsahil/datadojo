"""DataDojo server: JSON API + static UI. Start it with the `datadojo` command (see __main__.py)."""
import atexit, datetime, functools, hashlib, json, os, shutil, sqlite3, subprocess, sys, tempfile, threading, tomllib, urllib.request
from collections import Counter
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from datadojo import content, llm
from datadojo.paths import DATA_HOME

ROOT = Path(__file__).parent          # read-only app files (problems, static, ...)
PROBLEMS = ROOT / "problems"
TIMEOUT = {"sql": 15, "python": 15, "pyspark": 180}  # spark JVM cold start ~10s
DIFFICULTIES = ("easy", "medium", "hard")
REQUIRED = {"title", "lang", "difficulty", "pattern", "statement", "starter", "solution", "tests"}


def load_catalog():
    return tomllib.loads((PROBLEMS / "catalog.toml").read_text())


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
            python.append({"id": v, "label": sh(path, "--version") or f"Python {v}", "kind": "native", "path": path})

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
            _release["data"] = {"tag": r["tag_name"], "url": r["html_url"]}
        except Exception:
            _release["data"] = None
    latest = (_release["data"] or {}).get("tag", "").lstrip("v")
    newer = bool(latest) and tuple(map(int, latest.split("."))) > tuple(map(int, __version__.split(".")))
    return {"version": __version__, "latest": latest or None, "update": newer, "url": (_release["data"] or {}).get("url")}


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


def execute(p, code, engine):
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
    # ponytail: fresh process + timeout only, no memory cap/sandbox; fine for your own code on your own machine
    with tempfile.TemporaryDirectory() as tmp:
        req, res = Path(tmp) / "request.json", Path(tmp) / "result.json"
        req.write_text(json.dumps({"problem": p, "code": code, "engine": engine}), encoding="utf-8")
        # a frozen desktop build has no python to call: it re-runs itself in runner mode
        cmd = ([sys.executable, "--runner"] if python == sys.executable and getattr(sys, "frozen", False)
               else [python, "-I", str(ROOT / "runner.py")])
        try:
            r = subprocess.run(cmd + [str(req), str(res)], cwd=tmp, env=env, capture_output=True, text=True,
                               timeout=TIMEOUT[lang], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.TimeoutExpired:
            return {"error": f"Timed out after {TIMEOUT[lang]}s"}
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
    if "error" in got:
        return got | {"engine": engine}
    results = []
    for i, (t, e, g) in enumerate(zip(p["tests"], exp["outputs"], got["outputs"])):
        r = {"test": i + 1, "input": t.get("tables") or t.get("args")}
        if "error" in e:
            r.update(passed=False, error="reference solution failed: " + e["error"])
        else:
            r["expected"] = clip(e["value"])
            if "error" in g:
                r.update(passed=False, error=g["error"])
            else:
                r.update(got=clip(g["value"]), passed=same(g["value"], e["value"], p.get("ordered", False)))
        results.append(r)
    return {"results": results, "stdout": got.get("stdout", ""), "translated": got.get("translated"), "engine": engine}


STAGES = {
    "understand": "Check they understand the problem: inputs, output shape, edge cases. Ask them to restate it.",
    "approach": "Help them pick an approach in words or pseudocode before code. Ask what pattern applies.",
    "build": "They are writing code. Point at bugs or missing cases in their code. Never write the solution.",
    "edge-cases": "Push on edge cases: NULLs, ties, duplicates, empty input, boundaries. Ask which they handle.",
    "optimize": "Discuss cost: complexity, shuffles/joins in Spark, indexes/scans in SQL, and cleaner idioms.",
    "review": "They solved it. Review the code briefly, name the pattern, and suggest one related problem idea.",
}


def coach(p, code, result, stage, messages):
    system = f"""You are Sensei, a coach for SQL, Python and PySpark interview practice. The learner
wants to build skill, not be handed answers. Reply in at most 5 short sentences, ask one question at a
time, and never write the full solution (small snippets of syntax are fine).
Current stage: {stage}. {STAGES.get(stage, '')}

Problem ({p['lang']}, {p['difficulty']}): {p['title']}
{p['statement']}

Learner's current code:
{code}

Latest test run (may be empty):
{json.dumps(result)[:2500]}"""
    return chat(system, messages)


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
        if parts[1:] == ["setup"]:
            return self.send_json({"settings": llm.public(), "ollama": llm.ollama_status(),
                                   "local_models": llm.LOCAL_MODELS, "providers": llm.PROVIDERS})
        if parts[1:] == ["version"]:
            return self.send_json(latest_release())
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
                                     "last_code": subs[0]["code"] if subs else None,
                                     "solved": any(s["passed"] for s in subs)})
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or "{}")
        if self.path == "/api/setup/save":
            cur = llm.load()
            provider = body.get("provider", cur["provider"])
            if provider != "ollama" and provider not in llm.PROVIDERS:
                return self.send_json({"error": "unknown provider"}, 400)
            model = str(body.get("model") or cur["model"]).strip()
            key = cur["api_key"] if body.get("api_key") is None else str(body["api_key"]).strip()  # None keeps the saved key
            if provider == "ollama":
                key = ""
            if body.get("verify", True) and (err := llm.test(provider, model, key)):
                return self.send_json({"error": err}, 400)
            llm.save(cur | {"provider": provider, "model": model, "api_key": key, "setup_done": True})
            return self.send_json({"ok": True, "settings": llm.public()})
        if self.path == "/api/setup/skip":
            llm.save(llm.load() | {"setup_done": True})
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
                                                  body.get("stage", "build"), body.get("messages", []))})
        self.send_json({"error": "not found"}, 404)


def check(selectors=(), engine=None):
    """Validate problems: the solution passes its tests, and the starter code does not.
    With engine, instead report whether each reference solution also passes on that engine."""
    bad = 0
    for p in load_problems().values():
        if selectors and not {p["id"], p["pattern"], p["lang"]} & set(selectors):
            continue
        if engine:
            res = run(p, p["solution"], engine)
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
