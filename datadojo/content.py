"""Non-coding content: the Data System Design course and the brain games.

design/<id>.toml   one lesson or case study (format: see README "Data System Design")
games/*.toml       curated rounds for spot-the-bug and big-o
Generated games (guess-output, join-size) build their rounds here by running DuckDB,
so every answer is computed, never hand-written.
"""
import json, random, sys, tomllib
from pathlib import Path

ROOT = Path(__file__).parent
DESIGN, GAMES = ROOT / "design", ROOT / "games"
LANGS = ("sql", "python", "pyspark")
COMPLEXITIES = ("O(1)", "O(log n)", "O(n)", "O(n log n)", "O(n²)", "O(2ⁿ)")


def _quiz_ok(q):
    return (isinstance(q.get("options"), list) and 2 <= len(q["options"]) <= 6
            and isinstance(q.get("answer"), int) and 0 <= q["answer"] < len(q["options"]) and q.get("q"))


def parse_lesson(text, stem, sections):
    d = tomllib.loads(text)
    d.setdefault("id", stem)
    missing = {"title", "section", "order", "kind", "big_idea", "summary", "quiz"} - d.keys()
    if missing:
        raise ValueError(f"missing keys: {sorted(missing)}")
    if d["section"] not in sections:
        raise ValueError(f"unknown section {d['section']!r}")
    if d["kind"] not in ("lesson", "case_study"):
        raise ValueError("kind must be lesson or case_study")
    if not d["quiz"] or not all(_quiz_ok(q) for q in d["quiz"]):
        raise ValueError("quiz needs >=1 question, each with q, 2-6 options and a valid answer index")
    for b in d.get("blocks", []):
        if not b.get("heading") or not b.get("body"):
            raise ValueError("every [[blocks]] needs heading and body")
    return d


def load_design():
    cat = tomllib.loads((DESIGN / "catalog.toml").read_text())
    sections, out = {s["id"] for s in cat["sections"]}, {}
    for f in sorted(DESIGN.glob("*.toml")):
        if f.name == "catalog.toml":
            continue
        try:
            d = parse_lesson(f.read_text(), f.stem, sections)
        except (ValueError, KeyError, TypeError, tomllib.TOMLDecodeError) as e:
            print(f"skipping design/{f.name}: {e}", file=sys.stderr)
            continue
        out[d["id"]] = d
    return cat, dict(sorted(out.items(), key=lambda kv: ([s["id"] for s in cat["sections"]].index(kv[1]["section"]), kv[1]["order"])))


def _check_item(game, it):
    if it.get("lang") not in LANGS:
        raise ValueError(f"lang must be one of {LANGS}")
    lines = str(it.get("code", "")).strip("\n").split("\n")
    if game == "spot-bug":
        if not (isinstance(it.get("bug_line"), int) and 1 <= it["bug_line"] <= len(lines)):
            raise ValueError(f"bug_line must be 1..{len(lines)}")
        for k in ("goal", "why", "fix"):
            if not it.get(k):
                raise ValueError(f"missing {k}")
    else:
        if it.get("answer") not in COMPLEXITIES:
            raise ValueError(f"answer must be one of {COMPLEXITIES}")
        if not it.get("why"):
            raise ValueError("missing why")


def load_game_items(game):
    path = GAMES / f"{game}.toml"
    if not path.exists():
        return []
    items = []
    for i, it in enumerate(tomllib.loads(path.read_text()).get("items", [])):
        try:
            _check_item(game, it)
            items.append(it | {"code": it["code"].strip("\n")})
        except ValueError as e:
            print(f"skipping games/{game}.toml item {i + 1}: {e}", file=sys.stderr)
    return items


# ---- generated games ---------------------------------------------------------

def _duck(tables, sql):
    import duckdb
    con = duckdb.connect()
    for name, (ddl, rows) in tables.items():
        con.execute(f"CREATE TABLE {name} ({ddl})")
        if rows:
            con.executemany(f"INSERT INTO {name} VALUES ({', '.join('?' * len(rows[0]))})", rows)
    v = con.execute(sql).fetchone()[0]
    return round(float(v), 2) if isinstance(v, float) or hasattr(v, "__float__") and not isinstance(v, int) else v


