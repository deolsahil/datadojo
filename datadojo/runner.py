"""Runs one piece of code over every test of a problem, in a fresh process.

usage:  runner.py REQUEST.json RESULT.json
request {"problem": {...}, "code": "...", "engine": "duckdb"}
result  {"outputs": [{"value": ...} | {"error": "..."}], "stdout": "...", "translated": "..."?}
Files rather than stdin/stdout: a windowed desktop build has no console streams.

Grading happens in server.py. This file must stay stdlib-only at import time: it is also
run by other Python versions and other PySpark environments.
"""
import contextlib, copy, datetime, io, json, math, os, re, sys, traceback, uuid


def norm(v, sql=False):
    if isinstance(v, bool):
        return int(v) if sql else v  # SQLite has no booleans; compare SQL results as 0/1
    if isinstance(v, float):
        return round(v, 6)
    if isinstance(v, datetime.datetime):
        return v.isoformat(sep=" ")
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, (list, tuple)):
        return [norm(x, sql) for x in v]
    if isinstance(v, dict):
        return {k: norm(x, sql) for k, x in v.items()}
    if hasattr(v, "__float__") and not isinstance(v, int):  # Decimal
        return round(float(v), 6)
    return v


def columns(ddl):
    """[(name, type)] from "a INT, b DECIMAL(3, 1)": commas inside parentheses belong to the type."""
    return [tuple(c.strip().split(None, 1)) for c in re.split(r",(?![^()]*\))", ddl)]


def rows_of(cur):
    """(rows, column names) of a finished query."""
    cols = [getattr(d, "name", None) or d[0] for d in cur.description or []]
    return [norm(list(r), sql=True) for r in cur.fetchall()], cols


# --- SQL engines ------------------------------------------------------------

def load_dbapi(con, tables, ddl_map=lambda s: s, mark="?"):
    for name, t in tables.items():
        con.execute(f"CREATE TABLE {name} ({ddl_map(t['columns'])})")
        if t["rows"]:
            marks = ", ".join([mark] * len(t["rows"][0]))
            con.executemany(f"INSERT INTO {name} VALUES ({marks})", t["rows"])


def sql_duckdb(query, tables):
    import duckdb
    con = duckdb.connect()
    load_dbapi(con, tables)
    return rows_of(con.execute(query))


def sql_sqlite(query, tables):
    import sqlite3
    con = sqlite3.connect(":memory:")
    load_dbapi(con, tables)
    return rows_of(con.execute(query))


def pg_types(ddl):
    return re.sub(r"\bDOUBLE\b", "DOUBLE PRECISION", re.sub(r"\bSTRING\b", "TEXT", ddl, flags=re.I), flags=re.I)


def sql_postgres(query, tables):
    import psycopg
    schema = "run_" + uuid.uuid4().hex[:12]
    with psycopg.connect(host=os.environ["DOJO_PG_HOST"], port=os.environ["DOJO_PG_PORT"],
                         user="dojo", dbname="postgres", autocommit=True) as con:
        con.execute(f"CREATE SCHEMA {schema}")
        try:
            con.execute(f"SET search_path TO {schema}")
            con.execute("SET statement_timeout = '10s'")
            with con.cursor() as cur:
                for name, t in tables.items():
                    cur.execute(f"CREATE TABLE {name} ({pg_types(t['columns'])})")
                    if t["rows"]:
                        marks = ", ".join(["%s"] * len(t["rows"][0]))
                        cur.executemany(f"INSERT INTO {name} VALUES ({marks})", t["rows"])
                cur.execute(query)
                return rows_of(cur)
        finally:
            con.execute(f"DROP SCHEMA {schema} CASCADE")


def sql_spark(query, tables):
    for name, t in tables.items():
        spark_df(t).createOrReplaceTempView(name)
    df = spark().sql(query)
    return [norm(list(r), sql=True) for r in df.collect()], df.columns


TRANSLATED = []


def to_duckdb(query, dialect, tables):
    """Translate another dialect to DuckDB with sqlglot, patching gaps it leaves that learners hit:
    - a CTE that refers to itself is recursive (T-SQL, Oracle and Snowflake don't write RECURSIVE; DuckDB needs it)
    - in T-SQL, `+` between text values joins strings (sqlglot keeps it as arithmetic)"""
    import sqlglot
    from sqlglot import exp
    text_cols = {c.lower() for t in tables.values() for c, typ in columns(t["columns"])
                 if re.match(r"(string|n?varchar|text|n?char)", typ, re.I)}
    str_funcs = tuple(f for f in (getattr(exp, n, None) for n in ("Upper", "Lower", "Substring", "Trim", "Concat", "Left",
                                                                    "Right", "Replace", "DPipe", "Initcap")) if f)

    def is_text(e):
        if isinstance(e, exp.Literal):
            return e.is_string
        if isinstance(e, exp.Column):
            return e.name.lower() in text_cols
        if isinstance(e, exp.Cast):
            return e.to.is_type(*exp.DataType.TEXT_TYPES)
        if isinstance(e, (exp.Add, exp.Paren)):
            return any(is_text(x) for x in (e.this, e.args.get("expression")) if x is not None)
        return isinstance(e, str_funcs)

    out = []
    for tree in sqlglot.parse(query, read=dialect):
        if tree is None:
            continue
        for w in tree.find_all(exp.With):
            if any(t.name.lower() == c.alias_or_name.lower() for c in w.expressions for t in c.this.find_all(exp.Table)):
                w.set("recursive", True)
        if dialect == "tsql":
            for add in list(tree.find_all(exp.Add)):
                if is_text(add.this) or is_text(add.expression):
                    add.replace(exp.DPipe(this=add.this, expression=add.expression))
        out.append(tree.sql(dialect="duckdb"))
    return ";\n".join(out)


