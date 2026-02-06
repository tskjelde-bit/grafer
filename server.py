#!/usr/bin/env python3
"""
Simple HTTP server with file save capability for the admin panel.
Run with: python3 server.py
Then open: http://localhost:8080/admin.html
"""

import http.server
import json
import os
import subprocess
from urllib.parse import urlparse

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class AdminHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_POST(self):
        if self.path == '/save-csv':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)

            try:
                data = json.loads(post_data.decode('utf-8'))
                csv_content = data.get('csv', '')
                folder = data.get('folder', '')  # subfolder like 'prisutvikling'

                filename = data.get('filename', 'data.csv')

                # Determine target directory
                if folder:
                    target_dir = os.path.join(DIRECTORY, folder)
                else:
                    target_dir = DIRECTORY

                # Backup existing file
                data_file = os.path.join(target_dir, filename)
                if os.path.exists(data_file):
                    name, ext = os.path.splitext(filename)
                    backup_file = os.path.join(target_dir, f'{name}_backup{ext}')
                    with open(data_file, 'r', encoding='utf-8') as f:
                        with open(backup_file, 'w', encoding='utf-8') as bf:
                            bf.write(f.read())

                # Save new file
                with open(data_file, 'w', encoding='utf-8') as f:
                    f.write(csv_content)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True, 'message': 'Fil lagret!'}).encode())

                print(f"[OK] data.csv lagret ({len(csv_content)} bytes)")

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'message': str(e)}).encode())
                print(f"[FEIL] {e}")

        elif self.path == '/git-push':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)

            try:
                data = json.loads(post_data.decode('utf-8'))
                commit_message = data.get('message', 'Oppdatert data.csv')
                folder = data.get('folder', '')  # subfolder like 'prisutvikling'

                filename = data.get('filename', 'data.csv')

                # Determine file path for git add
                if folder:
                    data_file_path = os.path.join(folder, filename)
                else:
                    data_file_path = filename

                # Run git commands
                os.chdir(DIRECTORY)

                # Git add
                result_add = subprocess.run(['git', 'add', data_file_path],
                                           capture_output=True, text=True, cwd=DIRECTORY)

                # Git commit
                result_commit = subprocess.run(['git', 'commit', '-m', commit_message],
                                              capture_output=True, text=True, cwd=DIRECTORY)

                # Git push
                result_push = subprocess.run(['git', 'push'],
                                            capture_output=True, text=True, cwd=DIRECTORY)

                if result_push.returncode == 0:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'success': True,
                        'message': 'Pushet til GitHub!'
                    }).encode())
                    print(f"[OK] Pushet til GitHub: {commit_message}")
                else:
                    error_msg = result_push.stderr or result_commit.stderr or 'Ukjent feil'
                    # Check if nothing to commit
                    if 'nothing to commit' in result_commit.stdout or 'nothing to commit' in result_commit.stderr:
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(json.dumps({
                            'success': True,
                            'message': 'Ingen endringer å pushe'
                        }).encode())
                    else:
                        self.send_response(500)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(json.dumps({
                            'success': False,
                            'message': error_msg.strip()
                        }).encode())
                        print(f"[FEIL] Git push: {error_msg}")

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'message': str(e)}).encode())
                print(f"[FEIL] {e}")

        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    with http.server.HTTPServer(('', PORT), AdminHandler) as httpd:
        print(f"Server kjører på http://localhost:{PORT}")
        print(f"Åpne http://localhost:{PORT}/admin.html")
        print("Trykk Ctrl+C for å stoppe")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stoppet")
