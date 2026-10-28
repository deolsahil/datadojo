# DataDojo

**Practice SQL, Python and PySpark like it's the real interview, with friendly AI coaches.**

DataDojo runs entirely on your own computer: 234 coding problems graded by real engines, a
Data System Design course with 32 lessons and case studies, brain games, streaks and a heatmap.
Coaches (Sensei, Duck, Pip and Sparky) give hints instead of answers, powered by your own API key
(Claude, OpenAI or Gemini) or a free local model through Ollama.

## Download

**[deolsahil.github.io/datadojo](https://deolsahil.github.io/datadojo/)**, or grab the latest installer directly:

| Mac (Apple Silicon) | Mac (Intel) | Windows |
|---|---|---|
| [DataDojo-macOS-arm64.dmg](https://github.com/deolsahil/datadojo/releases/latest/download/DataDojo-macOS-arm64.dmg) | [DataDojo-macOS-x64.dmg](https://github.com/deolsahil/datadojo/releases/latest/download/DataDojo-macOS-x64.dmg) | [DataDojo-Windows-Setup.exe](https://github.com/deolsahil/datadojo/releases/latest/download/DataDojo-Windows-Setup.exe) |

The installers aren't code-signed yet, so the first open needs one extra click:

- **macOS:** open DataDojo, click **Done** on the warning, then **System Settings → Privacy & Security → Open Anyway**.
- **Windows:** on the SmartScreen prompt click **More info → Run anyway**.

The app opens in its own window. PySpark (about 350 MB) downloads itself the first time you open a PySpark problem.

## Install from the terminal (Mac, Windows, Linux)

1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) (one command; it manages Python for you).
2. Install DataDojo:

       uv tool install git+https://github.com/deolsahil/datadojo

3. Start it:

       datadojo

   Your browser opens at `http://127.0.0.1:8517`. The first launch walks you through setup: your
   name, and what powers the coaches (paste an API key, or run Gemma locally with Ollama).

Update later with `uv tool upgrade datadojo`.

### Optional extras

| For | Install | Notes |
|---|---|---|
| PySpark problems | Java 11 or 17 | e.g. `brew install openjdk@17`, or any JDK on your `PATH` / `JAVA_HOME` |
| Local AI coach | [Ollama](https://ollama.com/download) | setup offers Gemma 2 in 2B / 9B / 27B and downloads it for you |
| Real PostgreSQL engine | PostgreSQL 14+ (`pg_ctl`, `initdb` on `PATH`) | DataDojo runs its own private instance; your databases are never touched |

SQL on DuckDB, SQLite and emulated dialects, and all Python problems, need nothing extra.

## Privacy

- Everything runs locally and listens only on `127.0.0.1`.
- Your progress, settings and API key live in your user data folder
  (`~/Library/Application Support/DataDojo` on macOS, `%APPDATA%\DataDojo` on Windows,
  `~/.local/share/datadojo` on Linux; override with `DATADOJO_HOME`). The settings file is readable only by you.
- An API key is sent only to the provider it belongs to. With Ollama, nothing leaves your machine.
- Reviews and mistake reports are saved locally; you can optionally send them to this repo as a GitHub issue.
- The editor, fonts and diagrams load from public CDNs, so an internet connection makes things look their best.

## What's inside

- **SQL, Python, PySpark** problems grouped by pattern, plus curated lists, including *SQL End-to-End 43*
  (from [sql-end-to-end-questions](https://github.com/deolsahil/sql-end-to-end-questions)).
- **Any engine:** DuckDB, SQLite, PostgreSQL, Spark SQL, and MySQL / Snowflake / BigQuery / SQL Server /
  Oracle / Redshift syntax (translated with sqlglot); Python 3.10 to 3.15; PySpark 3.4 to 4.x.
- **Coaching workspace:** six-stage coach chat, timer, hints, submissions, and "Report a mistake" on every problem.
- **Data System Design:** fundamentals, modeling, reliability, building blocks and 12 full case studies, with
  diagrams, quizzes and a coach that has read the page.
- **Brain games:** Guess the Output, Join Size, Spot the Bug, Big-O Sprint.
- Midnight (dark) and Sakura (light) themes, following your system setting.

Mascots are [blobatar](https://blobatar.dev) creatures (MIT). Problem statements are written in DataDojo's own
words; where a problem follows a well-known public one, it links to the source.

## Development

    git clone https://github.com/deolsahil/datadojo && cd datadojo
    uv run datadojo                    # run from source
    uv run datadojo check              # every reference solution passes its tests; every starter fails
    uv run datadojo check sql-joins    # one pattern, problem id, or lang
    uv run datadojo content            # validate design lessons and game items

### Building the desktop installers

    uv run --extra desktop --with pyinstaller --with pillow python packaging/build.py

builds `dist/release/DataDojo-macOS-<arch>.dmg` on macOS or `DataDojo-Windows-Setup.exe` on Windows (needs Inno Setup).
Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds all three installers and attaches them to the
GitHub release. `site/` is the download page, published to GitHub Pages by `.github/workflows/pages.yml`.

### Engines and versions

Pick one per language in the editor toolbar (remembered per language). Expected output always comes
from the default engine (DuckDB / Python 3.12 / PySpark 3.5), so grading compares *results*, not syntax.

- SQL, real engines: DuckDB (default), SQLite, PostgreSQL (private cluster in the data folder, started on
  first use, stopped with the app), Spark SQL.
- SQL, emulated: your query is translated to DuckDB with sqlglot and the translated SQL is shown.
  Syntax is that dialect's; semantics are DuckDB's.
- Python: any of 3.10 to 3.15 found by `uv python find` (`uv python install 3.X` to add one).
- PySpark: the app's own 3.5 plus any `pyspark-*` venv in the data folder's `envs/`, e.g.

      uv venv --python 3.11 "$DATA/envs/pyspark-3.4" && uv pip install --python "$DATA/envs/pyspark-3.4" "pyspark==3.4.*"

  4.x environments need Java 17+ (`JAVA17_HOME`, or found automatically). An inherited `SPARK_HOME` is ignored.

`uv run datadojo check sql --engine postgres` lists which reference solutions also run unchanged elsewhere.

### Adding a problem

Drop a TOML file in `datadojo/problems/<sql|python|pyspark>/`. It shows up on refresh. You only write inputs
and a reference `solution`; expected output is computed by running the solution, then compared
with your code (unordered unless `ordered = true`). Copy any existing file as a template.

- sql: `[[tests]]` with `tables.NAME = { columns = "a INT, b STRING", rows = [...] }`
- pyspark: same tables, passed as DataFrames to `function(spark, **tables)`
- python: `[[tests]]` with `args = [...]`, called as `function(*args)`
- TOML has no null: write `rows = '[[1, null]]'` (a JSON string) when you need NULLs.
- Required: `title lang difficulty pattern statement starter solution tests` (+ `function` for python/pyspark).
- `pattern` must be an id from `datadojo/problems/catalog.toml`; optional `lists = [...]` uses list ids from there.
- Optional `hints = ["...", "..."]` (shown one at a time) and `source_url` (where the idea came from).
- Statements support paragraphs, `code`, **bold**, `- ` bullets and ``` fenced blocks.

Progress lives in `dojo.db` (SQLite) in the data folder.

### Data System Design

`datadojo/design/catalog.toml` lists the sections. Each `datadojo/design/<id>.toml` is one lesson or case study:

```toml
title = "Batch vs Streaming"
section = "ds-foundations"        # a section id from design/catalog.toml
order = 2                         # position inside the section
kind = "lesson"                   # or "case_study"
difficulty = "medium"             # optional; case studies usually set it
companies = ["Uber", "Netflix"]   # optional, case studies
big_idea = "One sentence that captures the whole lesson."
summary = """Two or three short paragraphs. Markdown: paragraphs, `code`, **bold**, - bullets."""
diagram = """flowchart LR
  A[Source DB] --> B[(Kafka)] --> C[Spark job] --> D[(Lakehouse)]"""   # optional Mermaid flowchart

[[blocks]]                        # any number of titled sections, rendered in order
heading = "Requirements"          # e.g. Requirements, Scale estimate, Architecture, Deep dive, Trade-offs, Failure modes
body = """Markdown."""

key_points = ["...", "..."]
common_mistakes = ["...", "..."]
interview_questions = ["...", "..."]

[[quiz]]                          # at least one; answer is the 0-based index into options
q = "Question?"
options = ["A", "B", "C", "D"]
answer = 1
why = "Why B is right."
```

### Brain games

- `datadojo/games/spot-bug.toml`: `[[items]]` with `lang` (sql/python/pyspark), `goal`, `code` (multi-line),
  `bug_line` (1-based line number in `code`), `why`, `fix` (the corrected line).
- `datadojo/games/big-o.toml`: `[[items]]` with `lang`, `code`, `answer` (one of `O(1)`, `O(log n)`, `O(n)`,
  `O(n log n)`, `O(n²)`, `O(2ⁿ)`), `why`.
- Guess the Output and Join Size are generated by running DuckDB (`content.py`), so they need no content.

`uv run datadojo content` validates both and prints counts; files with errors are listed as "skipping".