def sql_emulated(dialect):
    def run(query, tables):
        sql = to_duckdb(query, dialect, tables)
        if not TRANSLATED:
            TRANSLATED.append(sql)
        return sql_duckdb(sql, tables)
    return run


SQL = {"duckdb": sql_duckdb, "sqlite": sql_sqlite, "postgres": sql_postgres, "spark-sql": sql_spark}


# --- PySpark ----------------------------------------------------------------

_spark = None


def spark():
    global _spark
    if _spark is None:
        from pyspark.sql import SparkSession
        _spark = (SparkSession.builder.master("local[2]").appName("datadojo")
                  .config("spark.ui.enabled", "false")
                  .config("spark.sql.shuffle.partitions", "2")
                  .getOrCreate())
        _spark.sparkContext.setLogLevel("ERROR")
    return _spark


def spark_df(t):
    import decimal
    casts = {"DATE": datetime.date.fromisoformat, "TIMESTAMP": datetime.datetime.fromisoformat,
             "DECIMAL": lambda v: decimal.Decimal(str(v))}  # Spark won't put a float into a DECIMAL column
    conv = [casts.get(typ.split("(")[0].strip().upper()) for _, typ in columns(t["columns"])]
    rows = [tuple(f(v) if f and v is not None else v for f, v in zip(conv, r)) for r in t["rows"]]
    return spark().createDataFrame(rows, schema=t["columns"])


# --- execution map ------------------------------------------------------------
# After a solve, the code runs once more on the first test and we describe what the engine did:
# {"nodes": [...plan steps], "stats": {...}, "notes": [...]}; Python returns "lines" (per-line hit counts) instead.

SPARK_SKIP = ("WholeStageCodegen", "InputAdapter", "ColumnarToRow", "AdaptiveSparkPlan", "AQEShuffleRead")


def spark_node(name, s):
    """(label, detail, class) for one physical operator. class: source narrow wide shuffle warn."""
    args = s[len(name):].strip()
    inner = re.search(r"\[(.*?)\]", args)
    inner = inner.group(1) if inner else args
    if name.startswith("Scan") or name in ("LocalTableScan", "RDDScan"):
        return "Read table", inner, "source"
    if name == "Filter":
        return "Filter", args, "narrow"
    if name == "Project":
        return "Select columns", inner, "narrow"
    if name.endswith("Aggregate"):
        keys = re.search(r"keys=\[(.*?)\]", s)
        funcs = re.search(r"functions=\[(.*?)\]", s)
        keys, funcs = keys.group(1) if keys else "", funcs.group(1) if funcs else ""
        if "partial_" in funcs or (not funcs and "merge_" in s):
            return "Partial aggregate", f"pre-combines each partition before the shuffle · {funcs or keys}", "narrow"
        if not funcs:
            return "Distinct", keys, "wide"
        return "Aggregate", f"by {keys} · {funcs}" if keys else funcs, "wide"
    if name == "Exchange":
        if "SinglePartition" in s:
            return "Shuffle to 1 partition", "every row moves to one task", "warn"
        if "rangepartitioning" in s:
            return "Shuffle for global sort", inner, "shuffle"
        if "RoundRobin" in s:
            return "Repartition", "rows spread evenly", "shuffle"
        keys = re.search(r"hashpartitioning\((.*), \d+\)", s)
        return "Shuffle", "by " + (keys.group(1) if keys else args), "shuffle"
    if name == "BroadcastExchange":
        return "Broadcast", "small side copied to every executor", "shuffle"
    if name in ("SortMergeJoin", "ShuffledHashJoin"):
        return ("Sort-merge join" if name == "SortMergeJoin" else "Shuffled hash join"), args, "wide"
    if name == "BroadcastHashJoin":
        return "Broadcast join", args, "narrow"
    if name in ("BroadcastNestedLoopJoin", "CartesianProduct"):
        return "Nested-loop join", "compares every row with every row", "warn"
    if name == "Window":
        part = re.search(r"windowspecdefinition\((.*?)(?:,\s*specifiedwindowframe|\))", s)
        return "Window", "over " + (part.group(1) if part else "…"), "wide"
    if name == "Sort":
        return ("Global sort", inner, "wide") if s.rstrip().endswith(("true, 0", "true")) else ("Sort in partition", inner, "narrow")
    if name in ("TakeOrderedAndProject", "CollectLimit", "GlobalLimit", "LocalLimit"):
        return ("Top N" if name == "TakeOrderedAndProject" else "Limit"), args, "narrow"
    if name in ("BatchEvalPython", "ArrowEvalPython", "FlatMapGroupsInPandas", "MapInPandas"):
        return "Python UDF", "rows leave the JVM for Python", "warn"
    if name == "Generate":
        return "Explode", args, "narrow"
    if name == "Expand":
        return "Expand", "one input row becomes several (rollup / count distinct)", "narrow"
    return name, args, "narrow"


