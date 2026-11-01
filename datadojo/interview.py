"""Interview practice: pick questions, grade answers against their rubric, speech stats, and local speech-to-text.

Grading asks the coach model to judge each rubric point (covered / partial / missed); the score is computed from
those verdicts in code, so it stays consistent across models. Speech-to-text runs faster-whisper in its own
environment (DATA_HOME/envs/whisper, installed on first use) via a long-lived worker process, so audio never
leaves the machine.
"""
import atexit, json, os, random, re, subprocess, threading
from pathlib import Path

from datadojo import content, llm
from datadojo.paths import DATA_HOME

LEVELS = content.LEVELS
# a mock interview: what each step asks, by level
MOCK = {"entry": ["concept"] * 4 + ["scenario"] * 2,
        "mid": ["concept"] * 3 + ["scenario"] * 2 + ["design"],
        "senior": ["concept"] * 2 + ["scenario"] * 2 + ["design"] * 2}
PUBLIC = ("id", "q", "level", "kind", "topic")


def public(q, topics):
    return {k: q[k] for k in PUBLIC} | {"topic_title": topics.get(q["topic"], q["topic"])}


def pick(track, level, mode, topic=None, seed=None):
    """Questions for a session. Drill: a topic's questions up to your level, your level first. Mock: one per MOCK slot."""
    rng, rank = random.Random(seed), LEVELS.index(level)
    topics = {t["id"]: t["title"] for t in track["topics"]}
    qs = list(track["questions"].values())
    if mode == "drill":
        pool = [q for q in qs if (not topic or q["topic"] == topic) and LEVELS.index(q["level"]) <= rank]
        rng.shuffle(pool)
        pool.sort(key=lambda q: q["level"] != level)  # stable: your level first, easier ones after
        return [public(q, topics) for q in pool]
    used, seen_topics, out = set(), set(), []
    for kind in MOCK[level]:
        def score(q):  # prefer: right kind, exact level, a topic not asked yet; then nearby levels
            return (abs(LEVELS.index(q["level"]) - rank), q["topic"] in seen_topics, rng.random())
        cands = sorted((q for q in qs if q["kind"] == kind and q["id"] not in used), key=score)
        if not cands:
            cands = sorted((q for q in qs if q["id"] not in used), key=score)
        if cands:
            q = cands[0]
            used.add(q["id"]); seen_topics.add(q["topic"]); out.append(public(q, topics))
    return out


# ---- speech stats (deterministic, no model) -------------------------------------------------
FILLERS = ("um", "uh", "umm", "uhh", "erm", "you know", "basically", "actually", "sort of", "kind of", "i mean")


def speech_stats(text, seconds=None):
    words = re.findall(r"[\w'’-]+", text.lower())
    low = " " + " ".join(words) + " "
    fillers = {f: low.count(f" {f} ") for f in FILLERS}
    fillers = {f: n for f, n in fillers.items() if n}
    wpm = round(len(words) / (seconds / 60)) if seconds and seconds > 5 else None
    notes = []
    if len(words) < 40:
        notes.append("Short for an interview answer: aim for 60-180 words that explain the why, not just the what.")
    elif len(words) > 320:
        notes.append("Long answer: lead with a one-sentence summary, then give 2-3 supporting points.")
    if wpm and wpm < 100:
        notes.append(f"About {wpm} words per minute is slow; practising the key points out loud makes it flow.")
    elif wpm and wpm > 175:
        notes.append(f"About {wpm} words per minute is fast; slow down on the key terms so they land.")
    n_fill = sum(fillers.values())
    if seconds and n_fill and n_fill / max(seconds / 60, 1) > 4:
        top = ", ".join(f'"{f}" ×{n}' for f, n in sorted(fillers.items(), key=lambda kv: -kv[1])[:3])
        notes.append(f"Filler words: {top}. A short pause sounds more confident than a filler.")
    return {"words": len(words), "wpm": wpm, "fillers": fillers, "notes": notes}


# ---- grading --------------------------------------------------------------------------------
STATUS_POINTS = {"covered": 1.0, "partial": 0.5, "missed": 0.0}