def _orders(rng):
    custs = ["ann", "bo", "cy", "di"]
    n = rng.randint(5, 8)
    return [[i + 1, rng.choice(custs + [None]) if rng.random() < .2 else rng.choice(custs),
             None if rng.random() < .3 else rng.choice([5, 10, 10, 20, 30, 40])] for i in range(n)]


GUESS = [
    ("SELECT COUNT(amount) FROM orders", ["SELECT COUNT(*) FROM orders", "SELECT COUNT(DISTINCT amount) FROM orders"],
     "COUNT(col) skips NULLs; COUNT(*) counts rows."),
    ("SELECT COUNT(DISTINCT customer) FROM orders", ["SELECT COUNT(customer) FROM orders", "SELECT COUNT(DISTINCT customer) + 1 FROM orders"],
     "COUNT(DISTINCT x) ignores NULL, so a NULL customer is not a group of its own."),
    ("SELECT AVG(amount) FROM orders", ["SELECT SUM(amount) / COUNT(*) FROM orders", "SELECT AVG(COALESCE(amount, 0)) FROM orders"],
     "AVG ignores NULLs: it divides by the non-NULL count, not by all rows."),
    ("SELECT COUNT(*) FROM orders WHERE amount > 10", ["SELECT COUNT(*) FROM orders WHERE amount >= 10", "SELECT COUNT(*) FROM orders WHERE amount > 10 OR amount IS NULL"],
     "NULL > 10 is unknown, so NULL rows are filtered out."),
    ("SELECT COUNT(*) FROM orders WHERE customer NOT IN (SELECT customer FROM orders WHERE amount >= 30)",
     ["SELECT COUNT(*) FROM orders o WHERE NOT EXISTS (SELECT 1 FROM orders x WHERE x.amount >= 30 AND x.customer = o.customer)",
      "SELECT COUNT(*) FROM orders WHERE customer IS NOT NULL"],
     "If the subquery returns a NULL, NOT IN is never true. NOT EXISTS doesn't have that trap."),
    ("SELECT COUNT(*) FROM (SELECT customer FROM orders GROUP BY customer HAVING COUNT(*) > 1)",
     ["SELECT COUNT(DISTINCT customer) FROM orders", "SELECT COUNT(*) FROM (SELECT customer FROM orders GROUP BY customer)"],
     "GROUP BY keeps NULL as its own group; HAVING then filters the groups."),
    ("SELECT MAX(r) FROM (SELECT DENSE_RANK() OVER (ORDER BY amount DESC) r FROM orders WHERE amount IS NOT NULL)",
     ["SELECT MAX(r) FROM (SELECT RANK() OVER (ORDER BY amount DESC) r FROM orders WHERE amount IS NOT NULL)",
      "SELECT COUNT(*) FROM orders WHERE amount IS NOT NULL"],
     "DENSE_RANK leaves no gaps after ties; RANK does, so its max can be higher."),
    ("SELECT SUM(amount) FROM orders WHERE customer = 'ann'", ["SELECT COUNT(*) * 10 FROM orders WHERE customer = 'ann'", "SELECT SUM(COALESCE(amount, 10)) FROM orders WHERE customer = 'ann'"],
     "SUM ignores NULLs (and returns NULL if every value is NULL)."),
]


def _options(rng, answer, distractors):
    opts = {str(answer)}
    for d in distractors:
        if len(opts) < 4:
            opts.add(str(d))
    base = answer if isinstance(answer, (int, float)) else 0
    while len(opts) < 4:  # plausible neighbours only; a count or sum is never negative
        opts.add(str(max(0, base + rng.choice([-2, -1, 1, 2, 3]))))
    opts = sorted(opts, key=lambda _: rng.random())
    return opts, opts.index(str(answer))


