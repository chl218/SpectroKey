"""Local dev server for SpectroKey, locked down for development use.

Unlike `python -m http.server`, this server:
  * listens on 127.0.0.1 only, so other machines can't reach it;
  * serves only this project folder;
  * never shows directory listings;
  * never serves hidden paths (.git, .claude, .superpowers, dotfiles);
  * refuses paths that resolve outside the project (e.g. via symlinks);
  * rejects requests whose Host header isn't localhost, which blocks
    DNS-rebinding pages from reading local files.

Usage:  python scripts/serve.py [--port 8000]
"""
import argparse
import functools
import http.server
import os
import urllib.parse

ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
BIND = "127.0.0.1"
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "[::1]"}


def host_without_port(host_header):
    """'localhost:8000' -> 'localhost', '[::1]:8000' -> '[::1]'."""
    host = (host_header or "").strip().lower()
    if host.startswith("["):
        end = host.find("]")
        return host[: end + 1] if end != -1 else host
    return host.rsplit(":", 1)[0] if ":" in host else host


class LockedDownHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        if host_without_port(self.headers.get("Host")) not in ALLOWED_HOSTS:
            self.send_error(403, "Forbidden host")
            return None

        url_path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        # Any '.'-prefixed segment, including '..', is refused outright.
        if any(seg.startswith(".") for seg in url_path.split("/")):
            self.send_error(404)
            return None

        fs_path = os.path.realpath(self.translate_path(self.path))
        if fs_path != ROOT and not fs_path.startswith(ROOT + os.sep):
            self.send_error(404)
            return None

        return super().send_head()

    def list_directory(self, path):
        # Folders without an index.html are not browsable.
        self.send_error(404)
        return None


def make_server(port=8000):
    handler = functools.partial(LockedDownHandler, directory=ROOT)
    return http.server.ThreadingHTTPServer((BIND, port), handler)


def main():
    parser = argparse.ArgumentParser(description="Serve SpectroKey on localhost only.")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = make_server(args.port)
    print(f"Serving SpectroKey at http://localhost:{server.server_address[1]}/  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
