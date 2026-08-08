#!/usr/bin/env python3
"""
Servidor de desarrollo del modo pruebas — como `python -m http.server`, pero con
dos cosas que ese no tiene:

1. `Cache-Control: no-store` en cada respuesta, para que el navegador nunca se
   quede con una copia vieja de un .js mientras se itera rápido.
2. Un endpoint de escritura (`POST /api/fixture`) que vuelca lo que mande
   `test/file-store.js` directo a `test/fixtures/firestore.json` — así ese
   archivo es la fuente de verdad de TODO lo que pase en modo pruebas (no
   solo de lo que baja "Sincronizar"), y sobrevive a cerrar la pestaña, a
   entrar en incógnito, o a cambiar de dispositivo en la misma red.

Solo para desarrollo local — no afecta al sitio real en GitHub Pages, que no usa
este script para nada.

Uso: python test/serve.py [puerto]   (default 8080)
"""
import http.server
import json
import socketserver
import sys
from pathlib import Path

PUERTO   = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
RAIZ     = Path(__file__).resolve().parent.parent
FIXTURE  = RAIZ / 'test' / 'fixtures' / 'firestore.json'


class SinCache(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RAIZ), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def do_POST(self):
        if self.path != '/api/fixture':
            self.send_error(404)
            return

        largo = int(self.headers.get('Content-Length', 0))
        crudo = self.rfile.read(largo)
        try:
            data = json.loads(crudo)
            if not isinstance(data, dict):
                raise ValueError('se esperaba un objeto {coleccion: [...]}')
        except ValueError as e:
            self.send_error(400, f'JSON inválido: {e}')
            return

        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('0.0.0.0', PUERTO), SinCache) as httpd:
        print(f"Sirviendo {RAIZ} en http://0.0.0.0:{PUERTO} (sin caché, con /api/fixture)")
        httpd.serve_forever()
