#!/usr/bin/env python3
"""Servidor local para probar el juego en la red de casa (sin caché, con rangos HTTP para el audio en iPhone).

    python3 tools/serve.py [puerto]      # por defecto 8080, escucha en todas las interfaces
"""
import http.server, os, re, socket, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def send_head(self):
        rng = self.headers.get('Range')
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r'bytes=(\d*)-(\d*)', rng)
        size = os.path.getsize(path)
        start = int(m.group(1)) if m and m.group(1) else 0
        end = int(m.group(2)) if m and m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_error(416)
            return None
        f = open(path, 'rb')
        f.seek(start)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        self._range_left = end - start + 1
        return f

    def copyfile(self, src, dst):
        left = getattr(self, '_range_left', None)
        if left is None:
            return super().copyfile(src, dst)
        while left > 0:
            chunk = src.read(min(65536, left))
            if not chunk:
                break
            dst.write(chunk)
            left -= len(chunk)


Handler.extensions_map.update({'.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
                               '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'})

if __name__ == '__main__':
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('8.8.8.8', 80)); ip = s.getsockname()[0]; s.close()
    except OSError:
        ip = 'localhost'
    print(f'Super Off Road en  http://localhost:{PORT}/   ·   desde el móvil: http://{ip}:{PORT}/')
    http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
