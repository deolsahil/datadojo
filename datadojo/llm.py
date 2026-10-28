"""The coaches' brain: local Ollama or the learner's own API key (Claude, OpenAI, Gemini).

Settings live in DATA_HOME/settings.json (mode 0600). API keys never leave this machine except to the
provider they belong to, and are never sent back to the browser (only a masked hint).
"""
import json, os, threading, urllib.error, urllib.request

from datadojo.paths import DATA_HOME

SETTINGS = DATA_HOME / "settings.json"
OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")

LOCAL_MODELS = [  # local model sizes offered in setup
    {"id": "gemma2:2b", "title": "Small", "size": "~1.6 GB download · 8 GB RAM",
     "desc": "Fastest, and fine on older or lower-power machines. Answers are noticeably less sharp."},
    {"id": "gemma2:9b", "title": "Balanced", "size": "~5.4 GB download · 16 GB RAM recommended",
     "desc": "The best mix of quality and speed for most machines. DataDojo's default.", "recommended": True},
    {"id": "gemma2:27b", "title": "Best quality", "size": "~16 GB download · 32 GB RAM recommended",
     "desc": "The sharpest local feedback, but needs a powerful machine and plenty of free disk."},
]
PROVIDERS = {
    "anthropic": {"title": "Claude (Anthropic)", "key_hint": "sk-ant-…", "key_url": "https://console.anthropic.com/settings/keys",
                  "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]},
    "openai": {"title": "OpenAI", "key_hint": "sk-…", "key_url": "https://platform.openai.com/api-keys",
               "models": ["gpt-4o-mini", "gpt-4o"]},
    "gemini": {"title": "Gemini (Google)", "key_hint": "AIza…", "key_url": "https://aistudio.google.com/app/apikey",
               "models": ["gemini-2.5-flash", "gemini-2.5-pro"]},
}
DEFAULTS = {"provider": "ollama", "model": "gemma2:9b", "api_key": "", "setup_done": False}
_lock = threading.Lock()
pulls = {}  # model -> {"status", "completed", "total", "error"}


def load():
    try:
        return DEFAULTS | json.loads(SETTINGS.read_text())
    except (OSError, ValueError):
        return dict(DEFAULTS)


def save(s):
    with _lock:
        tmp = SETTINGS.with_suffix(".tmp")
        tmp.write_text(json.dumps(s, indent=1))
        os.chmod(tmp, 0o600)
        tmp.replace(SETTINGS)


def public(s=None):
    """Settings safe to show in the UI: the key is masked."""
    s = s or load()
    k = s.get("api_key") or ""
    return {k2: v for k2, v in s.items() if k2 != "api_key"} | {"key_hint": f"{k[:6]}…{k[-4:]}" if len(k) > 12 else ("set" if k else "")}


# ---- providers --------------------------------------------------------------

def _http(url, body=None, headers=None, timeout=180):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _anthropic(s, system, messages):
    import anthropic
    client = anthropic.Anthropic(api_key=s["api_key"] or None)  # None: SDK falls back to env / `ant auth login`
    extra = {} if s["model"].startswith("claude-haiku") else {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    resp = client.beta.messages.create(model=s["model"], max_tokens=16000, system=system, messages=messages,
                                       output_config={"effort": "low"}, **extra)  # short coaching replies: low effort
    if resp.stop_reason == "refusal":
        return "I can't help with that one. Let's get back to the problem: what are you trying right now?"
    return "".join(b.text for b in resp.content if b.type == "text")


def _openai(s, system, messages):
    r = _http("https://api.openai.com/v1/chat/completions",
              {"model": s["model"], "messages": [{"role": "system", "content": system}] + messages},
              {"Authorization": f"Bearer {s['api_key']}"})
    return r["choices"][0]["message"]["content"]


def _gemini(s, system, messages):
    r = _http(f"https://generativelanguage.googleapis.com/v1beta/models/{s['model']}:generateContent",
              {"systemInstruction": {"parts": [{"text": system}]},
               "contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                            for m in messages]},
              {"x-goog-api-key": s["api_key"]})
    return "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"])


def _ollama(s, system, messages):
    r = _http(f"{OLLAMA}/api/chat", {"model": s["model"], "stream": False,
                                     "messages": [{"role": "system", "content": system}] + messages})
    return r["message"]["content"]


def chat(system, messages):
    s = load()
    messages = [m for m in messages[-12:] if m.get("content")]
    try:
        fn = {"anthropic": _anthropic, "openai": _openai, "gemini": _gemini}.get(s["provider"], _ollama)
        return fn(s, system, messages)
    except Exception as e:  # coaching is best-effort; the page tells the learner how to fix it
        where = PROVIDERS.get(s["provider"], {}).get("title", "Ollama")
        return f"I can't reach my brain right now ({where}: {_reason(e)}). Open **Coach setup** from your profile to fix it."


def _reason(e):
    if isinstance(e, urllib.error.HTTPError):
        return f"HTTP {e.code}"
    return getattr(e, "message", None) or type(e).__name__


def test(provider, model, api_key):
    """Cheap check that a key/model works. Returns None if fine, else a message."""
    try:
        if provider == "anthropic":
            import anthropic
            anthropic.Anthropic(api_key=api_key or None).models.retrieve(model)  # no tokens spent
        elif provider == "openai":
            _http(f"https://api.openai.com/v1/models/{model}", headers={"Authorization": f"Bearer {api_key}"}, timeout=20)
        elif provider == "gemini":
            _http(f"https://generativelanguage.googleapis.com/v1beta/models/{model}", headers={"x-goog-api-key": api_key}, timeout=20)
        elif model not in ollama_status()["models"]:
            return f"{model} isn't downloaded in Ollama yet."
        return None
    except Exception as e:
        code = getattr(e, "status_code", None) or getattr(e, "code", None)
        if code in (401, 403):
            return "That key was rejected. Check it was copied completely."
        if code == 404:
            return f"The model {model} isn't available for this key."
        return f"Couldn't reach {PROVIDERS.get(provider, {}).get('title', provider)} ({_reason(e)})."


# ---- local (Ollama) ---------------------------------------------------------

def ollama_status():
    import shutil, sys
    installed = bool(shutil.which("ollama")) or (sys.platform == "darwin" and os.path.exists("/Applications/Ollama.app"))
    try:
        models = [m["name"] for m in _http(f"{OLLAMA}/api/tags", timeout=3)["models"]]
        running = True
    except Exception:
        models, running = [], False
    return {"installed": installed or running, "running": running, "models": models, "pulls": pulls}


def pull(model):
    """Download a model through Ollama in the background; progress is reported in ollama_status()['pulls']."""
    if pulls.get(model, {}).get("status") not in (None, "error", "success"):
        return
    pulls[model] = {"status": "starting", "completed": 0, "total": 0}

    def work():
        try:
            req = urllib.request.Request(f"{OLLAMA}/api/pull", data=json.dumps({"model": model, "stream": True}).encode(),
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=3600) as r:
                for line in r:
                    ev = json.loads(line or b"{}")
                    if ev.get("error"):
                        raise RuntimeError(ev["error"])
                    pulls[model] = {"status": ev.get("status", ""), "completed": ev.get("completed", pulls[model]["completed"]),
                                    "total": ev.get("total", pulls[model]["total"])}
            pulls[model]["status"] = "success"
        except Exception as e:
            pulls[model] = {"status": "error", "error": str(e), "completed": 0, "total": 0}

    threading.Thread(target=work, daemon=True).start()