WHY = {
    "source": "Reads the input rows. Every stage that touches this table starts here.",
    "narrow": "Narrow: each partition is processed on its own, no data moves between machines. Cheap.",
    "wide": "Wide: needs rows with the same key together, so a shuffle happens right before it.",
    "shuffle": "Shuffle: rows are written to disk and sent over the network to the partition that owns their key. "
               "This ends one stage and starts the next. The most expensive thing Spark does.",
    "warn": "Watch out: this step is a common cause of slow jobs at scale. See the notes.",
}


MINOR = ("Select columns", "Sort in partition", "Partial aggregate")  # hidden in "Key steps": real, but not the story


def short_of(n):
    """One short line under a box: the key fact, never raw plan syntax."""
    label, d = n["label"], re.sub(r"(?<=\w)#\d+L?", "", str(n["detail"]))
    find = lambda pat: (re.search(pat, d) or [None, ""])[1].strip()
    if label == "Read table":
        out = find(r"Table: ([\w.]+)") or d.replace(",", ", ")
    elif label == "Filter":
        out = find(r"Expression: (.*?)(?: · |$)") or d
        out = re.sub(r"\(?isnotnull\([^)]*\)\)?(\s+AND\s+)?", "", out).strip()
        out = re.sub(r"^\((.*)\)$", r"\1", out)
    elif label in ("Aggregate", "Distinct"):
        out = d.split(" · ")[0]
    elif label == "Group by":
        out = find(r"Aggregates: (.*?)(?: · |$)")
    elif label.endswith("join"):
        kind = find(r"Join Type: (\w+)") or find(r"\], (\w+)")
        cond = find(r"Conditions: (.*?)(?: · |$)") or find(r"^\[(.*?)\]")
        out = f"{kind.title()} on {cond}" if cond else kind.title()
    else:
        out = d
    return "" if re.search(r"#\d", out) else out


def graph_map(nodes, edges, group=None):
    """nodes: [{label, detail, cls, rows?}], edges: [(child, parent)], group: {node: stage}. Node 0 is the root.
    Returns per-node data; the app lays out the cards, and folds "minor" steps away in its Compact view."""
    group = group or {}
    out = []
    for i, n in enumerate(nodes):
        short = short_of(n)
        out.append({"label": n["label"], "short": short, "detail": re.sub(r"(?<=\w)#\d+L?", "", str(n["detail"])),
                    "cls": n["cls"], "rows": n.get("rows"), "ms": n.get("ms"), "group": group.get(i),
                    "minor": n["label"] in MINOR or (n["label"] == "Filter" and not short),
                    "warn": n.get("warn") or WARN.get(n["label"]) if n["cls"] == "warn" else None,
                    "why": n.get("why") or WHY.get(n["cls"], ""), "inputs": [a for a, b in edges if b == i],
                    "data": n.get("data")})
    return {"nodes": out}


WARN = {"Shuffle to 1 partition": "All rows on one task", "Python UDF": "Row-by-row Python",
        "Nested-loop join": "Rows × rows", "Cross join": "Rows × rows", "Correlated subquery": "Runs per row"}


SPARK_NOTES = {
    "Shuffle to 1 partition": "All rows were pulled into a single partition (a window with no partitionBy, or a "
                              "global aggregate or sort). Fine for small results, a bottleneck at scale.",
    "Python UDF": "A Python UDF ships every row to a Python process and back. Built-in pyspark.sql.functions run "
                  "inside the JVM and are much faster.",
    "Nested-loop join": "This join compares every row with every row (no equality key). It grows as rows × rows.",
    "Sort-merge join": "At scale both sides of a sort-merge join are shuffled. If one side is small, "
                       "F.broadcast(small_df) sends it to every executor and skips that shuffle.",
}
SPARK_NOTES["Shuffled hash join"] = SPARK_NOTES["Sort-merge join"]


SAMPLE = 50  # rows kept per step for the "click a row count" table


def spark_rows(n):
    """Rows a physical operator outputs, by running just that subtree. None if it can't run alone (broadcast)."""
    import datetime as dt
    try:
        sch = n.schema()
        fields = [(f.name(), f.dataType().typeName()) for f in sch.fields()]
        got = n.executeCollect()
    except Exception:
        return None

    def py(v, typ):
        if v is None:
            return None
        if typ == "date":
            return str(dt.date(1970, 1, 1) + dt.timedelta(days=v))
        if typ.startswith("timestamp"):
            return str(dt.datetime(1970, 1, 1) + dt.timedelta(microseconds=v))
        if hasattr(v, "_get_object_id"):  # UTF8String, Decimal, arrays: their Scala toString
            return v.toString()
        return round(v, 6) if isinstance(v, float) else v
    rows = []
    for r in list(got)[:SAMPLE]:
        sq = r.toSeq(sch)
        rows.append([py(sq.apply(i), fields[i][1]) for i in range(sq.size())])
    return {"cols": [c for c, _ in fields], "rows": rows, "total": len(got)}


