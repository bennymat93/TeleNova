# -*- coding: utf-8 -*-
"""Tiny thread-safe SQLite key/value cache with TTL (shared by plugin & service)."""
import json
import sqlite3
import threading
import time


class Cache(object):
    def __init__(self, path):
        self.path = path
        self._lock = threading.Lock()
        self._init()

    def _conn(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.execute('PRAGMA journal_mode=WAL')
        return conn

    def _init(self):
        with self._lock:
            conn = self._conn()
            try:
                conn.execute('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp REAL)')
                conn.commit()
            finally:
                conn.close()

    def get(self, key, default=None):
        with self._lock:
            conn = self._conn()
            try:
                row = conn.execute('SELECT v, exp FROM kv WHERE k=?', (key,)).fetchone()
            finally:
                conn.close()
        if not row:
            return default
        if row[1] and row[1] < time.time():
            self.delete(key)
            return default
        try:
            return json.loads(row[0])
        except ValueError:
            return default

    def set(self, key, value, ttl=None):
        exp = time.time() + ttl if ttl else 0
        data = json.dumps(value, ensure_ascii=False)
        with self._lock:
            conn = self._conn()
            try:
                conn.execute('REPLACE INTO kv (k, v, exp) VALUES (?, ?, ?)', (key, data, exp))
                conn.commit()
            finally:
                conn.close()

    def delete(self, key):
        with self._lock:
            conn = self._conn()
            try:
                conn.execute('DELETE FROM kv WHERE k=?', (key,))
                conn.commit()
            finally:
                conn.close()

    def purge_expired(self):
        """3.3: expired rows were only removed when read again; called once a day by the service (no VACUUM)."""
        with self._lock:
            conn = self._conn()
            try:
                cur = conn.execute('DELETE FROM kv WHERE exp>0 AND exp<?', (time.time(),))
                conn.commit()
                return cur.rowcount
            finally:
                conn.close()

    def purge(self, prefix=None):
        with self._lock:
            conn = self._conn()
            try:
                if prefix:
                    conn.execute('DELETE FROM kv WHERE k LIKE ?', (prefix + '%',))
                else:
                    conn.execute('DELETE FROM kv')
                conn.execute('DELETE FROM kv WHERE exp>0 AND exp<?', (time.time(),))
                conn.commit()
                conn.execute('VACUUM')
            finally:
                conn.close()
