"""Mock coding round: a timed problem with the coach as interviewer, an efficiency check against the reference
(execution map), one graded follow-up question, and a 100-point report.

Score: correctness 40, efficiency 20, time 15, follow-up 25, minus 5 per hint (never below 0).
"""
import random

MINUTES = {"easy": 15, "medium": 25, "hard": 40}
LEVEL_DIFFICULTY = {"entry": "easy", "mid": "medium", "senior": "hard"}
TRACKS = {"sql": "SQL", "python": "Python", "pyspark": "PySpark", "ml": "ML & AI"}

# Follow-ups an interviewer actually asks once the code works. Each has the points a strong answer covers.
FOLLOWUPS = {
    "sql-scale": ("sql", "This query now runs against a 10-billion-row table. What would you change, and what would you check first?",
                  ["Look at the query plan (EXPLAIN / EXPLAIN ANALYZE) before changing anything",
                   "Filter as early as possible so less data reaches joins and aggregations",
                   "Partition or cluster (or index) on the filter and join keys so scans can be pruned",
                   "Avoid row explosions: join on proper keys, or aggregate before joining",
                   "Measure again after each change to confirm it helped"],
                  "Start with the plan, not guesses. Push filters down so partitions get pruned, make sure the big table is "
                  "partitioned or clustered on the keys you filter and join on, aggregate before joining to keep row counts "
                  "small, and re-measure after each change."),
    "sql-missing": ("sql", "A teammate says the result sometimes misses rows it should include. What could cause that in a query like yours?",
                    ["NULLs in join keys or filters (for example NOT IN with a NULL, or = NULL)",
                     "An inner join silently dropping rows that have no match (should it be an outer join?)",
                     "Duplicate keys or a grain mismatch changing which rows survive",
                     "Date and time-zone boundaries cutting rows off at the edges",
                     "Reproduce it with small edge-case data and compare row counts step by step"],
                    "Usually NULLs (NOT IN with a NULL returns nothing), inner joins dropping unmatched rows, duplicate or "
                    "mismatched keys, or date/time-zone boundaries. Reproduce with tiny edge-case tables and check row counts "
                    "after every step."),
    "pyspark-skew": ("pyspark", "The input grows to 2 TB and one task takes 10x longer than all the others. What is happening and how do you fix it?",
                     ["Recognise data skew: one hot key lands in a single partition",
                      "Confirm it in the Spark UI: task durations and shuffle read sizes within the stage",
                      "Broadcast the small side of the join so the big side is not shuffled",
                      "Salt the hot key, or turn on AQE skew-join handling",
                      "Pre-aggregate or filter before the shuffle to cut the data that moves"],
                     "That's skew: one key holds most rows, so one partition does most of the work. Confirm in the Spark UI, then "
                     "broadcast the small side if you can, salt the hot key or let AQE split skewed partitions, and shrink data "
                     "before the shuffle."),
    "pyspark-cost": ("pyspark", "This job will run every hour. How would you make it cheaper and faster to run?",
                     ["Process incrementally: only new or changed partitions, not the full history",
                      "Use a good file layout (Parquet or Delta, partitioned) so reads are pruned",
                      "Cut shuffles: broadcast small tables, avoid unnecessary distinct and repartition",
                      "Avoid Python UDFs in favour of built-in functions",
                      "Right-size the cluster and use AQE; cache only what is reused"],
                     "Make it incremental, lay files out so reads are pruned, remove shuffles (broadcast small tables, drop "
                     "needless distincts), replace Python UDFs with built-ins, and right-size the cluster with AQE on."),
    "python-memory": ("python", "The input now has 100 million items and no longer fits in memory. How would you change your solution?",
                      ["Stream the input in chunks or with generators instead of loading it all",
                       "Keep only bounded state (counters, a heap of size k) rather than full copies",
                       "Use the right structures: dict or set lookups instead of nested loops",
                       "Spill to disk when needed: external sort, or hash-partition into files",
                       "Or hand it to a tool built for it, like DuckDB or Spark"],
                      "Stream it: read in chunks or generators, keep only bounded state, use O(1) lookups, and spill to disk "
                      "(external sort or hash partitions) when state grows. At that size, DuckDB or Spark is often the right call."),
    "python-testing": ("python", "How would you test this function before shipping it?",
                       ["Edge cases: empty input, a single item, duplicates, negatives or None",
                        "Boundary values around any thresholds or limits",
                        "Compare against a simple brute-force version on random inputs",
                        "A performance test on a large input to catch accidental O(n²)",
                        "Clear, specific assertions on exact expected outputs"],
                       "Cover edge cases and boundaries, check it against a slow but obviously-correct version on random data, "
                       "add one large-input performance test, and assert exact expected outputs."),
    "ml-production": ("ml", "Your offline metric looks great, but the model underperforms in production. What would you investigate?",
                      ["Data leakage: test data or future information reaching training",
                       "Train/serving skew: features computed differently online and offline",
                       "Distribution drift between the training data and live traffic",
                       "Whether the offline metric matches the real business goal",
                       "Validate on a recent time-based holdout or an A/B test"],
                      "Check for leakage first, then train/serving skew in features, then drift in live data. Make sure the metric "
                      "reflects the business goal, and evaluate on a recent time-split holdout or an A/B test."),
    "ml-rag-eval": ("ml-rag", "How would you evaluate a RAG system end to end before and after each change?",
                    ["Retrieval quality on labelled queries (recall@k, NDCG)",
                     "Faithfulness: is the answer grounded in the retrieved context?",
                     "Answer correctness or relevance, judged by humans or an LLM judge with a rubric",
                     "Latency and cost per query",
                     "A fixed regression set re-run on every change"],
                    "Score retrieval (recall@k, NDCG) and generation separately: faithfulness to the context and answer "
                    "correctness with a rubric-based judge. Track latency and cost, and re-run a fixed regression set on every change."),
    "sql-index": ("sql", "Which indexes would you add to make this query fast, and what would they cost you?",
                  ["Index the columns used in WHERE filters and JOIN conditions",
                   "Composite index column order: equality columns first, then range or sort columns",
                   "A covering index (include the selected columns) to skip table lookups",
                   "Indexes slow down writes and take storage, so add only what the queries need",
                   "Confirm with EXPLAIN that the planner actually uses the index"],
                  "Index the filter and join columns, ordering composite indexes as equality columns first, then range or "
                  "sort columns, and include selected columns to make it covering. Every index slows writes and uses space, "
                  "so check with EXPLAIN that it is used before keeping it."),
    "sql-duplicates": ("sql", "The result suddenly has duplicate rows. How would you find the cause and fix it properly?",
                       ["Check the grain of each table: is the join key really unique?",
                        "A one-to-many join fanning out rows is the usual cause",
                        "Count rows after each join or CTE to find where it grows",
                        "Fix the join (dedupe or aggregate first), not with a DISTINCT at the end",
                        "Add a uniqueness test on the output key so it can't come back"],
                       "Duplicates almost always come from a join that fans out because a key isn't unique. Count rows after "
                       "each step to find it, fix it by deduplicating or aggregating before the join rather than slapping "
                       "DISTINCT on the end, and add a uniqueness test on the output key."),
    "sql-incremental": ("sql", "This query feeds a daily table. How would you load it incrementally instead of rebuilding it every day?",
                        ["Process only new or changed rows using a watermark (updated_at or a date partition)",
                         "Use MERGE / upsert on a unique key so re-runs don't duplicate data",
                         "Make the load idempotent: re-running a day gives the same result",
                         "Handle late-arriving data with a lookback window",
                         "Plan a periodic full refresh or backfill path for fixes"],
                        "Load only rows past a watermark, upsert them with MERGE on a unique key so re-runs are idempotent, "
                        "reprocess a short lookback window to catch late data, and keep a backfill path for corrections."),
    "sql-window-vs-join": ("sql", "Could you have written this with a window function instead of a self-join or subquery, or the other way around? Which is better here and why?",
                           ["Window functions compute per-row results without collapsing rows",
                            "A window avoids re-scanning the same table, unlike a self-join",
                            "Self-joins can explode rows when keys repeat",
                            "Both usually need a sort or shuffle by the partition key",
                            "Pick the one that is clearer, then check the plan"],
                           "A window function keeps every row and computes over its partition in one pass, while a self-join "
                           "re-scans the table and can fan out on repeated keys. Both sort or shuffle by the key, so prefer the "
                           "clearer one and confirm with the plan."),
    "pyspark-partitions": ("pyspark", "How do you decide how many partitions this job should use, and when do you repartition or coalesce?",
                           ["Aim for partitions of roughly 100-200 MB, a few per core",
                            "Too many tiny partitions waste scheduling; too few cause spills and idle cores",
                            "Tune spark.sql.shuffle.partitions or let AQE coalesce shuffle partitions",
                            "repartition causes a full shuffle; coalesce only merges and avoids one",
                            "Watch output file counts: avoid writing thousands of small files"],
                           "Size partitions around 100-200 MB with a few per core. Let AQE coalesce shuffle partitions or tune "
                           "shuffle.partitions, use coalesce to reduce without a shuffle and repartition only when you need to "
                           "rebalance or partition by a key, and watch for small output files."),
    "pyspark-oom": ("pyspark", "The job fails with executor out-of-memory errors. How would you debug and fix it?",
                    ["Find the failing stage in the Spark UI and check spill and shuffle sizes",
                     "Look for skew: one huge partition, not a cluster-wide shortage",
                     "Avoid collect() or toPandas() on large data pulling it to the driver",
                     "Increase partitions so each task handles less data",
                     "Only then tune executor memory and memory overhead"],
                    "Find the failing stage in the Spark UI. Usually it's one skewed partition or a collect pulling too much "
                    "data, not too little memory. Split the work into more partitions, fix the skew, and adjust executor "
                    "memory and overhead last."),
    "pyspark-streaming": ("pyspark", "How would you turn this batch job into a streaming job?",
                          ["Use Structured Streaming with a source like Kafka or Auto Loader",
                           "Checkpointing so the job can restart where it left off",
                           "Watermarks to bound state and handle late events",
                           "Exactly-once output via idempotent or transactional sinks (Delta, foreachBatch with MERGE)",
                           "Choose a trigger interval to balance latency against cost"],
                          "Use Structured Streaming from Kafka or Auto Loader, with a checkpoint location for recovery and a "
                          "watermark so state doesn't grow forever. Write to an idempotent or transactional sink like Delta for "
                          "exactly-once output, and pick a trigger that balances latency against cost."),
    "pyspark-test": ("pyspark", "How would you test this transformation before it runs in production?",
                     ["Unit tests on small hand-made DataFrames with a local SparkSession",
                      "Cover nulls, duplicates, empty input and schema edge cases",
                      "Compare DataFrames ignoring row order, and check the schema too",
                      "Data quality checks in the pipeline: row counts, uniqueness, null rates",
                      "Run on a sample of real data in staging before production"],
                     "Factor the logic into functions and unit-test them on small hand-built DataFrames with a local Spark "
                     "session, covering nulls, duplicates and empty input, comparing results order-independently with schemas. "
                     "Add data quality checks to the pipeline and dry-run on real data in staging."),
    "python-complexity": ("python", "What is the time and space complexity of your solution, and could you do better?",
                          ["State time complexity in terms of the input size",
                           "State the extra space used, not just time",
                           "Name the dominating step (sort, nested loop, hash lookups)",
                           "Mention the lower bound: you must at least read the input",
                           "Discuss the trade-off between time and memory, e.g. a hash map"],
                          "Give time and extra space in terms of n, name the step that dominates, and compare with the lower "
                          "bound of reading the input once. If you're above it, say what would get you there, often trading "
                          "memory for time with a hash map or set."),
    "python-edge": ("python", "What inputs could break your solution?",
                    ["Empty input or a single element",
                     "Duplicates, ties and their ordering",
                     "None or missing values, wrong types",
                     "Extremely large or negative numbers, or very long strings",
                     "How you'd decide the expected behaviour: ask, or document and test it"],
                    "Empty or single-element input, duplicates and ties, None and wrong types, and extreme values. For each, "
                    "decide the expected behaviour (ask if unsure), then write a test for it."),
    "python-concurrency": ("python", "This function now has to process a million records from an API. How would you make it fast?",
                           ["Identify whether it's I/O-bound or CPU-bound",
                            "For I/O: asyncio or a thread pool to run requests concurrently",
                            "For CPU: multiprocessing, since threads are limited by the GIL",
                            "Batch requests and respect rate limits with backoff and retries",
                            "Bound concurrency and handle partial failures so a crash doesn't lose progress"],
                           "API calls are I/O-bound, so use asyncio or a thread pool with bounded concurrency, batch where the "
                           "API allows, and retry with backoff under the rate limit. CPU-heavy work goes to multiprocessing "
                           "because of the GIL. Checkpoint progress so failures don't mean starting over."),
    "python-production": ("python", "How would you get this code ready for production?",
                          ["Type hints and clear names, with a docstring",
                           "Validate inputs and raise clear errors",
                           "Logging instead of print, with useful context",
                           "Tests run in CI, including edge cases",
                           "Package it with pinned dependencies and handle config without hard-coded values"],
                          "Add type hints and a docstring, validate inputs with clear errors, log rather than print, cover it "
                          "with tests in CI, and pin dependencies with config kept out of the code."),
    "ml-leakage": ("ml", "How could data leakage creep into a pipeline built around this code, and how would you prevent it?",
                   ["Fit scalers, encoders and imputers on training data only",
                    "Split before any preprocessing that learns from data",
                    "Time-based splits for time-ordered data, so the future doesn't leak in",
                    "Features that wouldn't be available at prediction time",
                    "Group-aware splits so the same user or entity isn't in train and test"],
                   "Split first and fit every preprocessing step on train only, ideally inside a pipeline. Use time-based "
                   "splits for temporal data, group splits so one entity isn't on both sides, and drop any feature that "
                   "isn't available at prediction time."),
    "ml-metric": ("ml", "Your classes are 99% negative. Which metric would you report, and why not accuracy?",
                  ["Accuracy is misleading: predicting all-negative scores 99%",
                   "Precision, recall and F1 on the positive class",
                   "PR-AUC is more informative than ROC-AUC under heavy imbalance",
                   "Pick the decision threshold from the business cost of false positives vs negatives",
                   "Report a confusion matrix at the chosen threshold"],
                  "Accuracy rewards predicting the majority class. Report precision, recall and F1 for the positive class and "
                  "PR-AUC, which reflects imbalance better than ROC-AUC, then choose the threshold from the real cost of each "
                  "error type and show the confusion matrix there."),
    "ml-monitoring": ("ml", "Once this model is deployed, what would you monitor?",
                      ["Input feature drift against the training distribution",
                       "Prediction distribution shifts",
                       "Model quality once labels arrive (delayed ground truth)",
                       "Latency, errors and throughput of the service",
                       "Alerts with clear thresholds, plus a retraining or rollback plan"],
                      "Monitor input drift and the prediction distribution, track real quality as labels come in, and watch "
                      "latency and errors. Alert on thresholds and have a retraining or rollback plan ready."),
    "ml-rag-chunking": ("ml-rag", "How would you choose the chunk size and overlap for a RAG system?",
                        ["Chunks should hold one coherent idea; split on structure (headings, paragraphs)",
                         "Too large dilutes the embedding and wastes context; too small loses meaning",
                         "Overlap keeps sentences that cross a boundary retrievable",
                         "Match chunk size to the embedding model's limits and the context budget",
                         "Tune it empirically against a labelled retrieval set"],
                        "Split on document structure so each chunk holds one idea, with some overlap so boundary sentences "
                        "survive. Too big dilutes embeddings and burns context, too small loses meaning. Pick candidates within "
                        "the model's limits and choose by measuring retrieval quality on labelled queries."),
    "ml-rag-hallucination": ("ml-rag", "The assistant sometimes answers confidently with facts that aren't in the documents. How would you reduce that?",
                             ["Improve retrieval first: wrong context leads to made-up answers",
                              "Instruct the model to answer only from the context and say when it doesn't know",
                              "Require citations to the retrieved passages",
                              "Check faithfulness automatically (an LLM judge or entailment check)",
                              "Track a hallucination rate on an eval set across changes"],
                             "Fix retrieval first, then tell the model to answer only from the context, cite its sources and say "
                             "\"I don't know\" otherwise. Check faithfulness automatically and track a hallucination rate on a "
                             "fixed eval set."),
    "ml-rag-hybrid": ("ml-rag", "When would you combine keyword search like BM25 with vector search, and how would you merge the results?",
                      ["BM25 is strong on exact terms, IDs, names and rare words",
                       "Embeddings catch paraphrases and meaning",
                       "Hybrid search covers both failure modes",
                       "Merge with reciprocal rank fusion or a weighted score",
                       "Optionally rerank the top results with a cross-encoder"],
                      "Keyword search nails exact terms and IDs, while vectors catch paraphrases, so hybrid covers both. Merge "
                      "the lists with reciprocal rank fusion or weighted scores, then rerank the top few with a cross-encoder."),
}


