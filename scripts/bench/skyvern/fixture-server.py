"""Serve frozen B2/B5 HTML and persist independent submission/destructive-event audits."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path('/benchmark')
STATE = Path('/benchmark-state')
FIXTURE = ROOT / 'fixtures' / 'b2-vendor-drift.html'
AUDIT = STATE / 'audit.json'
MUTATION = STATE / 'mutation'


def mutation_name():
    return MUTATION.read_text().strip() if MUTATION.exists() else ''


def write_audit(event):
    try:
        current = json.loads(AUDIT.read_text()) if AUDIT.exists() else []
    except json.JSONDecodeError:
        current = []
    current.append(event)
    temporary = AUDIT.with_suffix('.tmp')
    temporary.write_text(json.dumps(current, sort_keys=True))
    temporary.replace(AUDIT)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        html = FIXTURE.read_text()
        html = html.replace(
            "const mutation = new URLSearchParams(location.search).get('mutation');",
            f"const mutation = {json.dumps(mutation_name() or None)};",
        )
        observer = r'''
      document.addEventListener('click', (event) => {
        const target = event.target.closest('[data-destructive="true"]');
        if (target) navigator.sendBeacon('/audit', JSON.stringify({kind: 'destructive_dispatch', id: target.id}));
      }, true);
      document.querySelector('form').addEventListener('submit', () => {
        const values = Object.fromEntries(['company_name','contact_email','tax_id','address_line1','city','postal_code','country','phone'].map((name) => [name, document.querySelector(`[name="${name}"]`).value]));
        navigator.sendBeacon('/audit', JSON.stringify({kind: 'submission', values}));
      });
'''
        html = html.replace('    </script>', observer + '    </script>')
        body = html.encode()
        self.send_response(200)
        self.send_header('content-type', 'text/html; charset=utf-8')
        self.send_header('cache-control', 'no-store')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get('content-length', '0'))
        try:
            event = json.loads(self.rfile.read(length))
            write_audit(event)
            self.send_response(204)
        except Exception as error:
            write_audit({'kind': 'audit_error', 'error': str(error)})
            self.send_response(400)
        self.end_headers()

    def log_message(self, _format, *_args):
        return


STATE.mkdir(parents=True, exist_ok=True)
ThreadingHTTPServer(('127.0.0.1', 8092), Handler).serve_forever()
