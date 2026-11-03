"""The coaches' brain: local Ollama, the learner's own API key, or signing in (Claude, OpenAI, Gemini).

Settings live in DATA_HOME/settings.json (mode 0600). Keys and sign-in tokens never leave this machine except to
the provider they belong to, and are never sent back to the browser (only a masked hint).
"""
import base64, hashlib, json, os, re, secrets, shutil, ssl, subprocess, threading, time, urllib.error, urllib.parse, urllib.request, uuid

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
                  "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-fable-5",
                             "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
                             "claude-sonnet-4-6", "claude-haiku-4-5"]},
    "openai": {"title": "OpenAI", "key_hint": "sk-…", "key_url": "https://platform.openai.com/api-keys",
               "models": ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-sol", "gpt-6-luna", "gpt-6-rosalind"]},
    "gemini": {"title": "Gemini (Google)", "key_hint": "AIza…", "key_url": "https://aistudio.google.com/app/apikey",
               "models": ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-pro-preview"]},
}  # built-in lists until a key or sign-in lists the live ones; providers only list live models, so retired ones vanish
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
    return {k2: v for k2, v in s.items() if k2 not in ("api_key", "openai_oauth")} | {"key_hint": f"{k[:6]}…{k[-4:]}" if len(k) > 12 else ("set" if k else "")}


# ---- providers --------------------------------------------------------------

def _http(url, body=None, headers=None, timeout=180):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _anthropic(s, system, messages, json_mode=False):  # Claude follows "reply with only JSON" reliably
    import anthropic
    client = anthropic.Anthropic(api_key=s["api_key"] or None)  # None: SDK falls back to env / `ant auth login`
    extra = {} if s["model"].startswith("claude-haiku") else {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    resp = client.beta.messages.create(model=s["model"], max_tokens=16000, system=system, messages=messages,
                                       output_config={"effort": "low"}, **extra)  # short coaching replies: low effort
    if resp.stop_reason == "refusal":
        return "I can't help with that one. Let's get back to the problem: what are you trying right now?"
    return "".join(b.text for b in resp.content if b.type == "text")


def _openai(s, system, messages, json_mode=False):
    if s.get("auth") == "signin":
        return _openai_plan(s, system, messages, json_mode)
    r = _http("https://api.openai.com/v1/chat/completions",
              {"model": s["model"], "messages": [{"role": "system", "content": system}] + messages}
              | ({"response_format": {"type": "json_object"}} if json_mode else {}),
              {"Authorization": f"Bearer {s['api_key']}"})
    return r["choices"][0]["message"]["content"]


def _gemini(s, system, messages, json_mode=False):
    url, headers = _gemini_endpoint(s, f"models/{s['model']}:generateContent")
    r = _http(url,
              {"systemInstruction": {"parts": [{"text": system}]},
               "contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                            for m in messages]}
              | ({"generationConfig": {"responseMimeType": "application/json"}} if json_mode else {}),
              headers)
    return "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"])


def _ollama(s, system, messages, json_mode=False):
    r = _http(f"{OLLAMA}/api/chat", {"model": s["model"], "stream": False,
                                     "messages": [{"role": "system", "content": system}] + messages}
              | ({"format": "json"} if json_mode else {}))
    return r["message"]["content"]


def chat(system, messages, strict=False, json_mode=False):
    """strict=True raises instead of returning the friendly error text (for replies we cache).
    json_mode=True asks the provider to emit valid JSON (local models otherwise break it now and then)."""
    s = load()
    messages = [m for m in messages[-12:] if m.get("content")]
    fn = {"anthropic": _anthropic, "openai": _openai, "gemini": _gemini}.get(s["provider"], _ollama)
    try:
        try:
            return fn(s, system, messages, json_mode)
        except Exception as e:
            code = getattr(e, "status_code", None) or getattr(e, "code", None)
            if s["provider"] not in PROVIDERS or code not in (400, 404) or "model" not in str(getattr(e, "message", "") or e).lower() + _body(e):
                raise
            new = replacement(s["provider"], s["model"])  # the saved model was retired: move to its newest sibling
            if not new:
                raise
            s = s | {"model": new}
            save(load() | {"model": new})
            return fn(s, system, messages, json_mode)
    except Exception as e:  # coaching is best-effort; the page tells the learner how to fix it
        if strict:
            raise
        if s.get("coach_skipped") and s["provider"] not in PROVIDERS:  # setup was skipped and no local model answers
            return ("Coaching isn't turned on yet, so I can't give hints or reviews. You can still solve every problem and "
                    "run the tests as usual. To turn me on, open **coach setup** under this chat and pick an API key, "
                    "a sign-in, or a free local model.")
        where = PROVIDERS.get(s["provider"], {}).get("title", "Ollama")
        return f"I can't reach my brain right now ({where}: {_reason(e)}). Open **Coach setup** from your profile to fix it."


def _body(e):
    try:
        return e.read().decode("utf-8", "replace").lower() if isinstance(e, urllib.error.HTTPError) else ""
    except Exception:
        return ""


def _reason(e):
    if isinstance(e, urllib.error.HTTPError):
        return f"HTTP {e.code}"
    if isinstance(e, urllib.error.URLError):  # say what failed underneath ("URLError" alone told the learner nothing)
        r = e.reason
        if isinstance(r, ssl.SSLCertVerificationError):
            return "this computer's security certificates couldn't be checked"
        return f"no connection: {getattr(r, 'strerror', None) or r}"
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


_SKIP = re.compile(r"audio|realtime|tts|transcribe|image|search|embed|instruct|moderation|codex|computer|live|aqa|learnlm|"
                   r"daybreak|cyber|translate|latest|customtools|-\d{8}$|-\d{4}-\d{2}-\d{2}$|-\d{4}$|-\d{3}$|preview-\d")  # snapshots, aliases, non-chat


# ---- model catalog: what each provider offers today, before the learner connects --------------------------
# models.dev is an open model catalog (no key needed). Refreshed at most daily in the background and cached, so new
# models appear and retired ("deprecated") ones disappear without a DataDojo release. Built-in lists are the fallback.
CATALOG = DATA_HOME / "model-catalog.json"
_catalog_lock = threading.Lock()


def _refresh_catalog():
    if not _catalog_lock.acquire(blocking=False):
        return
    try:
        req = urllib.request.Request("https://models.dev/api.json", headers={"User-Agent": "DataDojo"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
        out = {}
        for ours, theirs in (("anthropic", "anthropic"), ("openai", "openai"), ("gemini", "google")):
            models = (data.get(theirs) or {}).get("models") or {}
            keep = [(m.get("release_date") or "", mid) for mid, m in models.items()
                    if m.get("status") != "deprecated" and "text" in (m.get("modalities") or {}).get("output", ["text"])
                    and not _SKIP.search(mid) and re.match({"openai": r"(gpt-|o\d|chatgpt-)", "gemini": r"gemini-"}.get(ours, ""), mid)]
            if keep:
                out[ours] = [mid for _, mid in sorted(keep, reverse=True)]
        if out:
            CATALOG.write_text(json.dumps({"fetched_at": time.time(), "models": out}))
    except Exception:
        pass  # offline or catalog down: keep the last good copy, else the built-in lists
    finally:
        _catalog_lock.release()


def catalog_models(provider):
    """Current models for a provider, newest first. Kicks off a background refresh when the cache is a day old."""
    try:
        c = json.loads(CATALOG.read_text())
    except (OSError, ValueError):
        c = {}
    if time.time() - c.get("fetched_at", 0) > 86400:
        threading.Thread(target=_refresh_catalog, daemon=True).start()
    return c.get("models", {}).get(provider) or PROVIDERS[provider]["models"]


def replacement(provider, retired):
    """The newest model in the same family as a retired one (claude-sonnet-x -> newest claude-sonnet), else the newest."""
    live = list_models(provider, load().get("api_key", "") if load().get("provider") == provider else "")["models"]
    family = lambda m: re.sub(r"-+", "-", re.sub(r"\d+(\.\d+)?", "", m)).strip("-")  # gemini-2.5-flash -> gemini-flash
    same = [m for m in live if m != retired and family(m) == family(retired)]
    return (same or [m for m in live if m != retired] or [None])[0]


def list_models(provider, api_key):
    """Chat models this key can use right now, newest first. Providers only list live models, so retired ones
    drop out by themselves. Falls back to the built-in list when there's no key or the call fails."""
    fallback = {"models": catalog_models(provider), "source": "catalog"}
    s = load()
    signed_in = not api_key and (s.get("provider") == provider and s.get("auth") == "signin"  # saved, or just signed in
                                 or provider == "openai" and bool((s.get("openai_oauth") or {}).get("access_token"))
                                 or provider == "gemini" and signins["gemini"]["status"] == "done")
    if not api_key and provider != "anthropic" and not signed_in:  # Claude can also list through an `ant auth login` profile
        return fallback
    try:
        if signed_in and provider == "openai":  # the models this ChatGPT plan may use
            data = _http("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {_openai_token(s)}"}, timeout=20)
            ids = [m["slug"] for m in data.get("models", []) if m.get("visibility", "list") == "list"] \
                or [m["id"] for m in data.get("data", []) if not _SKIP.search(m["id"])]
            return {"models": ids, "live": True} if ids else fallback
        if signed_in and provider == "gemini":
            _gemini_token()  # Vertex AI has no simple per-account list; confirm the sign-in works and offer the built-in list
            return fallback
        if provider == "anthropic":
            import anthropic
            data = list(anthropic.Anthropic(api_key=api_key or None, timeout=20).models.list())
            ids = [m.id for m in sorted(data, key=lambda m: m.created_at, reverse=True)]
        elif provider == "openai":
            data = _http("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {api_key}"}, timeout=20)["data"]
            ids = [m["id"] for m in sorted(data, key=lambda m: m.get("created", 0), reverse=True)
                   if re.match(r"(gpt-|o\d|chatgpt-)", m["id"]) and not _SKIP.search(m["id"])]
        else:
            data = _http("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
                         headers={"x-goog-api-key": api_key}, timeout=20)["models"]
            ids = [m["name"].removeprefix("models/") for m in data
                   if "generateContent" in m.get("supportedGenerationMethods", [])
                   and m["name"].startswith("models/gemini") and not _SKIP.search(m["name"])]
            ids.sort(key=lambda i: [int(x) if x.isdigit() else 0 for x in re.findall(r"\d+", i)][:2], reverse=True)
        return {"models": ids, "live": True} if ids else fallback
    except Exception as e:
        return fallback | {"error": _reason(e)}


# ---- sign in instead of pasting a key ------------------------------------------
# Claude: Anthropic's `ant` CLI signs in through the browser and stores an OAuth profile that the anthropic SDK reads
#   when no key is passed. Billed to the learner's Anthropic Console account.
# OpenAI: "Sign in with ChatGPT" (OAuth + PKCE, open-source self-registration). Requests run on the learner's ChatGPT
#   plan through the Responses API. Tokens live in settings.json (0600).
# Google: Google's `gcloud` CLI signs in (Application Default Credentials) and Gemini runs on Vertex AI, billed to the
#   learner's Google Cloud project.

signins = {p: {"status": "idle"} for p in ("anthropic", "openai", "gemini")}
CLI = {"anthropic": "ant", "gemini": "gcloud"}


def which(tool):
    """shutil.which plus Homebrew's folders, which a desktop app's PATH usually lacks."""
    extra = os.pathsep.join(["/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/go/bin")])
    return shutil.which(tool) or shutil.which(tool, path=extra)