def spark_map(df):
    """Physical plan of a DataFrame, planned as at scale: no AQE, no automatic broadcasts."""
    df.collect()  # run it so operators report row counts
    nodes, edges, stage_of, jvm = [], [], {}, []
    counter = [0]

    def walk(n, stage):  # returns the node id of the first real operator at or below n
        name = n.nodeName()
        kids = [n.children().apply(i) for i in range(n.children().size())]
        if name.startswith(SPARK_SKIP) and len(kids) == 1:
            return walk(kids[0], stage)
        label, detail, cls = spark_node(name, n.simpleString(25))
        nid = len(nodes)
        nodes.append({"label": label, "detail": detail, "cls": cls})
        jvm.append(n)
        if name in ("Exchange", "BroadcastExchange"):  # stage boundary
            counter[0] += 1
        else:
            stage_of[nid] = stage
        child = [walk(k, counter[0] if nid not in stage_of else stage) for k in kids]
        m = n.metrics().get("numOutputRows")
        nodes[nid]["rows"] = m.get().value() if m.isDefined() else (nodes[child[0]]["rows"] if len(child) == 1 else None)
        edges.extend((c, nid) for c in child)
        return nid

    walk(df._jdf.queryExecution().executedPlan(), 0)
    for n, j in zip(nodes, jvm):  # only after every row count is read: re-running a step adds to its counters
        n["data"] = d = spark_rows(j)
        if d and n["rows"] != d["total"]:
            if n["rows"] is None or d["total"] < n["rows"]:
                n["rows"] = d["total"]  # extra jobs (a global sort samples its input first) inflate Spark's counters
            else:
                n["data"] = None  # running this step alone didn't reproduce it; better no table than a wrong one
    # the deepest stage runs first, so number stages bottom-up
    num = {s: i + 1 for i, s in enumerate(sorted(set(stage_of.values()), reverse=True))}
    res = graph_map(nodes, edges, {i: num[s] for i, s in stage_of.items()})
    res["stats"] = {"Stages": len(num), "Shuffles": sum(n["label"].startswith("Shuffle") or n["label"] == "Repartition" for n in nodes),
                    "Wide steps": sum(n["cls"] == "wide" for n in nodes)}
    res["notes"] = sorted({SPARK_NOTES[n["label"]] for n in nodes if n["label"] in SPARK_NOTES})
    return res


DUCK = {  # operator type: (label, class); class "wide" = blocking: must read all its input before passing rows on
    "TABLE_SCAN": ("Read table", "source"), "SEQ_SCAN": ("Read table", "source"), "COLUMN_DATA_SCAN": ("Read values", "source"),
    "DUMMY_SCAN": ("No table", "source"), "CTE_SCAN": ("Read CTE", "source"), "DELIM_SCAN": ("Reuse outer rows", "source"),
    "FILTER": ("Filter", "narrow"), "PROJECTION": ("Select columns", "narrow"), "UNNEST": ("Unnest", "narrow"),
    "STREAMING_LIMIT": ("Limit", "narrow"), "LIMIT": ("Limit", "narrow"), "UNION": ("Union", "narrow"),
    "HASH_JOIN": ("Hash join", "wide"), "PIECEWISE_MERGE_JOIN": ("Range join", "wide"), "IE_JOIN": ("Range join", "wide"),
    "NESTED_LOOP_JOIN": ("Nested-loop join", "warn"), "BLOCKWISE_NL_JOIN": ("Nested-loop join", "warn"),
    "CROSS_PRODUCT": ("Cross join", "warn"), "LEFT_DELIM_JOIN": ("Correlated subquery", "warn"),
    "RIGHT_DELIM_JOIN": ("Correlated subquery", "warn"), "DELIM_JOIN": ("Correlated subquery", "warn"),
    "HASH_GROUP_BY": ("Group by", "wide"), "PERFECT_HASH_GROUP_BY": ("Group by", "wide"),
    "UNGROUPED_AGGREGATE": ("Aggregate (whole table)", "wide"), "SIMPLE_AGGREGATE": ("Aggregate (whole table)", "wide"),
    "WINDOW": ("Window", "wide"), "STREAMING_WINDOW": ("Window (streaming)", "narrow"),
    "ORDER_BY": ("Sort", "wide"), "TOP_N": ("Top N", "wide"), "CTE": ("CTE", "narrow"),
}
SQL_WHY = {
    "source": "Reads the input rows.",
    "narrow": "Streaming: rows flow through one batch at a time, nothing has to wait. Cheap.",
    "wide": "Blocking: must see all its input before it can output anything (it builds a hash table or sorts), "
            "so a new pipeline starts below it. Cost grows with the rows coming in, so filter early.",
    "warn": "Watch out: this step can compare every row with every row. See the notes.",
}
SQL_NOTES = {
    "Nested-loop join": "A nested-loop join compares every row on one side with every row on the other "
                        "(usually a join condition without '='). It grows as rows × rows.",
    "Cross join": "A cross join pairs every row with every row. Make sure that's intended.",
    "Correlated subquery": "A correlated subquery depends on the outer row. DuckDB rewrites it into a join, "
                           "but in many engines it runs once per row; a join or window is usually clearer.",
}
CLAUSES = [("from", "FROM"), ("joins", "JOIN"), ("where", "WHERE"), ("group", "GROUP BY"), ("having", "HAVING"),
           ("windows", "WINDOW"), ("select", "SELECT"), ("distinct", "DISTINCT"), ("order", "ORDER BY"), ("limit", "LIMIT")]


