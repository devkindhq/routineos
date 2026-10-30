"""Reading a pack from disk or one https URL: scheme, size and redirect refusals."""
import http.server
import io
import os
import socket
import ssl
import tempfile
import threading
import unittest
import urllib.error
from unittest import mock

import pack_fixtures  # noqa: F401  (puts the scripts on sys.path)

import pack


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


class FakeOpener:
    def __init__(self, body=b"{}"):
        self.body, self.calls = body, []

    def open(self, req, timeout=None):
        self.calls.append((req.full_url, dict(req.header_items()), timeout))
        return FakeResponse(self.body)


class SchemeTests(unittest.TestCase):
    def test_non_https_urls_are_refused_before_any_call(self):
        for url in ("http://example.org/p.json", "file:///etc/hosts", "ftp://example.org/p.json",
                    "HTTP://example.org/p.json", "javascript:alert(1)", "data:application/json,{}"):
            opener = FakeOpener()
            with self.assertRaises(pack.PackError, msg=url) as cm:
                pack.read_source(url, 100, opener=opener)
            self.assertTrue(cm.exception.io)
            self.assertEqual(opener.calls, [], url)

    def test_https_uses_fixed_agent_timeout_and_no_auth(self):
        opener = FakeOpener(b'{"a": 1}')
        self.assertEqual(pack.read_source("https://example.org/p.json", 100, opener=opener), b'{"a": 1}')
        url, headers, timeout = opener.calls[0]
        self.assertEqual(url, "https://example.org/p.json")
        self.assertEqual(headers.get("User-agent"), "routineos-pack/0.8.1")
        self.assertEqual(timeout, 20)
        self.assertFalse(any(h.lower() in ("authorization", "cookie") for h in headers))

    def test_body_over_the_cap_is_refused(self):
        opener = FakeOpener(b"x" * 101)
        with self.assertRaises(pack.PackError) as cm:
            pack.read_source("https://example.org/p.json", 100, opener=opener)
        self.assertIn("over", str(cm.exception))

    def test_url_credentials_and_query_are_not_echoed(self):
        class Failing(FakeOpener):
            def open(self, req, timeout=None):
                raise urllib.error.URLError("unreachable")
        with self.assertRaises(pack.PackError) as cm:
            pack.read_source("https://user:pw" + "@" + "example.org/p.json?sig=abc123", 100, opener=Failing())
        self.assertNotIn("abc123", str(cm.exception))
        self.assertNotIn("pw@", str(cm.exception))


class DiskTests(unittest.TestCase):
    def test_disk_path_over_the_cap_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "big.json")
            with open(path, "wb") as fh:
                fh.write(b"x" * 101)
            with self.assertRaises(pack.PackError) as cm:
                pack.read_source(path, 100)
            self.assertIn("over", str(cm.exception))
            with open(path, "wb") as fh:
                fh.write(b"x" * 100)
            self.assertEqual(len(pack.read_source(path, 100)), 100)

    def test_missing_path_is_refused(self):
        with self.assertRaises(pack.PackError) as cm:
            pack.read_source("/nonexistent/pack.json", 100)
        self.assertTrue(cm.exception.io)


class RedirectHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/moved":
            self.send_response(302)
            self.send_header("Location", "/target")
            self.end_headers()
        else:
            body = b'{"reached": true}'
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, *a):
        pass


class RedirectTests(unittest.TestCase):
    def setUp(self):
        self.server = http.server.HTTPServer(("127.0.0.1", 0), RedirectHandler)
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_redirect_is_refused_not_followed(self):
        opener = pack.no_redirect_opener(proxies={})
        with opener.open(self.base + "/target", timeout=5) as resp:
            self.assertEqual(resp.read(), b'{"reached": true}')
        with self.assertRaises(urllib.error.HTTPError) as cm:
            opener.open(self.base + "/moved", timeout=5)
        self.assertEqual(cm.exception.code, 302)


def answers(*ips):
    """A getaddrinfo stand-in that resolves every name to ips, so no test touches the network."""
    def fake(host, port, *a, **k):
        return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))
                for ip in ips]
    return fake