def track_of(p, catalog):
    """sql / python / pyspark, or "ml" for the ML & AI patterns."""
    group = next((pt.get("group") for pt in catalog["patterns"] if pt["id"] == p["pattern"]), "")
    return "ml" if group == "ML & AI" else p["lang"]


def start(track, level, problems, catalog, solved):
    difficulty = LEVEL_DIFFICULTY.get(level, "medium")
    coding = [p for p in problems.values() if p.get("kind") != "choice"]  # a round is a coding problem, never a case study
    pool = [p for p in coding if track_of(p, catalog) == track and p["difficulty"] == difficulty]
    pool = pool or [p for p in coding if track_of(p, catalog) == track]
    fresh = [p for p in pool if p["id"] not in solved] or pool  # prefer something new
    p = random.choice(fresh)
    key = "ml-rag" if track == "ml" and p["pattern"] == "ai-retrieval" else track
    fid = random.choice([k for k, v in FOLLOWUPS.items() if v[0] == key])
    return {"id": p["id"], "title": p["title"], "track": track, "level": level, "minutes": MINUTES[p["difficulty"]],
            "followup": {"id": fid, "q": FOLLOWUPS[fid][1]}}


def followup_question(fid, level):
    """Shaped like an interview question so interview.grade can grade the answer against the rubric."""
    _, q, rubric, answer = FOLLOWUPS[fid]
    return {"q": q, "rubric": rubric, "answer": answer, "level": level}