def clause_order(sql):
    """Clauses of the outermost SELECT in the order the database logically runs them."""
    try:
        import sqlglot
        from sqlglot import exp
        tree = sqlglot.parse_one(sql, read="duckdb")
        sel = tree if isinstance(tree, exp.Select) else tree.find(exp.Select)
        if sel is None:
            return []
        has = {k for k, _ in CLAUSES if sel.args.get(k) or sel.args.get(k + "_")} | {"select"}
        if any(e.find(exp.Window) for e in sel.expressions):
            has.add("windows")
        return [name for k, name in CLAUSES if k in has]
    except Exception:
        return []


def duck_rows(con, sql):
    cur = con.execute(sql)
    got = cur.fetchall()
    return {"cols": [c[0] for c in cur.description], "rows": [norm(list(r), sql=True) for r in got[:SAMPLE]], "total": len(got)}


def duck_map(query, tables):
    import duckdb
    con = duckdb.connect()
    load_dbapi(con, tables)
    tree = json.loads(con.execute("EXPLAIN (ANALYZE, FORMAT JSON) " + query).fetchall()[0][1])
    nodes, edges, pipe = [], [], {}
    counter = [0]

    def walk(n, pl):
        t = n.get("operator_type") or n.get("type") or n.get("operator_name") or "?"
        kids = n.get("children", [])
        internal = t == "PROJECTION" and "__internal_" in json.dumps(n.get("extra_info"))  # DuckDB's string compression
        if (internal or t in ("RESULT_COLLECTOR", "EXPLAIN_ANALYZE", "QUERY")) and len(kids) == 1:
            return walk(kids[0], pl)
        label, cls = DUCK.get(t, (t.replace("_", " ").title(), "narrow"))
        info = {k: v for k, v in (n.get("extra_info") or {}).items() if k not in ("Estimated Cardinality", "Type")}
        detail = " · ".join(f"{k}: {', '.join(v) if isinstance(v, list) else v}" for k, v in info.items()).replace("memory.main.", "")
        nid = len(nodes)
        data = None
        if cls == "source" and info.get("Table"):  # the scan with DuckDB's own pushed-down columns and filters
            cols = info.get("Projections") or ["*"]
            cols = ", ".join(cols) if isinstance(cols, list) else cols
            filt = info.get("Filters")
            filt = " AND ".join(filt) if isinstance(filt, list) else filt
            for where in ([f" WHERE {filt}"] if filt else []) + [""]:
                try:
                    data = duck_rows(con, f"SELECT {cols} FROM {info['Table'].split('.')[-1]}{where}")
                    break
                except Exception:
                    pass
        nodes.append({"label": label, "detail": detail, "cls": cls, "data": data,
                      "rows": n.get("operator_cardinality", n.get("intermediate_rows")),
                      "ms": round((n.get("operator_timing", n.get("timing")) or 0) * 1000, 3)})
        pipe[nid] = pl
        for i, k in enumerate(kids):
            new = cls in ("wide", "warn") and not (label.endswith("join") and i == 0)  # a join's probe side streams through
            if new:
                counter[0] += 1
            edges.append((walk(k, counter[0] if new else pl), nid))
        return nid

    walk(tree["operator"][0] if isinstance(tree.get("operator"), list) else tree, 0)
    try:
        nodes[0]["data"] = duck_rows(con, query)  # the root step outputs the query result
    except Exception:
        pass
    for i, n in enumerate(nodes):  # DuckDB reports 0 rows for a union, which only forwards its inputs
        if n["label"] == "Union" and not n["rows"]:
            n["rows"] = sum(nodes[a]["rows"] or 0 for a, b in edges if b == i)
    for i, n in enumerate(nodes):  # a step that outputs far more rows than its biggest input: a join blow-up
        ins = [nodes[a]["rows"] or 0 for a, b in edges if b == i]
        if n["label"].endswith("join") and ins and (n["rows"] or 0) > 2 * max(ins) and (n["rows"] or 0) > 10:
            n["cls"], n["warn"], n["why"] = "warn", "Row explosion", f"This join outputs {n['rows']:,} rows from inputs of {', '.join(map(str, ins))}: " \
                "a key matches many rows on both sides. Check the join keys, or aggregate before joining."
            SQL_NOTES.setdefault("blowup", "A join produced many more rows than went in (a row explosion). "
                                 "Usually a missing join key or a many-to-many match.")
            n["note"] = "blowup"
    for n in nodes:
        n["why"] = n.get("why") or SQL_WHY[n["cls"]]
    num = {s: i + 1 for i, s in enumerate(sorted(set(pipe.values()), reverse=True))}
    res = graph_map(nodes, edges, {i: num[s] for i, s in pipe.items()})
    res["stats"] = {"Pipelines": len(num), "Blocking steps": sum(n["cls"] == "wide" for n in nodes),
                    "Rows read": sum(n["rows"] or 0 for n in nodes if n["cls"] == "source"),
                    "Peak rows": max((n["rows"] or 0 for n in nodes), default=0)}
    res["notes"] = sorted({SQL_NOTES[n.get("note") or n["label"]] for n in nodes if (n.get("note") or n["label"]) in SQL_NOTES})
    res["order"] = clause_order(query)
    return res


def size_of(args):
    """Rough input size n: total length of sized arguments, else the biggest int."""
    sized = [len(a) for a in args if hasattr(a, "__len__")]
    return sum(sized) if sized else max((abs(a) for a in args if isinstance(a, int)), default=0)