def signin_state():
    return {p: st | ({"installed": bool(which(CLI[p]))} if p in CLI else {})
            | ({"can_install": bool(which("brew"))} if p == "anthropic" else {}) for p, st in signins.items()}


def _run_signin(provider, work):
    def run():
        try:
            err = work()
        except Exception as e:
            err = str(e)
        signins[provider].update(status="error", error=err) if err else signins[provider].update(status="done", error=None)
    signins[provider].update(status="running", error=None)
    threading.Thread(target=run, daemon=True).start()


def start_signin(provider, project=None, redirect_uri=None, install=False):
    """Kick off a browser sign-in. Returns {"url"} for OpenAI (the app opens it), else the sign-in state.
    install=True (Claude only, after the learner agreed): install Anthropic's `ant` CLI with Homebrew first."""
    st = signins[provider]
    if provider in CLI and not which(CLI[provider]) and not (provider == "anthropic" and install and which("brew")):
        return signin_state()[provider]
    if provider == "anthropic":
        def work():
            if not which("ant"):
                st.update(step="installing")
                r = subprocess.run([which("brew"), "install", "anthropics/tap/ant"], capture_output=True, text=True, timeout=900)
                if r.returncode or not which("ant"):
                    return "Couldn't install ant with Homebrew: " + ((r.stderr or r.stdout).strip().splitlines() or ["unknown error"])[-1][:200]
            st.update(step="signing-in")
            env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}  # they'd outrank the profile
            r = subprocess.run([which("ant"), "auth", "login"], env=env, capture_output=True, text=True, timeout=600)
            if r.returncode:
                return (r.stderr or r.stdout).strip()[-300:] or "sign-in failed"
            return test("anthropic", "claude-haiku-5-5", "")  # confirm the new profile really works
        _run_signin(provider, work)
    elif provider == "gemini":
        def work():
            r = subprocess.run([which("gcloud"), "auth", "application-default", "login"], capture_output=True, text=True, timeout=600)
            if r.returncode:
                return (r.stderr or r.stdout).strip()[-300:] or "sign-in failed"
            proj = project or subprocess.run([which("gcloud"), "config", "get-value", "project"], capture_output=True, text=True).stdout.strip()
            if not proj or proj == "(unset)":
                return "Signed in, but no Google Cloud project is set. Enter your project ID and try again."
            st["project"] = proj
            _gemini_token(force=True)  # proves the sign-in works
            return _vertex_check(proj)  # and that Gemini on Vertex AI really answers for this project
        _run_signin(provider, work)
    else:
        return {"url": _openai_authorize(redirect_uri)}
    return signin_state()[provider]


