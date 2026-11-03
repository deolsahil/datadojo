"""Desktop app entry point (the packaged DataDojo.app / DataDojo.exe).

Runs the same local server in a background thread and shows it in a native window (pywebview:
WebKit on macOS, Edge WebView2 on Windows). Also doubles as the code runner: a frozen app has no
python to call, so the server re-launches this executable with --runner.
"""
import sys
import threading


def use_system_certificates():
    """The bundled OpenSSL looks for certificates at a path from the build machine (/tmp/libpq.build/cert.pem),
    so every HTTPS call through urllib failed (ChatGPT sign-in: "URLError"). Point it at the OS bundle instead.
    Windows reads its own certificate store, so this only matters on macOS and Linux."""
    import os
    import ssl
    if os.environ.get("SSL_CERT_FILE") or os.path.exists(ssl.get_default_verify_paths().openssl_cafile or ""):
        return
    for f in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt"):
        if os.path.exists(f):
            os.environ["SSL_CERT_FILE"] = f  # inherited by the code runner too
            return


def main():
    use_system_certificates()
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
        if sys.platform.startswith("linux"):
            raise ImportError("Linux builds use the browser")  # GTK/Qt webviews aren't bundled
        import webview
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        webview.create_window("DataDojo", url, width=1440, height=900, min_size=(1100, 700), background_color="#0b0d11")
        # private_mode=False + storage_path keeps localStorage (name, theme, chats) across launches
        webview.start(private_mode=False, storage_path=str(DATA_HOME / "webview"))
        httpd.shutdown()  # window closed: stop the server; atexit stops Postgres
    except Exception:  # no native window available: use the browser instead
        import webbrowser
        print(f"DataDojo is running at {url} (Ctrl+C to stop)")
        webbrowser.open(url)
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            httpd.shutdown()


if __name__ == "__main__":
    main()