def guess_rounds(n=25, seed=None):
    rng, out = random.Random(seed), []
    for _ in range(n):
        q, wrongs, why = rng.choice(GUESS)
        rows = _orders(rng)
        tables = {"orders": ("id INT, customer STRING, amount INT", rows)}
        ans = _duck(tables, q)
        opts, idx = _options(rng, "NULL" if ans is None else ans, ["NULL" if (v := _duck(tables, w)) is None else v for w in wrongs])
        out.append({"table": {"name": "orders", "columns": ["id", "customer", "amount"], "rows": rows},
                    "query": q, "options": opts, "answer": idx, "why": why})
    return out


JOINS = {"INNER JOIN": "INNER JOIN b USING (k)", "LEFT JOIN": "LEFT JOIN b USING (k)",
         "FULL OUTER JOIN": "FULL OUTER JOIN b USING (k)", "LEFT ANTI JOIN": "ANTI JOIN b USING (k)"}


def join_rounds(n=25, seed=None):
    rng, out = random.Random(seed), []
    for _ in range(n):
        a = [[rng.choice([1, 1, 2, 3, None])] for _ in range(rng.randint(3, 5))]
        b = [[rng.choice([1, 2, 2, 4, None])] for _ in range(rng.randint(2, 4))]
        kind = rng.choice(list(JOINS))
        tables = {"a": ("k INT", a), "b": ("k INT", b)}
        ans = _duck(tables, f"SELECT COUNT(*) FROM a {JOINS[kind]}")
        wrong = [_duck(tables, f"SELECT COUNT(*) FROM a {JOINS[k]}") for k in JOINS if k != kind]
        opts, idx = _options(rng, ans, wrong)
        out.append({"a": [r[0] for r in a], "b": [r[0] for r in b], "join": kind, "options": opts, "answer": idx,
                    "why": {"INNER JOIN": "Each matching key pair produces a row: multiply the counts per key. NULL never matches.",
                            "LEFT JOIN": "Every left row survives; matches multiply, unmatched (and NULL) left rows appear once.",
                            "FULL OUTER JOIN": "Matches multiply, plus every unmatched row from both sides once.",
                            "LEFT ANTI JOIN": "Left rows with no match on the right. NULL keys never match, so they stay."}[kind]})
    return out


GAME_LIST = [
    {"id": "guess-output", "title": "Guess the Output", "skill": "SQL semantics",
     "desc": "A tiny table and a query. What does it return? NULLs, COUNTs and ranks love to surprise you."},
    {"id": "join-size", "title": "Join Size", "skill": "Cardinality",
     "desc": "Two key columns, one join. How many rows come out? Duplicates multiply, NULLs never match."},
    {"id": "spot-bug", "title": "Spot the Bug", "skill": "Code review",
     "desc": "SQL, Python and PySpark snippets with one wrong line. Click it before the clock runs out."},
    {"id": "big-o", "title": "Big-O Sprint", "skill": "Complexity",
     "desc": "Read the snippet, call the complexity. Sixty seconds, as many as you can."},
]


def rounds(game):
    if game == "guess-output":
        return guess_rounds()
    if game == "join-size":
        return join_rounds()
    items = load_game_items(game)
    random.shuffle(items)
    return items


def check():
    """Validate design lessons and game items load; exercise the generated games."""
    cat, lessons = load_design()
    print(f"design: {len(lessons)} lessons/case studies in {len(cat['sections'])} sections")
    for s in cat["sections"]:
        print(f"  {s['id']:22} {sum(d['section'] == s['id'] for d in lessons.values())}")
    for g in ("spot-bug", "big-o"):
        print(f"games/{g}: {len(load_game_items(g))} items")
    for fn in (guess_rounds, join_rounds):
        rs = fn(40, seed=1)
        assert all(len(set(r["options"])) == 4 and 0 <= r["answer"] < 4 for r in rs), fn.__name__
        print(f"{fn.__name__}: 40 rounds ok")


if __name__ == "__main__":
    check()