# OpenAI: Sign in with ChatGPT
OA_AUTH, OA_TOKEN, OA_RESOURCE = "https://auth.openai.com/api/accounts/authorize", "https://auth.openai.com/api/accounts/oauth/token", "https://api.openai.com/v1"
OA_SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
_oa_pending = {}  # state -> verifier, redirect_uri, client_id


def _openai_authorize(redirect_uri):
    s = load()
    oa = s.get("openai_oauth") or {}
    if not oa.get("host_id"):  # one stable id for this computer, chosen before the first sign-in
        oa["host_id"] = f"urn:uuid:{uuid.uuid4()}"
        save(s | {"openai_oauth": oa})
    verifier, state = secrets.token_urlsafe(64), secrets.token_urlsafe(24)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    client_id = oa.get("client_id") or "dynamic_agent_client"  # first sign-in registers DataDojo for this computer
    _oa_pending[state] = {"verifier": verifier, "redirect_uri": redirect_uri, "client_id": oa.get("client_id")}
    q = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "scope": OA_SCOPE,
         "resource": OA_RESOURCE, "state": state, "nonce": secrets.token_urlsafe(24), "code_challenge": challenge,
         "code_challenge_method": "S256", "ext_agent_host_id": oa["host_id"]}
    if not oa.get("client_id"):
        q["agent_name_hint"] = "DataDojo"
    signins["openai"].update(status="running", error=None)
    return f"{OA_AUTH}?{urllib.parse.urlencode(q)}"


