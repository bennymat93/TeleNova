# -*- coding: utf-8 -*-
"""Fast AES-256-IGE for MTProto.

Telethon falls back to pure-python *pyaes* when neither ``cryptg`` nor a discoverable
``libssl`` exists - that caps streaming at well under 1 MB/s on a TV box.  We try harder:
1. OpenSSL's ``AES_ige_encrypt`` from libcrypto (found via several names, or through the
   already-loaded ``_ssl`` extension's dependency tree, which works on Kodi Linux/Android),
2. PyCryptodome (``script.module.pycryptodome``) ECB + IGE chaining,
3. leave Telethon's own choice.
"""
import ctypes
import ctypes.util
import os
import sys

_impl_name = 'none'


# ------------------------------------------------------------------ OpenSSL
class _AESKey(ctypes.Structure):
    _fields_ = [('rd_key', ctypes.c_uint32 * 60), ('rounds', ctypes.c_uint)]


def _load_libcrypto():
    names = []
    found = ctypes.util.find_library('crypto')
    if found:
        names.append(found)
    names += ['libcrypto.so.3', 'libcrypto.so.1.1', 'libcrypto.so', 'libcrypto.dylib',
              'libcrypto-3-x64', 'libcrypto-3', 'libcrypto-1_1-x64', 'libcrypto-1_1', 'libeay32']
    try:  # the _ssl extension module pulls libcrypto into the process
        import _ssl
        path = getattr(_ssl, '__file__', None)
        if path:
            names.insert(0, path)
            base = os.path.dirname(path)
            for f in os.listdir(base):
                if f.lower().startswith('libcrypto'):
                    names.insert(0, os.path.join(base, f))
    except Exception:
        pass
    if sys.platform != 'win32':
        names.append(None)  # symbols of the running process
    # 3.2 (Android TV boxes): Kodi carries its own OpenSSL inside libkodi.so and nothing above finds it there;
    # every library the process already has loaded is asked for the function (a library without it is skipped)
    names.append('libkodi.so')
    try:
        seen = set()
        with open('/proc/self/maps') as fh:
            for line in fh:
                path = line.rsplit(' ', 1)[-1].strip()
                low = path.rsplit('/', 1)[-1].lower()
                if path.startswith('/') and path not in seen and '.so' in low and \
                        ('kodi' in low or 'crypto' in low or 'ssl' in low or 'python' in low):
                    seen.add(path)
                    names.append(path)
    except Exception:
        pass
    for name in names:
        try:
            lib = ctypes.CDLL(name)
            fn = lib.AES_ige_encrypt
            lib.AES_set_encrypt_key.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.POINTER(_AESKey)]
            lib.AES_set_decrypt_key.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.POINTER(_AESKey)]
            fn.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_size_t, ctypes.POINTER(_AESKey),
                           ctypes.c_char_p, ctypes.c_int]
            fn.restype = None
            return lib
        except (OSError, AttributeError, TypeError):
            continue
    return None


_lib = None


def _ossl(data, key, iv, enc):
    k = _AESKey()
    if enc:
        _lib.AES_set_encrypt_key(key, len(key) * 8, ctypes.byref(k))
    else:
        _lib.AES_set_decrypt_key(key, len(key) * 8, ctypes.byref(k))
    out = ctypes.create_string_buffer(len(data))
    ivbuf = ctypes.create_string_buffer(bytes(iv), len(iv))
    _lib.AES_ige_encrypt(bytes(data), out, len(data), ctypes.byref(k), ivbuf, 1 if enc else 0)
    return out.raw


def ossl_encrypt_ige(plain, key, iv):
    plain = bytes(plain)
    if len(plain) % 16:       # 3.3: AES_ige_encrypt needs whole blocks; padded with random bytes like the other back-ends
        plain += os.urandom(16 - len(plain) % 16)
    return _ossl(plain, key, iv, True)


def ossl_decrypt_ige(cipher, key, iv):
    return _ossl(cipher, key, iv, False)


