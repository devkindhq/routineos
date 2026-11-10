"""The template fetchers that read a person's own Worker refuse a redirect instead of following it."""
import importlib.util
import os
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = {
    "fetch_results": "templates/site-compliance-review/lib/fetch_results.py",
    "fetch_shots": "templates/site-compliance-review/lib/fetch_shots.py",
    "worker_shots": "templates/shopify-content-qa/lib/worker_shots.py",
}


class _Handler(BaseHTTPRequestHandler):
    hits = []

    def do_GET(self):
        _Handler.hits.append(self.path)
        if self.path.startswith("/start"):
            self.send_response(302)
            self.send_header("Location", "/elsewhere")
            self.end_headers()
        else:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")

    do_POST = do_GET

    def log_message(self, *a):
        pass


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, SCRIPTS[name]))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class RedirectTests(unittest.TestCase):
    def setUp(self):
        _Handler.hits = []
        self.server = HTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_each_fetcher_stops_at_a_redirect(self):
        for name in SCRIPTS:
            mod = load(name)
            with self.subTest(name), self.assertRaises(urllib.error.HTTPError) as cm:
                mod._open(self.base + "/start")
            self.assertEqual(cm.exception.code, 302)
        self.assertNotIn("/elsewhere", _Handler.hits)

    def test_a_plain_answer_still_reads(self):
        mod = load("fetch_results")
        with mod._open(self.base + "/ok") as resp:
            self.assertEqual(resp.read(), b"{}")


if __name__ == "__main__":
    unittest.main()
