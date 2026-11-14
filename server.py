#!/usr/bin/env python3
"""Local static preview server only. Run with: python server.py

The production storefront uses GitHub Pages and the configured order service.
This local preview deliberately has no orders API and binds to loopback only.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent

if __name__ == "__main__":
    port = 8765
    server = ThreadingHTTPServer(("127.0.0.1", port),
                                 lambda *args, **kwargs: SimpleHTTPRequestHandler(*args, directory=str(ROOT), **kwargs))
    print(f"Forma static preview: http://127.0.0.1:{port}/index.html")
    print("No local order or admin API is enabled.")
    server.serve_forever()