# ------------------------------------------------------------------ bundled library (Windows)
# 3.3: Kodi for Windows links OpenSSL statically into its Python - nothing above can be loaded there, and the
# PyCryptodome fallback works block by block in Python (about 0.2 MB/s: no stream can play). The add-on carries
# its own small AES-IGE library (resources/bin/win-*/tnige.dll, source: native/tnige.c; AES-NI when the CPU has it).
_tn = None


def _load_tnige():
    if sys.platform != 'win32':
        return None
    try:
        arch = 'win-x64' if ctypes.sizeof(ctypes.c_void_p) == 8 else 'win-x86'
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'bin', arch, 'tnige.dll')
        if not os.path.isfile(path):
            return None
        lib = ctypes.CDLL(path)
        lib.tn_ige.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p, ctypes.c_char_p,
                               ctypes.c_int]
        lib.tn_ige.restype = None
        lib.tn_ige_info.restype = ctypes.c_int
        return lib
    except (OSError, AttributeError, TypeError):
        return None


def _tn_run(data, key, iv, flags):
    data = bytes(data)
    out = ctypes.create_string_buffer(len(data))
    _tn.tn_ige(data, out, len(data), bytes(key), bytes(iv), flags)
    return out.raw


def tn_encrypt_ige(plain, key, iv):
    plain = bytes(plain)
    if len(plain) % 16:
        plain += os.urandom(16 - len(plain) % 16)
    return _tn_run(plain, key, iv, 1)


def tn_decrypt_ige(cipher, key, iv):
    return _tn_run(cipher, key, iv, 0)


# ------------------------------------------------------------------ PyCryptodome / generic ECB
def _xor16(a, b):
    return (int.from_bytes(a, 'little') ^ int.from_bytes(b, 'little')).to_bytes(16, 'little')


def make_ecb_ige(ecb_factory):
    """Build IGE functions on top of an ECB block cipher factory: f(key) -> obj with encrypt/decrypt."""

    def encrypt_ige(plain, key, iv):
        plain = bytes(plain)
        if len(plain) % 16:
            plain += os.urandom(16 - len(plain) % 16)
        ecb = ecb_factory(key)
        enc = ecb.encrypt
        prev_c, prev_p = iv[:16], iv[16:32]
        out = []
        for i in range(0, len(plain), 16):
            p = plain[i:i + 16]
            c = _xor16(enc(_xor16(p, prev_c)), prev_p)
            out.append(c)
            prev_c, prev_p = c, p
        return b''.join(out)

    def decrypt_ige(cipher, key, iv):
        cipher = bytes(cipher)
        ecb = ecb_factory(key)
        dec = ecb.decrypt
        prev_c, prev_p = iv[:16], iv[16:32]
        out = []
        for i in range(0, len(cipher), 16):
            c = cipher[i:i + 16]
            p = _xor16(dec(_xor16(c, prev_p)), prev_c)
            out.append(p)
            prev_c, prev_p = c, p
        return b''.join(out)

    return encrypt_ige, decrypt_ige


def make_strxor_ige(new_ecb, strxor):
    """IGE on PyCryptodome with its C ``strxor``: about twice as fast as the int-based fallback."""

    def encrypt_ige(plain, key, iv):
        plain = bytes(plain)
        if len(plain) % 16:
            plain += os.urandom(16 - len(plain) % 16)
        enc = new_ecb(bytes(key)).encrypt
        prev_c, prev_p = bytes(iv[:16]), bytes(iv[16:32])
        out = bytearray(len(plain))
        for i in range(0, len(plain), 16):
            p = plain[i:i + 16]
            c = strxor(enc(strxor(p, prev_c)), prev_p)
            out[i:i + 16] = c
            prev_c, prev_p = c, p
        return bytes(out)

    def decrypt_ige(cipher, key, iv):
        cipher = bytes(cipher)
        dec = new_ecb(bytes(key)).decrypt
        prev_c, prev_p = bytes(iv[:16]), bytes(iv[16:32])
        out = bytearray(len(cipher))
        for i in range(0, len(cipher), 16):
            c = cipher[i:i + 16]
            p = strxor(dec(strxor(c, prev_p)), prev_c)
            out[i:i + 16] = p
            prev_c, prev_p = c, p
        return bytes(out)

    return encrypt_ige, decrypt_ige


