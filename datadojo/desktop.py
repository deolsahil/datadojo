"""Desktop app entry point (the packaged DataDojo.app / DataDojo.exe).

Runs the same local server in a background thread and shows it in a native window (pywebview:
WebKit on macOS, Edge WebView2 on Windows). Also doubles as the code runner: a frozen app has no
python to call, so the server re-launches this executable with --runner.
"""
import sys
import threading


def main():
    if sys.argv[1:2] == ["--runner"]:
        from datadojo import runner
        return runner.main(sys.argv[2:])

    from http.server import ThreadingHTTPServer
    from datadojo.__main__ import free_port
    from datadojo.paths import DATA_HOME
    from datadojo.server import Handler

    port = free_port(8517)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)  # loopback only
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/"
    try:
        import webview
    except ImportError:  # no native window available: fall back to the browser
        import webbrowser
        webbrowser.open(url)
        httpd.serve_forever()
        return
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    webview.create_window("DataDojo", url, width=1440, height=900, min_size=(1100, 700), background_color="#0b0d11")
    # private_mode=False + storage_path keeps localStorage (name, theme, chats) across launches
    webview.start(private_mode=False, storage_path=str(DATA_HOME / "webview"))
    httpd.shutdown()  # window closed: stop the server; atexit stops Postgres


if __name__ == "__main__":
    main()
