"""`datadojo` command.

  datadojo                      start the app and open it in your browser
  datadojo --port 9000          use a specific port (default 8517, or the next free one)
  datadojo --no-browser         don't open a browser tab
  datadojo check [SEL...]       verify problems (SEL = problem id, pattern id or lang)
  datadojo check sql --engine postgres   which reference solutions also run on another engine
  datadojo content              validate design lessons and game items
"""
import argparse, socket, sys, threading, webbrowser
from http.server import ThreadingHTTPServer


def free_port(start):
    for port in range(start, start + 50):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise SystemExit("No free port found near %d; pass --port." % start)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["check"]:
        from datadojo.server import check
        args = argv[1:]
        eng = args.pop(args.index("--engine") + 1) if "--engine" in args else None
        sys.exit(not check([a for a in args if a != "--engine"], eng))
    if argv[:1] == ["content"]:
        from datadojo import content
        return content.check()

    ap = argparse.ArgumentParser(prog="datadojo", description="Local SQL / Python / PySpark practice.")
    ap.add_argument("--port", type=int)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args(argv)
    from datadojo.paths import DATA_HOME
    from datadojo.server import Handler
    port = a.port or free_port(8517)
    url = f"http://127.0.0.1:{port}/"
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)  # loopback only: never reachable from the network
    print(f"DataDojo is running at {url}\nYour progress and settings: {DATA_HOME}\nPress Ctrl+C to stop.")
    if not a.no_browser:
        threading.Timer(0.6, webbrowser.open, [url]).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye! Keep the streak going.")


if __name__ == "__main__":
    main()
