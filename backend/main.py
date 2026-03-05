import os
import secrets
import string
import hashlib
import sqlite3
from datetime import datetime, timedelta, timezone
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = '/tmp/file-drop-uploads'
DB_FILE = '/tmp/file-drop.db'
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS files (
            slug TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            size INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            pin_hash TEXT,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()


def generate_slug():
    chars = string.ascii_lowercase + string.digits
    return ''.join(secrets.choice(chars) for _ in range(10))


def parse_expiry(expiry):
    now = datetime.now(timezone.utc)
    if expiry == '10s':
        return now + timedelta(seconds=10)
    elif expiry == '10m':
        return now + timedelta(minutes=10)
    elif expiry == '24h':
        return now + timedelta(hours=24)
    else:  # '1h' or default
        return now + timedelta(hours=1)


@app.route('/api/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'No file selected'}), 400

    content = file.read()
    if len(content) > MAX_FILE_SIZE:
        return jsonify({'error': 'File exceeds 10 MB limit'}), 400

    pin = request.form.get('pin', '').strip()
    expiry = request.form.get('expiry', '1h')

    slug = generate_slug()
    file_path = os.path.join(UPLOAD_FOLDER, slug)
    with open(file_path, 'wb') as f:
        f.write(content)

    pin_hash = hashlib.sha256(pin.encode()).hexdigest() if pin else None
    expires_at = parse_expiry(expiry)
    now = datetime.now(timezone.utc)

    conn = get_db()
    conn.execute(
        'INSERT INTO files (slug, filename, size, file_path, pin_hash, expires_at, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        (slug, file.filename, len(content), file_path, pin_hash,
         expires_at.isoformat(), now.isoformat())
    )
    conn.commit()
    conn.close()

    return jsonify({'slug': slug})


@app.route('/api/files/<slug>', methods=['GET'])
def get_file_info(slug):
    conn = get_db()
    row = conn.execute('SELECT * FROM files WHERE slug = ?', (slug,)).fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'not_found'}), 404

    expires_at = datetime.fromisoformat(row['expires_at'])
    if datetime.now(timezone.utc) > expires_at:
        return jsonify({'error': 'expired'}), 410

    return jsonify({
        'slug': row['slug'],
        'filename': row['filename'],
        'size': row['size'],
        'expires_at': row['expires_at'],
        'has_pin': row['pin_hash'] is not None,
    })


@app.route('/api/files/<slug>/verify', methods=['POST'])
def verify_pin(slug):
    data = request.get_json()
    pin = data.get('pin', '').strip() if data else ''

    conn = get_db()
    row = conn.execute('SELECT pin_hash FROM files WHERE slug = ?', (slug,)).fetchone()
    conn.close()

    if not row:
        return jsonify({'valid': False}), 404

    if not row['pin_hash']:
        return jsonify({'valid': True})

    expected = hashlib.sha256(pin.encode()).hexdigest()
    return jsonify({'valid': expected == row['pin_hash']})


@app.route('/api/files/<slug>/download', methods=['GET'])
def download_file(slug):
    pin = request.args.get('pin', '').strip()

    conn = get_db()
    row = conn.execute('SELECT * FROM files WHERE slug = ?', (slug,)).fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'not_found'}), 404

    expires_at = datetime.fromisoformat(row['expires_at'])
    if datetime.now(timezone.utc) > expires_at:
        return jsonify({'error': 'expired'}), 410

    if row['pin_hash']:
        expected = hashlib.sha256(pin.encode()).hexdigest()
        if expected != row['pin_hash']:
            return jsonify({'error': 'invalid_pin'}), 401

    return send_file(row['file_path'], download_name=row['filename'], as_attachment=True)


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=3001, debug=False)
