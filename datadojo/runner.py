"""Runs one piece of code over every test of a problem, in a fresh process.

usage:  runner.py REQUEST.json RESULT.json
request {"problem": {...}, "code": "...", "engine": "duckdb"}
result  {"outputs": [{"value": ...} | {"error": "..."}], "stdout": "...", "translated": "..."?}
Files rather than stdin/stdout: a windowed desktop build has no console streams.

Grading happens in server.py. This file must stay stdlib-only at import time: it is also
run by other Python versions and other PySpark environments.
"""
import contextlib, copy, datetime, io, json, os, re, sys, traceback, uuid


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
    return [tuple(c.strip().split(None, 1)) for c in ddl.split(",")]


def rows_of(cur):
    return [norm(list(r), sql=True) for r in cur.fetchall()]


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
    return [norm(list(r), sql=True) for r in spark().sql(query).collect()]


TRANSLATED = []


def sql_emulated(dialect):
    def run(query, tables):
        import sqlglot
        sql = ";\n".join(sqlglot.transpile(query, read=dialect, write="duckdb"))
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
    casts = {"DATE": datetime.date.fromisoformat, "TIMESTAMP": datetime.datetime.fromisoformat}
    conv = [casts.get(typ.upper()) for _, typ in columns(t["columns"])]
    rows = [tuple(f(v) if f and v is not None else v for f, v in zip(conv, r)) for r in t["rows"]]
    return spark().createDataFrame(rows, schema=t["columns"])


# ----------------------------------------------------------------------------

def run_one(p, code, test, engine):
    lang = p["lang"]
    if lang == "sql":
        fn = SQL.get(engine) or sql_emulated(engine)
        return fn(code, test["tables"])
    ns = {}
    exec(code, ns)
    if lang == "python":
        return norm(ns[p["function"]](*copy.deepcopy(test["args"])))
    if lang == "pyspark":
        out = ns[p["function"]](spark(), **{name: spark_df(t) for name, t in test["tables"].items()})
        return [norm(list(r)) for r in out.collect()]
    raise ValueError(f"unknown lang {lang}")


def main(argv=None):
    req_path, res_path = (argv or sys.argv[1:])[:2]
    with open(req_path, encoding="utf-8") as f:
        req = json.load(f)
    p, code, engine = req["problem"], req["code"], req.get("engine") or "duckdb"
    out, outputs = io.StringIO(), []
    for test in p["tests"]:
        try:
            with contextlib.redirect_stdout(out):
                outputs.append({"value": run_one(p, code, test, engine)})
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