def python_map(p, code):
    """Line heat map over every test, and steps per input size to estimate growth."""
    import math
    hits, per_test, MAX = {}, [], 2_000_000  # ponytail: step cap keeps tracing bounded; slow code is still mapped up to it
    ns = {}
    exec(compile(code, "<solution>", "exec"), ns)
    fn = ns[p["function"]]
    for test in p["tests"]:
        args = copy.deepcopy(test["args"])
        steps = [0]

        def tracer(frame, event, arg):
            if frame.f_code.co_filename != "<solution>":
                return None
            if event == "line" and steps[0] < MAX:
                steps[0] += 1
                hits[frame.f_lineno] = hits.get(frame.f_lineno, 0) + 1
            return tracer
        sys.settrace(tracer)
        try:
            fn(*args)
        except Exception:
            pass
        finally:
            sys.settrace(None)
        per_test.append((size_of(test["args"]), steps[0]))
    pts = sorted({(n, st) for n, st in per_test if n > 1 and st > 0})
    growth = None
    if len({n for n, _ in pts}) >= 3:  # log-log slope of steps against n
        xs, ys = [math.log(n) for n, _ in pts], [math.log(st) for _, st in pts]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        var = sum((x - mx) ** 2 for x in xs)
        k = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var if var else 0
        growth = "O(1)" if k < 0.3 else "O(log n)" if k < 0.7 else "O(n)" if k < 1.4 else "O(n²)" if k < 2.5 else "O(n³) or worse"
    total = sum(st for _, st in per_test)
    notes = []
    if hits:
        line, cnt = max(hits.items(), key=lambda kv: kv[1])
        big = max((n for n, _ in per_test), default=0)
        notes.append(f"Line {line} is the hottest: it ran {cnt:,} times across all tests.")
        if big > 3 and cnt > big * big / 2:
            notes.append(f"That's more than n² / 2 for the biggest test (n = {big}): usually a loop inside a loop. "
                         "A dict or set lookup often replaces the inner loop.")
    if total >= MAX:
        notes.append("Stopped counting at 2,000,000 steps.")
    stats = {"Steps": total, "Hottest line runs": max(hits.values(), default=0)}
    if growth:
        stats["Grows like"] = growth
    return {"kind": "python", "code": code, "lines": hits, "stats": stats, "notes": notes,
            "tests": [{"n": n, "steps": st} for n, st in per_test]}


def spark_for_map():
    s = spark()
    s.conf.set("spark.sql.adaptive.enabled", "false")  # show the plan as written, not as AQE re-tuned it for tiny data
    s.conf.set("spark.sql.autoBroadcastJoinThreshold", "-1")  # tiny test tables would broadcast every join
    return s


def make_map(p, code, engine):
    test = p["tests"][0]
    if p["lang"] == "pyspark":
        ns = {}
        exec(code, ns)
        s = spark_for_map()
        return spark_map(ns[p["function"]](s, **{name: spark_df(t) for name, t in test["tables"].items()}))
    if p["lang"] == "sql" and engine == "spark-sql":
        spark_for_map()
        for name, t in test["tables"].items():
            spark_df(t).createOrReplaceTempView(name)
        return spark_map(spark().sql(code))
    if p["lang"] == "sql":
        res = {}
        if engine not in ("duckdb", None):  # every other engine is mapped on DuckDB, translating its dialect first
            import sqlglot
            code = ";\n".join(sqlglot.transpile(code, read=engine, write="duckdb"))
            res["notes"] = [f"Mapped on DuckDB (your query was translated from {engine})."]
        out = duck_map(code, test["tables"])
        out["notes"] = res.get("notes", []) + out["notes"]
        return out
    if p["lang"] == "python":
        return python_map(p, code)
    return {"error": "No execution map for this language yet."}


# --- at scale ------------------------------------------------------------------
# The biggest test, grown to real sizes and timed for your code and the reference in this one process.
# Each extra copy of the data gets shifted ids and suffixed keys, so joins stay one-to-one inside a copy
# instead of exploding, and (for Python) the original copy goes last so a search can't stop early.
# ponytail: copies of the test data, not realistic distributions; enough to show how the work grows

DATE_LIKE = re.compile(r"^\d{4}-\d{2}-\d{2}")
SCALE = {"python": ([1_000, 4_000, 16_000, 64_000, 256_000], 0.3), "sql": ([10_000, 100_000, 1_000_000, 10_000_000], 2.0),
         "pyspark": ([10_000, 100_000, 1_000_000], 4.0)}  # target sizes; a side stops once a run takes longer than this


def _int_span(v):
    """Largest |int| anywhere in v, so shifted copies never collide with the original values."""
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)):
        return abs(v)
    if isinstance(v, (list, tuple)):
        return max((_int_span(x) for x in v), default=0)
    if isinstance(v, dict):
        return max((_int_span(x) for x in list(v) + list(v.values())), default=0)
    return 0


def _shift(v, c, k):
    if c == 0 or isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v + c * k
    if not k:
        return v
    if isinstance(v, str):
        return v if DATE_LIKE.match(v) else f"{v}_{c}"
    if isinstance(v, (list, tuple)):
        return type(v)(_shift(x, c, k) for x in v)
    return v


