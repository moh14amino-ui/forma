#!/usr/bin/env python3
"""Local backend for Forma store — for testing only.
Serves static files + a tiny orders API (stored in orders.json).
For production, switch to Google Sheets (see js/backend.js).
"""
import http.server, json, os, urllib.parse
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
ORDERS_FILE = os.path.join(ROOT, "orders.json")

def read_orders():
    try:
        with open(ORDERS_FILE) as f:
            return json.load(f)
    except Exception:
        return []

def write_orders(orders):
    with open(ORDERS_FILE, "w") as f:
        json.dump(orders, f, ensure_ascii=False, indent=2)

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/orders":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            try:
                upd = json.loads(raw.decode())
            except Exception:
                upd = {}
            orders = read_orders()
            oid = upd.get("id")
            changed = False
            for o in orders:
                if o.get("id") == oid or o.get("createdAt") == oid:
                    if "status" in upd:
                        o["status"] = upd["status"]
                    if "stockDeducted" in upd:
                        o["stockDeducted"] = upd["stockDeducted"]
                    changed = True
                    break
            if changed:
                write_orders(orders)
                body = json.dumps({"ok": True}).encode()
                self.send_response(200)
            else:
                body = json.dumps({"ok": False, "error": "not found"}).encode()
                self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/products":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            try:
                data = json.loads(raw.decode())
                if not isinstance(data, list):
                    raise ValueError("expected array")
            except Exception as e:
                body = json.dumps({"ok": False, "error": str(e)}).encode()
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self._cors()
                self.end_headers()
                self.wfile.write(body)
                return
            with open(os.path.join(ROOT, "products.json"), "w") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            body = json.dumps({"ok": True}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/orders":
            data = read_orders()
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/products":
            try:
                with open(os.path.join(ROOT, "products.json")) as f:
                    body = f.read().encode()
            except Exception:
                body = b"[]"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/orders":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            try:
                order = json.loads(raw.decode())
            except Exception:
                order = {}
            orders = read_orders()
            order.setdefault("createdAt", __import__("datetime").datetime.utcnow().isoformat() + "Z")
            orders.insert(0, order)
            write_orders(orders)
            body = json.dumps({"ok": True, "via": "local-server"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

if __name__ == "__main__":
    import socket
    port = 8765
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Forma server running on http://0.0.0.0:{port}")
    print(f"LAN: http://<your-ip>:{port}/index.html")
    print(f"Orders stored in: {ORDERS_FILE}")
    httpd.serve_forever()