def _form(url, fields):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def openai_callback(query):
    """The browser comes back to /auth/callback. Returns None on success, else what went wrong."""
    p = _oa_pending.pop(query.get("state", ""), None)
    err = None
    if not p:
        err = "This sign-in link expired or was already used. Start again from DataDojo."
    elif query.get("error"):
        err = ("Sign-in was cancelled." if query["error"] == "access_denied" else
               "Your ChatGPT workspace doesn't allow sign-in for open-source apps (OpenAI blocks Enterprise and Team "
               "workspaces for now). Use a personal ChatGPT account, or an API key." if "policy_denied" in query["error"]
               else f"OpenAI said: {query.get('error_description') or query['error']}")
    elif p["client_id"] and query.get("client_id") and query["client_id"] != p["client_id"]:
        err = "OpenAI answered for a different app registration; sign-in stopped."
    if not err:
        client_id = p["client_id"] or query.get("client_id")
        try:
            tok = _form(OA_TOKEN, {"grant_type": "authorization_code", "client_id": client_id, "code": query.get("code", ""),
                                   "code_verifier": p["verifier"], "redirect_uri": p["redirect_uri"], "resource": OA_RESOURCE})
            if "chatgpt.tokens.use.direct" not in tok.get("scope", OA_SCOPE).split():
                err = "Signed in, but this ChatGPT account didn't allow DataDojo to use its plan."
            else:
                s = load()
                oa = (s.get("openai_oauth") or {}) | {"client_id": client_id, "access_token": tok["access_token"],
                                                       "refresh_token": tok.get("refresh_token"),
                                                       "expires_at": time.time() + int(tok.get("expires_in", 3600))}
                save(s | {"openai_oauth": oa})
        except Exception as e:
            err = f"Couldn't finish signing in ({_reason(e)})."
    signins["openai"].update(status="error", error=err) if err else signins["openai"].update(status="done", error=None)
    return err


