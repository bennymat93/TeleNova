import ctypes, os, time
dll = ctypes.CDLL(r'C:\My Projects\novaTV Addon\src\plugin.video.telescope\resources\bin\win-x64\tnige.dll')
dll.tn_ige.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
dll.tn_ige.restype = None
print('info (2=AES-NI):', dll.tn_ige_info())
def mine(data, key, iv, flags):
    out = ctypes.create_string_buffer(len(data)); dll.tn_ige(data, out, len(data), key, iv, flags); return out.raw

class K(ctypes.Structure):
    _fields_ = [('rd_key', ctypes.c_uint32 * 60), ('rounds', ctypes.c_uint)]
os.add_dll_directory(r'C:\Program Files\Git\ucrt64\bin')
ref = ctypes.CDLL(r'C:\Program Files\Git\ucrt64\bin\libcrypto-3-x64.dll')
ref.AES_ige_encrypt.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_size_t, ctypes.POINTER(K), ctypes.c_char_p, ctypes.c_int]
ref.AES_ige_encrypt.restype = None
def ossl(data, key, iv, enc):
    k = K(); (ref.AES_set_encrypt_key if enc else ref.AES_set_decrypt_key)(key, 256, ctypes.byref(k))
    out = ctypes.create_string_buffer(len(data)); ivb = ctypes.create_string_buffer(iv, 32)
    ref.AES_ige_encrypt(data, out, len(data), ctypes.byref(k), ivb, 1 if enc else 0); return out.raw

bad = 0
for n in (16, 32, 48, 1024, 65536, 1048576):
    for _ in range(6):
        key, iv, data = os.urandom(32), os.urandom(32), os.urandom(n)
        ce, cd = ossl(data, key, iv, True), ossl(data, key, iv, False)
        for flags_extra, name in ((0, 'aesni'), (2, 'portable')):
            if mine(data, key, iv, 1 | flags_extra) != ce or mine(data, key, iv, 0 | flags_extra) != cd:
                bad += 1; print('MISMATCH', name, n)
print('cases compared with OpenSSL 3: mismatches =', bad)
key, iv, data = os.urandom(32), os.urandom(32), os.urandom(1048576)
for flags, name in ((0, 'AES-NI'), (2, 'portable')):
    t = time.time(); c = 0
    while time.time() - t < 1: mine(data, key, iv, flags); c += 1
    print('%s decrypt: %.0f MB/s' % (name, c / (time.time() - t)))