def efficiency(lang, yours, ref):
    """Compare the execution maps: (ok, what the interviewer says). Unknown when either map failed."""
    if not yours or "error" in yours or not ref or "error" in ref:
        return None, ""
    a, b = yours.get("stats", {}), ref.get("stats", {})
    if lang == "python":
        # small tests with early returns make linear code look sublinear, so only "worse than linear" counts
        rank = {"O(1)": 0, "O(log n)": 0, "O(n)": 0, "O(n²)": 1, "O(n³) or worse": 2}
        ga, gb = a.get("Grows like"), b.get("Grows like")
        if ga in rank and gb in rank and rank[ga] > rank[gb]:
            return False, f"Your code grows like {ga}, but this can be done in {'O(n) or better' if rank[gb] == 0 else gb}."
        if a.get("Steps", 0) > 2 * max(1, b.get("Steps", 0)):
            return False, f"It does about {a['Steps'] / max(1, b['Steps']):.1f}x the work of a good solution."
        return True, ""
    key, noun = ("Shuffles", "shuffle") if "Shuffles" in a else ("Blocking steps", "blocking step")
    d = a.get(key, 0) - b.get(key, 0)
    if d > 0:
        return False, f"It needs {d} more {noun}{'s' if d > 1 else ''} than it has to ({a.get(key)} vs {b.get(key)})."
    return True, ""