def _openai_token(s):
    oa = s.get("openai_oauth") or {}
    if not oa.get("access_token"):
        raise RuntimeError("not signed in to ChatGPT")
    if oa.get("expires_at", 0) - 60 < time.time() and oa.get("refresh_token"):  # refresh; the refresh token rotates
        tok = _form(OA_TOKEN, {"grant_type": "refresh_token", "client_id": oa["client_id"],
                               "refresh_token": oa["refresh_token"], "resource": OA_RESOURCE})
        oa |= {"access_token": tok["access_token"], "refresh_token": tok.get("refresh_token", oa["refresh_token"]),
               "expires_at": time.time() + int(tok.get("expires_in", 3600))}
        save(load() | {"openai_oauth": oa})
    return oa["access_token"]


def _openai_plan(s, system, messages, json_mode=False):
    """Responses API with the ChatGPT sign-in token: always streamed and never stored, as OpenAI requires."""
    body = {"model": s["model"], "instructions": system, "stream": True, "store": False,
            "input": [{"role": m["role"], "content": m["content"]} for m in messages]}
    if json_mode:
        body["text"] = {"format": {"type": "json_object"}}
    req = urllib.request.Request("https://api.openai.com/v1/responses", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {_openai_token(s)}"})
    out = []
    with urllib.request.urlopen(req, timeout=180) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:") or line == "data: [DONE]":
                continue
            ev = json.loads(line[5:])
            if ev.get("type") == "response.output_text.delta":
                out.append(ev.get("delta", ""))
            elif ev.get("type") == "response.failed":
                code = ((ev.get("response") or {}).get("error") or {}).get("code", "")
                raise RuntimeError("your ChatGPT plan's limit for DataDojo is used up for now" if "usage_limit" in code else code or "request failed")
            elif ev.get("type") == "response.completed":
                break
    return "".join(out)


# Google: gcloud sign-in, Gemini on Vertex AI
_gtoken = {"token": None, "at": 0.0}


def _gemini_token(force=False):
    if force or not _gtoken["token"] or time.time() - _gtoken["at"] > 1800:  # gcloud's tokens last an hour
        r = subprocess.run([which("gcloud") or "gcloud", "auth", "application-default", "print-access-token"], capture_output=True, text=True, timeout=30)
        if r.returncode or not r.stdout.strip():
            raise RuntimeError("Google sign-in expired; sign in again from Coach setup")
        _gtoken.update(token=r.stdout.strip(), at=time.time())
    return _gtoken["token"]


def _vertex_check(proj):
    """One tiny request (a single output token) so a disabled API or a wrong project shows up now, not mid-coaching."""
    url, headers = _gemini_endpoint({"auth": "signin", "gcp_project": proj}, f"models/{catalog_models('gemini')[0]}:generateContent")
    try:
        _http(url, {"contents": [{"role": "user", "parts": [{"text": "hi"}]}], "generationConfig": {"maxOutputTokens": 1}},
              headers, timeout=60)
        return None
    except urllib.error.HTTPError as e:
        body = _body(e)
        if "service_disabled" in body or "has not been used" in body or "is disabled" in body:
            return (f"Signed in, but the Vertex AI API is off in project {proj}. Turn it on at "
                    f"https://console.cloud.google.com/apis/library/aiplatform.googleapis.com?project={proj} and try again.")
        if "consumer_invalid" in body or (e.code in (403, 404) and "project" in body):
            return (f"Signed in, but Google won't run anything in project {proj}: the ID may be misspelled, the project may be "
                    "deleted or scheduled for deletion, or your account has no access to it. Try another project ID.")
        if e.code == 404:
            return None  # this model isn't offered in the project's region; sign-in itself is fine
        return f"Signed in, but Gemini on Vertex AI answered HTTP {e.code}."


def _gemini_endpoint(s, path):
    if s.get("auth") == "signin":
        proj = s.get("gcp_project")
        return (f"https://aiplatform.googleapis.com/v1/projects/{proj}/locations/global/publishers/google/{path}",
                {"Authorization": f"Bearer {_gemini_token()}", "x-goog-user-project": proj})
    return f"https://generativelanguage.googleapis.com/v1beta/{path}", {"x-goog-api-key": s["api_key"]}


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