class AddressTests(unittest.TestCase):
    BLOCKED = ("127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
               "240.0.0.1", "224.0.0.1", "255.255.255.255", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::")

    def test_loopback_private_link_local_and_reserved_are_refused(self):
        for ip in self.BLOCKED:
            with mock.patch("socket.getaddrinfo", answers(ip)), self.assertRaises(OSError, msg=ip):
                pack.public_addresses("pack.example", 443)
        with mock.patch("socket.getaddrinfo", answers("93.184.215.14", "2606:4700::1111")):
            self.assertEqual([a[:2] for a in pack.public_addresses("pack.example", 443)],
                             [("93.184.215.14", 443), ("2606:4700::1111", 443)])

    def test_ipv6_forms_that_carry_an_ipv4_address_are_refused(self):
        # NAT64, local NAT64, 6to4, Teredo and IPv4-compatible: each can reach an IPv4 host, so none is allowed.
        for ip in ("64:ff9b::808:808", "64:ff9b::a00:5", "64:ff9b:1::1", "2002:808:808::1", "2002:a00:5::1",
                   "2001:0:4136:e378:8000:63bf:3fff:fdd2", "::8.8.8.8", "::127.0.0.1"):
            with mock.patch("socket.getaddrinfo", answers(ip)), self.assertRaises(OSError, msg=ip):
                pack.public_addresses("pack.example", 443)

    def test_one_non_public_answer_refuses_the_host(self):
        with mock.patch("socket.getaddrinfo", answers("93.184.215.14", "10.0.0.5")), self.assertRaises(OSError):
            pack.public_addresses("pack.example", 443)

    def fetch(self, url, proxies=None):
        connects = []
        with mock.patch("socket.create_connection", lambda addr, *a, **k: connects.append(addr) or _refuse()):
            with self.assertRaises(pack.PackError) as cm:
                pack.read_source(url, 100, opener=pack.no_redirect_opener(proxies=proxies or {}))
        self.assertTrue(cm.exception.io)
        return str(cm.exception), connects

    def test_fetch_to_a_private_address_is_refused_before_connecting(self):
        with mock.patch("socket.getaddrinfo", answers("10.0.0.5")):
            msg, connects = self.fetch("https://internal.example/p.json")
        self.assertIn("not a public address", msg)
        self.assertEqual(connects, [])
        msg, connects = self.fetch("https://127.0.0.1:1/p.json")
        self.assertIn("not a public address", msg)
        self.assertEqual(connects, [])

    def test_fetch_connects_to_the_vetted_address_not_a_fresh_lookup(self):
        # Connecting by IP means a second DNS answer (a rebind) is never used.
        with mock.patch("socket.getaddrinfo", answers("93.184.215.14")):
            msg, connects = self.fetch("https://pack.example/p.json")
        self.assertEqual(connects, [("93.184.215.14", 443)])

    def test_a_proxied_fetch_still_vets_the_target(self):
        with mock.patch("socket.getaddrinfo", answers("10.0.0.5")):
            msg, connects = self.fetch("https://internal.example/p.json", proxies={"https": "http://10.0.0.1:3128"})
        self.assertIn("not a public address", msg)
        self.assertEqual(connects, [])

    def test_a_proxied_fetch_sends_connect_to_the_vetted_ip_and_keeps_the_name_for_tls(self):
        # The proxy never resolves the name itself, so it cannot be handed a rebound answer.
        proxy = FakeProxySocket()
        tls = []

        def wrap(ctx, sock, server_hostname=None, **k):
            tls.append(server_hostname)
            raise ConnectionRefusedError("test: no TLS")
        with mock.patch("socket.getaddrinfo", answers("93.184.215.14")), \
                mock.patch("socket.create_connection", lambda addr, *a, **k: proxy.at(addr)), \
                mock.patch.object(ssl.SSLContext, "wrap_socket", wrap), self.assertRaises(pack.PackError):
            pack.read_source("https://pack.example/p.json", 100,
                             opener=pack.no_redirect_opener(proxies={"https": "http://proxy.example:3128"}))
        self.assertEqual(proxy.addr, ("proxy.example", 3128))
        head = proxy.sent.split(b"\r\n")
        self.assertEqual(head[0], b"CONNECT 93.184.215.14:443 HTTP/1.1")
        self.assertIn(b"Host: 93.184.215.14:443", head)
        self.assertNotIn(b"pack.example", proxy.sent)
        self.assertEqual(tls, ["pack.example"])

    def test_every_https_connection_goes_through_the_vetting_handler(self):
        # Redirects are refused, so a fetch makes one connection; any connection the opener makes is vetted.
        opener = pack.no_redirect_opener(proxies={})
        https = [h for h in opener.handlers if hasattr(h, "https_open")]
        self.assertEqual([type(h) for h in https], [pack.PublicHTTPSHandler])


def _refuse():
    raise ConnectionRefusedError("test: no network")


class FakeProxySocket:
    """Records what a proxy is sent and answers CONNECT with 200."""
    def __init__(self):
        self.addr, self.sent = None, b""

    def at(self, addr):
        self.addr = addr
        return self

    def sendall(self, data):
        self.sent += data

    def makefile(self, mode):
        return io.BytesIO(b"HTTP/1.1 200 Connection established\r\n\r\n")

    def setsockopt(self, *a):
        pass

    def close(self):
        pass


class LoadTests(unittest.TestCase):
    def test_load_parses_with_the_pack_cap(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "p.json")
            with open(path, "wb") as fh:
                fh.write(b'{"a": 1}')
            self.assertEqual(pack.load(path), {"a": 1})


if __name__ == "__main__":
    unittest.main()