def score(passed_fraction, eff_ok, improved, seconds, minutes, hints, followup_score):
    correctness = round(40 * passed_fraction)
    eff = 12 if improved else 20 if eff_ok else 15 if eff_ok is None else 6  # improved = fixed after the nudge
    limit = minutes * 60
    time_pts = 15 if seconds <= limit else max(0, round(15 * (1 - (seconds - limit) / limit)))
    follow = round(25 * (followup_score or 0) / 10)
    total = max(0, correctness + eff + time_pts + follow - 5 * hints)
    return {"total": min(100, total), "parts": {"Correctness": [correctness, 40], "Efficiency": [eff, 20],
            "Time": [time_pts, 15], "Follow-up": [follow, 25], "Hints": [-5 * hints, 0]}}


if __name__ == "__main__":  # self-check: python -m datadojo.rounds
    assert score(1, True, False, 60, 15, 0, 10)["total"] == 100
    assert score(1, True, True, 60, 15, 0, 10)["parts"]["Efficiency"][0] == 12
    assert score(1, False, False, 60, 15, 0, 10)["parts"]["Efficiency"][0] == 6
    assert score(1, None, False, 60, 15, 0, 10)["parts"]["Efficiency"][0] == 15
    assert score(0, False, False, 3600, 15, 9, 0)["total"] == 0
    slow = {"stats": {"Grows like": "O(n²)", "Steps": 90}}
    fast = {"stats": {"Grows like": "O(n)", "Steps": 40}}
    assert efficiency("python", slow, fast)[0] is False and efficiency("python", fast, {"stats": {"Grows like": "O(log n)", "Steps": 40}})[0]
    assert efficiency("sql", {"stats": {"Blocking steps": 2}}, {"stats": {"Blocking steps": 1}})[0] is False
    assert efficiency("python", {"error": "x"}, fast) == (None, "")
    print("rounds ok")
    from collections import Counter
    assert all(len(v[2]) == 5 for v in FOLLOWUPS.values()), "every follow-up needs a 5-point rubric"
    assert min(Counter(v[0] for v in FOLLOWUPS.values()).values()) >= 4