def _cryptodome_pair():
    for root in ('Cryptodome', 'Crypto'):
        try:
            mod = __import__(root + '.Cipher.AES', fromlist=['AES'])
            try:
                sx = __import__(root + '.Util.strxor', fromlist=['strxor']).strxor
                pair = make_strxor_ige(lambda key: mod.new(key, mod.MODE_ECB), sx)
            except Exception:
                pair = make_ecb_ige(lambda key: mod.new(bytes(key), mod.MODE_ECB))
            k, iv = b'k' * 32, b'i' * 32
            if pair[1](pair[0](b'x' * 48, k, iv), k, iv) != b'x' * 48:
                continue
            return pair
        except Exception:
            continue
    return None


def best_pair():
    """Return (name, encrypt_ige, decrypt_ige) of the fastest available implementation."""
    global _lib
    if _lib is None:
        _lib = _load_libcrypto() or False
    if _lib:
        try:  # self-test
            k, iv = b'k' * 32, b'i' * 32
            if ossl_decrypt_ige(ossl_encrypt_ige(b'x' * 32, k, iv), k, iv) == b'x' * 32:
                return 'openssl', ossl_encrypt_ige, ossl_decrypt_ige
        except Exception:
            pass
    global _tn
    if _tn is None:
        _tn = _load_tnige() or False
    if _tn:
        try:  # self-test: a round trip, and the same answer as the reference chaining on a second cipher
            k, iv = bytes(range(32)), bytes(range(32, 64))
            sample = bytes(range(48))
            enc = tn_encrypt_ige(sample, k, iv)
            ok = tn_decrypt_ige(enc, k, iv) == sample and enc != sample
            ref = _cryptodome_pair()
            if ok and ref:
                ok = ref[0](sample, k, iv) == enc
            if ok:
                return ('tnige-aesni' if _tn.tn_ige_info() == 2 else 'tnige'), tn_encrypt_ige, tn_decrypt_ige
        except Exception:
            pass
    pair = _cryptodome_pair()
    if pair:
        return 'pycryptodome', pair[0], pair[1]
    return None


def patch_telethon():
    """Install the fastest IGE into Telethon if it would otherwise use pure python."""
    global _impl_name
    try:
        from telethon.crypto import aes as tl_aes
    except Exception:
        return 'unavailable'
    if getattr(tl_aes, 'cryptg', None):
        _impl_name = 'cryptg'
        return _impl_name
    libssl = getattr(tl_aes, 'libssl', None)
    if libssl is not None and getattr(libssl, 'decrypt_ige', None) and getattr(libssl, 'encrypt_ige', None):
        _impl_name = 'telethon-libssl'
        return _impl_name
    best = best_pair()
    if not best:
        _impl_name = 'pyaes'
        return _impl_name
    name, enc, dec = best
    tl_aes.AES.encrypt_ige = staticmethod(enc)
    tl_aes.AES.decrypt_ige = staticmethod(dec)
    _impl_name = name
    return name


_speed = None


def bench():
    """MB/s the installed decryption reaches on this device (measured once, about 0.1-0.5 s)"""
    global _speed
    if _speed is None:
        try:
            from telethon.crypto import aes as tl_aes
            import time
            size = 64 * 1024 if _impl_name in ('pyaes', 'unavailable') else 512 * 1024
            data, k, iv = b'\x5a' * size, b'k' * 32, b'i' * 32
            t0 = time.time()
            tl_aes.AES.decrypt_ige(data, k, iv)
            _speed = round(size / 1048576.0 / max(1e-4, time.time() - t0), 1)
        except Exception:
            _speed = 0
    return _speed


def impl_name():
    return _impl_name