def scale_python_args(args, copies, shift=True):
    """Grow the data argument (the longest list or string) to `copies` copies; the rest (a target, a k, a point) stays.
    shift=False repeats it unchanged, for inputs whose values carry structure (grids, tokens, node ids)."""
    k = 10 ** len(str(int(_int_span(args)))) * 10 if shift else 0
    data = max(range(len(args)), key=lambda i: len(args[i]) if isinstance(args[i], (list, str)) else -1, default=None)
    out = []
    for i, a in enumerate(args):
        if i != data:
            out.append(a)
        elif isinstance(a, list) and a:
            # sorted input stays sorted; otherwise the original comes last so a search can't stop early
            order = range(copies) if _try_sorted(a) else list(range(1, copies)) + [0]
            out.append([_shift(x, c, k) for c in order for x in a])
        elif isinstance(a, str) and a:
            out.append(a * copies)
        else:
            out.append(a)
    return out


def _try_sorted(a):
    try:
        return a == sorted(a)
    except TypeError:
        return False


INT_TYPES = ("INT", "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "LONG")
TEXT_TYPES = ("STRING", "VARCHAR", "TEXT", "CHAR", "NVARCHAR")


def scale_kinds(t):
    """[(column, "int" | "text" | None)]: what each column gets in a shifted copy (dates stored as text are left alone)."""
    out = []
    for i, (col, typ) in enumerate(columns(t["columns"])):
        T = typ.split("(")[0].strip().upper()
        vals = [r[i] for r in t["rows"] if r[i] is not None]
        out.append((col, "int" if T in INT_TYPES else
                    "text" if T in TEXT_TYPES and not all(DATE_LIKE.match(str(v)) for v in vals or ["x"]) else None))
    return out


def scale_sql_select(t, k):
    """Columns of a SELECT that grows base table _b_<name> by a cross join with range(copies) AS r(c)."""
    return [f"{col} + r.c * {k} AS {col}" if kind == "int" else
            f"CASE WHEN r.c = 0 THEN {col} ELSE {col} || '_' || CAST(r.c AS VARCHAR) END AS {col}" if kind == "text" else col
            for col, kind in scale_kinds(t)]


class Capped(Exception):
    pass


def capped(run, secs, cancel=None):
    """run() with a hard time cap: cancel() from a timer thread (DuckDB interrupt, Spark cancel) or, for plain
    Python, an alarm in this (main) thread. Raises Capped when the cap hits; returns seconds taken otherwise."""
    import signal, threading, time
    hit = []
    def stop(*_):
        hit.append(1)
        if cancel:
            cancel()
        else:
            raise Capped
    if cancel:
        timer = threading.Timer(secs, stop); timer.start()
    elif hasattr(signal, "SIGALRM"):
        old = signal.signal(signal.SIGALRM, stop); signal.setitimer(signal.ITIMER_REAL, secs)
    t0 = time.perf_counter()
    try:
        run()
    except Capped:
        raise
    except Exception:
        if hit:
            raise Capped
        raise
    finally:
        if cancel:
            timer.cancel()
        elif hasattr(signal, "SIGALRM"):
            signal.setitimer(signal.ITIMER_REAL, 0); signal.signal(signal.SIGALRM, old)
    if hit:
        raise Capped
    return time.perf_counter() - t0


def scale_run(p, code, engine):
    lang = p["lang"]
    if lang not in SCALE:
        return {"error": "No at-scale run for this language yet."}
    sizes, limit = SCALE[lang]
    cap = 10 * limit  # no single run may take longer than this
    src = {"yours": code, "reference": p["solution"]}
    cancel = None

    if lang == "python":
        test = max(p["tests"], key=lambda t: size_of(t["args"]))
        base = max(size_of(test["args"]), 1)
        fns = {}
        for side, c in src.items():
            ns = {}
            exec(compile(c, "<solution>", "exec"), ns)
            fns[side] = ns[p["function"]]
        def build(copies, shift):
            args = scale_python_args(test["args"], copies, shift)
            return size_of(args), args
        def job(side, args):
            a = copy.deepcopy(args)
            return lambda: fns[side](*a)
    else:
        test = max(p["tests"], key=lambda t: max((len(x["rows"]) for x in t["tables"].values()), default=0))
        base = max((len(x["rows"]) for x in test["tables"].values()), default=0) or 1
        span = 10 ** len(str(int(_int_span([r for x in test["tables"].values() for r in x["rows"]])))) * 10
    if lang == "sql":
        import duckdb
        if engine not in ("duckdb", None):
            import sqlglot
            src = {s: ";\n".join(sqlglot.transpile(q, read="spark" if engine == "spark-sql" else engine, write="duckdb"))
                   for s, q in src.items()}
        con = duckdb.connect()
        cancel = con.interrupt
        load_dbapi(con, {f"_b_{n}": t for n, t in test["tables"].items()})
        def build(copies, shift):
            for name, t in test["tables"].items():
                con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT {', '.join(scale_sql_select(t, span if shift else 0))} "
                            f"FROM _b_{name}, range({copies}) AS r(c)")
            return base * copies, None
        def job(side, _):
            q = src[side].strip().rstrip(";")
            return lambda: con.execute(f"CREATE OR REPLACE TEMP TABLE _out AS {q}")
    if lang == "pyspark":
        from pyspark.sql import functions as F
        fns = {}
        for side, c in src.items():
            ns = {}
            exec(c, ns)
            fns[side] = ns[p["function"]]
        sp = spark()
        cancel = sp.sparkContext.cancelAllJobs
        bases, cached = {n: spark_df(t) for n, t in test["tables"].items()}, []
        def build(copies, shift):
            for df in cached:
                df.unpersist()
            cached.clear()
            dfs = {}
            for name, t in test["tables"].items():
                df = bases[name].crossJoin(sp.range(copies).withColumnRenamed("id", "_c"))
                types = dict(columns(t["columns"]))
                for col, kind in scale_kinds(t):
                    if kind == "int" and shift:
                        df = df.withColumn(col, (F.col(col) + F.col("_c") * span).cast(types[col]))
                    elif kind == "text" and shift:
                        df = df.withColumn(col, F.when(F.col("_c") == 0, F.col(col))
                                           .otherwise(F.concat(F.col(col), F.lit("_"), F.col("_c").cast("string"))))
                dfs[name] = df.drop("_c").cache()
                dfs[name].count()  # build the data before the clock starts
                cached.append(dfs[name])
            return base * copies, dfs
        def job(side, dfs):
            return lambda: fns[side](sp, **dfs).write.format("noop").mode("overwrite").save()

    # shifted copies when the reference copes with them, plain repeats otherwise (values that carry structure)
    first = max(1, round(sizes[0] / base))
    for shift in (True, False):
        try:
            _, data = build(first, shift)
            capped(job("reference", data), cap, cancel)
            break
        except Exception:
            if not shift:
                return {"error": "This problem's data can't be grown automatically, so there's no at-scale run for it."}

    runs, stopped, done = {"yours": [], "reference": []}, {"yours": False, "reference": False}, []
    for i, target in enumerate(sizes):
        n, data = build(max(1, round(target / base)), shift)
        done.append(n)
        for side in ("reference", "yours"):
            if stopped[side]:
                runs[side].append(None)
                continue
            try:
                dt = capped(job(side, data), cap, cancel)
            except Capped:
                runs[side].append(None); stopped[side] = True
                continue
            except Exception as e:
                return {"error": f"{'Your code' if side == 'yours' else 'The reference'} failed at {n:,} {'items' if lang == 'python' else 'rows'}: "
                                 f"{type(e).__name__}: {e}"[:400]}
            runs[side].append(round(dt * 1000, 1))
            # stop over the limit, or when the next size would pass the cap at the growth seen so far
            prev = [(m, t) for m, t in zip(done[:-1], runs[side][:-1]) if t]
            grow = max(1.0, math.log(max(dt * 1000, 1e-3) / prev[-1][1]) / math.log(n / prev[-1][0])) if prev and n > prev[-1][0] else 1.0
            nxt = sizes[i + 1] / target if i + 1 < len(sizes) else 1
            stopped[side] = dt > limit or dt * nxt ** grow > cap
        if all(stopped.values()):
            break
    return {"kind": "scale", "unit": "items" if lang == "python" else "rows", "sizes": done, "ms": runs, "limit_ms": limit * 1000,
            "shifted": shift, "engine": "Python" if lang == "python" else "DuckDB" if lang == "sql" else "Spark (local)"}


