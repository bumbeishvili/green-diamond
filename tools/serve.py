#!/usr/bin/env python3
"""Serve the game locally with caching disabled (so a refresh always loads the latest code).
Usage: python3 tools/serve.py [port]   ->  http://127.0.0.1:8765
"""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer.allow_reuse_address = True
handler = functools.partial(NoCache, directory=str(ROOT))
with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler) as srv:
    print(f'Green Diamond: Dighomi Outbreak -> http://127.0.0.1:{PORT}')
    srv.serve_forever()
