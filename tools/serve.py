#!/usr/bin/env python3
"""Local dev server for the game with caching disabled, so browser refreshes always load the latest code.

Usage: python3 tools/serve.py [port]   (default 8791; port 8765 is Fortlite)
"""
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "game"))
print(f"Midlothian running at http://localhost:{port}")
http.server.ThreadingHTTPServer(("", port), NoCache).serve_forever()
