"""Tests for scripts/serve.py, the locked-down local dev server.

Run: python -m unittest discover -s tests -p "test_*.py"
"""
import http.client
import os
import sys
import threading
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import serve  # noqa: E402


class ServeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        serve.LockedDownHandler.log_message = lambda *args: None  # keep test output clean
        cls.server = serve.make_server(port=0)  # 0 = any free port
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def get(self, path, host=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Host": host if host is not None else f"localhost:{self.port}"}
        conn.request("GET", path, headers=headers)
        resp = conn.getresponse()
        body = resp.read()
        conn.close()
        return resp.status, resp.getheader("Content-Type") or "", body

    def test_binds_to_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_serves_the_app(self):
        status, ctype, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", ctype)
        self.assertIn(b"SpectroKey", body)

    def test_serves_modules_as_javascript(self):
        status, ctype, _ = self.get("/src/app.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", ctype)

    def test_no_directory_listings(self):
        for path in ("/src/", "/docs/", "/tests/", "/scripts/"):
            with self.subTest(path=path):
                status, _, body = self.get(path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"Directory listing", body)

    def test_hidden_paths_are_not_served(self):
        for path in ("/.git/", "/.git/config", "/.gitignore", "/.superpowers/",
                     "/.claude/launch.json", "/src/.hidden"):
            with self.subTest(path=path):
                self.assertEqual(self.get(path)[0], 404)

    def test_encoded_hidden_and_traversal_paths_are_not_served(self):
        for path in ("/%2egit/config", "/src/%2e%2e/.git/config",
                     "/..%2f..%2fREADME.md", "/src/../../SpectroKey/.git/config"):
            with self.subTest(path=path):
                self.assertEqual(self.get(path)[0], 404)

    def test_allowed_host_headers(self):
        for host in ("localhost", f"localhost:{self.port}", f"127.0.0.1:{self.port}",
                     f"[::1]:{self.port}"):
            with self.subTest(host=host):
                self.assertEqual(self.get("/", host=host)[0], 200)

    def test_rejects_foreign_host_header(self):
        # A DNS-rebinding page would send its own domain as Host.
        for host in ("evil.example", "evil.example:8000", "localhost.evil.example", ""):
            with self.subTest(host=host):
                self.assertEqual(self.get("/", host=host)[0], 403)


if __name__ == "__main__":
    unittest.main()