def _json(text):
    """The first {...} in a reply, forgiving code fences and trailing commas; None if there is no usable object."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return None
    for candidate in (m.group(0), re.sub(r",\s*([}\]])", r"\1", m.group(0))):
        try:
            return json.loads(candidate)
        except ValueError:
            pass
    return None


def grade(track, q, answer, seconds=None):
    """Rubric verdicts from the coach model; score = covered points (partial = half) out of 10."""
    answer = (answer or "").strip()
    base = {"rubric_points": q["rubric"], "answer": q["answer"], "study": q.get("study"),
            "stats": speech_stats(answer, seconds)}
    if len(answer.split()) < 3:
        return base | {"score": 0, "rubric": [{"status": "missed", "note": ""} for _ in q["rubric"]],
                       "strengths": [], "improve": ["Give an answer, even a partial one: interviewers reward reasoning out loud."],
                       "structure": ""}
    points = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(q["rubric"]))
    system = f"""You are Sensei, the head interview coach, grading one answer from a {q['level']}-level {track['title']}
mock interview. Grade ONLY against the rubric below: judge each point as "covered" (stated correctly and clearly),
"partial" (touched on, vague, or partly wrong) or "missed" (absent or wrong). Paraphrases count; exact wording
does not matter. Do not reward length or confident tone. If the answer states something factually wrong, say so.
The answer may be a speech transcript, so ignore transcription glitches and filler words.

Question: {q['q']}

Rubric (what a strong answer covers):
{points}

