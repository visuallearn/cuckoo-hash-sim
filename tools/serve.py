#!/usr/bin/env python3
"""Serve docs/ for local development, with caching turned off.

python3 -m http.server sends Last-Modified but no Cache-Control and no ETag. A
browser is then free to reuse a heuristically-fresh copy without asking, so an
edited stylesheet can stay stale for a long time and the page renders with old
CSS and new JS. That looks like a broken site. This server says no-store.

Threaded, and HTTP/1.1 so connections stay open. The site has no bundler, so one
page pulls about twenty separate files. A single-threaded HTTP/1.0 server handles
one connection at a time and closes after every response, and a browser opens
several connections at once and holds some of them open without sending
anything. The server then blocks on a silent socket, the five-deep accept queue
fills, the kernel drops new connections, and the page appears to hang. Threads
plus keep-alive remove both halves of that.

Usage: python3 tools/serve.py [port]
"""
from __future__ import annotations

import functools
import http.server
import socketserver
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    # Keep-alive, so twenty files need one connection and not twenty.
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    # A browser opens more sockets than it immediately uses, so leave room.
    request_queue_size = 64


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
    handler = functools.partial(NoCacheHandler, directory=str(DOCS))
    with Server(("", port), handler) as httpd:
        print(f"serving {DOCS} on http://localhost:{port}/  (no-store)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