# ----------------------------------------------------------------------------

def run_one(p, code, test, engine):
    lang = p["lang"]
    if lang == "sql":
        fn = SQL.get(engine) or sql_emulated(engine)
        return fn(code, test["tables"])  # (rows, columns)
    ns = {}
    exec(code, ns)
    if lang == "python":
        return norm(ns[p["function"]](*copy.deepcopy(test["args"]))), None
    if lang == "pyspark":
        out = ns[p["function"]](spark(), **{name: spark_df(t) for name, t in test["tables"].items()})
        return [norm(list(r)) for r in out.collect()], out.columns
    raise ValueError(f"unknown lang {lang}")


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) < 2:
        # Almost always a DataDojo server that is older than this file: it still pipes the
        # request over stdin (the pre-0.1 protocol) instead of passing two file paths.
        sys.exit("runner.py: expected REQUEST.json RESULT.json, got %r.\n"
                 "If DataDojo is already running, quit and start it again: the running copy is "
                 "older than this runner." % (args,))
    req_path, res_path = args[:2]
    with open(req_path, encoding="utf-8") as f:
        req = json.load(f)
    p, code, engine = req["problem"], req["code"], req.get("engine") or "duckdb"
    if req.get("map") or req.get("scale"):
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                res = scale_run(p, code, engine) if req.get("scale") else make_map(p, code, engine)
        except Exception as e:
            res = {"error": f"{type(e).__name__}: {e}"}
        with open(res_path, "w", encoding="utf-8") as f:
            json.dump(res, f, default=str)
        return
    out, outputs = io.StringIO(), []
    for test in p["tests"]:
        try:
            with contextlib.redirect_stdout(out):
                value, cols = run_one(p, code, test, engine)
                outputs.append({"value": value, "columns": cols})
        except Exception as e:
            tb = traceback.extract_tb(e.__traceback__)
            line = next((f" (line {f.lineno})" for f in reversed(tb) if f.filename == "<string>"), "")
            outputs.append({"error": f"{type(e).__name__}{line}: {e}"})
    res = {"outputs": outputs, "stdout": out.getvalue()[-5000:]}
    if TRANSLATED:
        res["translated"] = TRANSLATED[0]
    with open(res_path, "w", encoding="utf-8") as f:
        json.dump(res, f, default=str)


if __name__ == "__main__":
    main()
