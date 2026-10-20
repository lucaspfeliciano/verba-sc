"""Leitura de membros de um .zip remoto via HTTP Range, sem baixar o arquivo inteiro."""

from __future__ import annotations

import io
import urllib.request

UA = {"User-Agent": "verba-sc/0.1 (+https://github.com/)"}


class HttpRangeFile(io.RawIOBase):
    """Arquivo somente leitura e com seek, apoiado em requisições HTTP Range."""

    def __init__(self, url: str, block: int = 1 << 20):
        self.url = url
        self.pos = 0
        self.block = block
        self._cache: dict[int, bytes] = {}
        req = urllib.request.Request(url, method="HEAD", headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            self.size = int(r.headers["Content-Length"])
            self.etag = r.headers.get("ETag")
            self.last_modified = r.headers.get("Last-Modified")
        self.bytes_fetched = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = 0) -> int:
        if whence == 0:
            self.pos = offset
        elif whence == 1:
            self.pos += offset
        else:
            self.pos = self.size + offset
        return self.pos

    def _get_block(self, idx: int) -> bytes:
        if idx not in self._cache:
            start = idx * self.block
            end = min(start + self.block, self.size) - 1
            req = urllib.request.Request(self.url, headers={**UA, "Range": f"bytes={start}-{end}"})
            for attempt in range(5):
                try:
                    with urllib.request.urlopen(req, timeout=120) as r:
                        data = r.read()
                    break
                except Exception:
                    if attempt == 4:
                        raise
            self.bytes_fetched += len(data)
            if len(self._cache) > 64:
                self._cache.pop(next(iter(self._cache)))
            self._cache[idx] = data
        return self._cache[idx]

    def read(self, n: int = -1) -> bytes:
        if self.pos >= self.size:
            return b""
        if n < 0 or self.pos + n > self.size:
            n = self.size - self.pos
        out = bytearray()
        while n > 0:
            idx, off = divmod(self.pos, self.block)
            chunk = self._get_block(idx)[off : off + n]
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def readinto(self, b) -> int:
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)