Reply with ONLY a JSON object, no prose before or after:
{{"rubric": [{{"point": 1, "status": "covered|partial|missed", "note": "max 15 words, specific to their answer"}}, ...one per rubric point],
 "strengths": ["what they did well, max 2 items"],
 "improve": ["the most important specific fixes, max 3 items, each actionable"],
 "structure": "one sentence on how clear and well-structured the answer was"}}"""
    data = {}
    for _ in range(2):  # small local models occasionally break the format; one retry fixes almost all of those
        try:
            raw = llm.chat(system, [{"role": "user", "content": "Candidate's answer:\n" + answer}], strict=True, json_mode=True)
        except Exception as e:
            return base | {"error": f"Couldn't reach the coach ({llm._reason(e)}). Check yourself against the rubric below, or fix coach setup."}
        data = _json(raw) or {}
        if isinstance(data.get("rubric"), list) and data["rubric"]:
            break
    verdicts = {int(r.get("point", i + 1)): r for i, r in enumerate(data.get("rubric") or []) if isinstance(r, dict)}
    rubric = []
    for i in range(len(q["rubric"])):
        r = verdicts.get(i + 1, {})
        status = str(r.get("status", "")).lower()
        rubric.append({"status": status if status in STATUS_POINTS else "missed", "note": str(r.get("note", ""))[:200]})
    if not verdicts:
        return base | {"error": "The coach replied in an unexpected format. Check yourself against the rubric below, or try again."}
    score = round(10 * sum(STATUS_POINTS[r["status"]] for r in rubric) / len(rubric))
    as_list = lambda v: [str(x) for x in v][:3] if isinstance(v, list) else []
    return base | {"score": score, "rubric": rubric, "strengths": as_list(data.get("strengths")),
                   "improve": as_list(data.get("improve")), "structure": str(data.get("structure", ""))[:300]}


def report(items):
    """Overall summary for a finished session: score out of 100, weakest topics, top fixes."""
    graded = [it for it in items if isinstance(it.get("grade", {}).get("score"), int)]
    score = round(10 * sum(it["grade"]["score"] for it in graded) / len(graded)) if graded else None
    by_topic = {}
    for it in graded:
        by_topic.setdefault(it["topic_title"], []).append(it["grade"]["score"])
    weak = sorted(((sum(v) / len(v), t) for t, v in by_topic.items()))[:3]
    fixes = []
    for it in sorted(graded, key=lambda it: it["grade"]["score"]):
        for f in it["grade"].get("improve", [])[:1]:
            if f not in fixes:
                fixes.append(f)
    return {"score": score, "answered": len(graded), "total": len(items),
            "weak_topics": [{"topic": t, "score": round(s, 1)} for s, t in weak if s < 7], "fixes": fixes[:3]}


# ---- local speech-to-text (faster-whisper) --------------------------------------------------
WHISPER_ENV = DATA_HOME / "envs" / "whisper"
WHISPER_MODEL = os.environ.get("DATADOJO_WHISPER_MODEL", "base.en")  # ~145 MB; small.en is sharper but ~480 MB
MODELS_DIR = DATA_HOME / "models" / "whisper"
WORKER = Path(__file__).with_name("whisper_worker.py")
install_state = {"status": "idle", "error": None}
_worker, _worker_lock = None, threading.Lock()


def _py():
    return WHISPER_ENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def whisper_ready():
    return _py().exists() and (MODELS_DIR / ".ready").exists()


def whisper_status():
    return {"ready": whisper_ready(), "model": WHISPER_MODEL} | install_state


def install_whisper(uv_binary):
    """Background: venv with faster-whisper, then download the speech model. ~300 MB in total, once."""
    if install_state["status"] in ("downloading uv", "creating environment", "installing faster-whisper", "downloading speech model"):
        return
    flags = {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0), "capture_output": True, "text": True}

    def work():
        try:
            install_state.update(status="downloading uv", error=None)
            uv = uv_binary()
            if not _py().exists():
                install_state["status"] = "creating environment"
                r = subprocess.run([uv, "venv", "--python", "3.12", str(WHISPER_ENV)], **flags)
                if r.returncode:
                    raise RuntimeError(r.stderr[-400:])
            install_state["status"] = "installing faster-whisper"
            # av 17+ dropped an argument faster-whisper 1.2 passes to av.open (TypeError on every file)
            r = subprocess.run([uv, "pip", "install", "--python", str(_py()), "faster-whisper>=1.1", "av<17"], **flags)
            if r.returncode:
                raise RuntimeError(r.stderr[-400:])
            install_state["status"] = "downloading speech model"
            r = subprocess.run([str(_py()), "-I", str(WORKER), "--download", WHISPER_MODEL, str(MODELS_DIR)], **flags)
            if r.returncode:
                raise RuntimeError((r.stderr or r.stdout)[-400:])
            (MODELS_DIR / ".ready").write_text(WHISPER_MODEL)
            install_state["status"] = "done"
        except Exception as e:
            install_state.update(status="error", error=str(e)[:400])

    threading.Thread(target=work, daemon=True).start()


def transcribe(audio: bytes, suffix=".webm"):
    """Audio bytes from the browser's MediaRecorder -> {"text", "seconds"}. One warm worker keeps the model loaded."""
    global _worker
    if not whisper_ready():
        return {"error": "Voice isn't set up yet."}
    tmp = DATA_HOME / "tmp"
    tmp.mkdir(exist_ok=True)
    path = tmp / f"answer{suffix}"
    with _worker_lock:  # ponytail: one transcription at a time; fine for a single local user
        path.write_bytes(audio)  # overwritten by the next recording; nothing is kept
        for attempt in (1, 2):
            if _worker is None or _worker.poll() is not None:
                _worker = subprocess.Popen([str(_py()), "-I", str(WORKER), "--serve", WHISPER_MODEL, str(MODELS_DIR)],
                                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            try:
                _worker.stdin.write(json.dumps({"path": str(path)}) + "\n"); _worker.stdin.flush()
                line = _worker.stdout.readline()
                if line:
                    return json.loads(line)
            except (BrokenPipeError, OSError, ValueError):
                pass
            _worker = None
        return {"error": "Speech recognition stopped unexpectedly. Try again."}


@atexit.register
def stop_worker():
    if _worker and _worker.poll() is None:
        _worker.terminate()


if __name__ == "__main__":  # self-check for the parts that don't need a model
    s = speech_stats("um so basically the um driver builds a plan you know and um executors run it " * 3, seconds=20)
    assert s["fillers"]["um"] == 9 and s["fillers"]["basically"] == 3 and s["wpm"] == 144, s
    assert _json('Sure!\n{"rubric": [{"point": 1, "status": "covered"}]}\nDone')["rubric"][0]["status"] == "covered"
    assert _json('```json\n{"rubric": [{"point": 1, "status": "partial"},],}\n```')["rubric"][0]["status"] == "partial"
    assert _json("no json here") is None and _json('{"broken": ') is None
    tracks = content.load_interview()
    for tid, t in tracks.items():
        for lv in LEVELS:
            m = pick(t, lv, "mock", seed=1)
            assert len({q["id"] for q in m}) == len(m), (tid, lv)
    print("interview self-check ok")
