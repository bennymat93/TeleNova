/* tnige - AES-256-IGE for the TeleNova Telegram engine (MTProto file chunks).
 *
 * Kodi for Windows links OpenSSL statically into its Python, so no AES_ige_encrypt can be reached through ctypes;
 * the engine then decrypted block by block in Python at about 0.2 MB/s. This tiny library has no dependency
 * (static CRT), uses AES-NI when the CPU has it and a plain portable AES otherwise.
 *
 *   void tn_ige(const uint8_t *in, uint8_t *out, size_t len, const uint8_t key[32], const uint8_t iv[32], int flags)
 *       flags bit 0: 1 = encrypt, 0 = decrypt        flags bit 1: never use AES-NI (tests)
 *       len must be a multiple of 16; in and out may not overlap
 *   int tn_ige_info(void)   -> 2 when AES-NI is used, 1 portable
 *
 * Build (MSVC):  cl /nologo /O2 /MT /LD tnige.c /Fe:tnige.dll
 * GPL-3.0-or-later, like the add-on.
 */
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <intrin.h>
#include <wmmintrin.h>
#include <emmintrin.h>

#define EXPORT __declspec(dllexport)

static uint8_t SBOX[256], INV[256];
static volatile int ready = 0;
static int has_aesni = 0;

static uint8_t rotl8(uint8_t x, int s) { return (uint8_t)((x << s) | (x >> (8 - s))); }

static void init(void)
{
    uint8_t p = 1, q = 1;
    int regs[4];
    int i;
    if (ready) return;
    do {
        uint8_t x;
        p = (uint8_t)(p ^ (uint8_t)(p << 1) ^ ((p & 0x80) ? 0x1B : 0));
        q ^= (uint8_t)(q << 1);
        q ^= (uint8_t)(q << 2);
        q ^= (uint8_t)(q << 4);
        q ^= (q & 0x80) ? 0x09 : 0;
        x = (uint8_t)(q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4));
        SBOX[p] = (uint8_t)(x ^ 0x63);
    } while (p != 1);
    SBOX[0] = 0x63;
    for (i = 0; i < 256; i++) INV[SBOX[i]] = (uint8_t)i;
    __cpuid(regs, 1);
    has_aesni = ((regs[2] >> 25) & 1) && ((regs[3] >> 26) & 1);      /* AES + SSE2 */
    ready = 1;
}

/* AES-256 key schedule: 15 round keys of 16 bytes */
static void expand(const uint8_t *key, uint8_t rk[240])
{
    static const uint8_t rcon[8] = { 0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40 };
    int i;
    memcpy(rk, key, 32);
    for (i = 8; i < 60; i++) {
        uint8_t t[4];
        memcpy(t, rk + 4 * (i - 1), 4);
        if (i % 8 == 0) {
            uint8_t a = t[0];
            t[0] = (uint8_t)(SBOX[t[1]] ^ rcon[i / 8]);
            t[1] = SBOX[t[2]];
            t[2] = SBOX[t[3]];
            t[3] = SBOX[a];
        } else if (i % 8 == 4) {
            t[0] = SBOX[t[0]]; t[1] = SBOX[t[1]]; t[2] = SBOX[t[2]]; t[3] = SBOX[t[3]];
        }
        rk[4 * i + 0] = (uint8_t)(rk[4 * (i - 8) + 0] ^ t[0]);
        rk[4 * i + 1] = (uint8_t)(rk[4 * (i - 8) + 1] ^ t[1]);
        rk[4 * i + 2] = (uint8_t)(rk[4 * (i - 8) + 2] ^ t[2]);
        rk[4 * i + 3] = (uint8_t)(rk[4 * (i - 8) + 3] ^ t[3]);
    }
}

/* ------------------------------------------------------------------ portable AES */
static uint8_t xt(uint8_t x) { return (uint8_t)((x << 1) ^ ((x & 0x80) ? 0x1B : 0)); }

static void add_key(uint8_t *s, const uint8_t *k) { int i; for (i = 0; i < 16; i++) s[i] ^= k[i]; }

static void enc_block(uint8_t *s, const uint8_t *rk)
{
    uint8_t t[16];
    int r, c, i;
    add_key(s, rk);
    for (r = 1; r <= 14; r++) {
        for (c = 0; c < 4; c++)                       /* SubBytes + ShiftRows */
            for (i = 0; i < 4; i++)
                t[c * 4 + i] = SBOX[s[((c + i) & 3) * 4 + i]];
        if (r < 14) {
            for (c = 0; c < 4; c++) {                 /* MixColumns */
                uint8_t a0 = t[c * 4], a1 = t[c * 4 + 1], a2 = t[c * 4 + 2], a3 = t[c * 4 + 3];
                uint8_t all = (uint8_t)(a0 ^ a1 ^ a2 ^ a3);
                s[c * 4 + 0] = (uint8_t)(a0 ^ all ^ xt((uint8_t)(a0 ^ a1)));
                s[c * 4 + 1] = (uint8_t)(a1 ^ all ^ xt((uint8_t)(a1 ^ a2)));
                s[c * 4 + 2] = (uint8_t)(a2 ^ all ^ xt((uint8_t)(a2 ^ a3)));
                s[c * 4 + 3] = (uint8_t)(a3 ^ all ^ xt((uint8_t)(a3 ^ a0)));
            }
        } else {
            memcpy(s, t, 16);
        }
        add_key(s, rk + 16 * r);
    }
}

static void dec_block(uint8_t *s, const uint8_t *rk)
{
    uint8_t t[16];
    int r, c, i;
    add_key(s, rk + 16 * 14);
    for (r = 13; r >= 0; r--) {
        for (c = 0; c < 4; c++)                       /* InvShiftRows + InvSubBytes */
            for (i = 0; i < 4; i++)
                t[c * 4 + i] = INV[s[((c - i + 4) & 3) * 4 + i]];
        add_key(t, rk + 16 * r);
        if (r > 0) {
            for (c = 0; c < 4; c++) {                 /* InvMixColumns */
                uint8_t a0 = t[c * 4], a1 = t[c * 4 + 1], a2 = t[c * 4 + 2], a3 = t[c * 4 + 3];
                uint8_t u = xt(xt((uint8_t)(a0 ^ a2))), v = xt(xt((uint8_t)(a1 ^ a3)));
                uint8_t all;
                a0 ^= u; a1 ^= v; a2 ^= u; a3 ^= v;
                all = (uint8_t)(a0 ^ a1 ^ a2 ^ a3);
                s[c * 4 + 0] = (uint8_t)(a0 ^ all ^ xt((uint8_t)(a0 ^ a1)));
                s[c * 4 + 1] = (uint8_t)(a1 ^ all ^ xt((uint8_t)(a1 ^ a2)));
                s[c * 4 + 2] = (uint8_t)(a2 ^ all ^ xt((uint8_t)(a2 ^ a3)));
                s[c * 4 + 3] = (uint8_t)(a3 ^ all ^ xt((uint8_t)(a3 ^ a0)));
            }
        } else {
            memcpy(s, t, 16);
        }
    }
}

static void ige_portable(const uint8_t *in, uint8_t *out, size_t len, const uint8_t *rk, const uint8_t *iv, int enc)
{
    uint8_t pc[16], pp[16], x[16], cur[16];
    size_t off;
    int i;
    memcpy(pc, iv, 16);            /* previous ciphertext block */
    memcpy(pp, iv + 16, 16);       /* previous plaintext block */
    for (off = 0; off < len; off += 16) {
        memcpy(cur, in + off, 16);
        if (enc) {
            for (i = 0; i < 16; i++) x[i] = (uint8_t)(cur[i] ^ pc[i]);
            enc_block(x, rk);
            for (i = 0; i < 16; i++) x[i] ^= pp[i];
            memcpy(pp, cur, 16);
            memcpy(pc, x, 16);
        } else {
            for (i = 0; i < 16; i++) x[i] = (uint8_t)(cur[i] ^ pp[i]);
            dec_block(x, rk);
            for (i = 0; i < 16; i++) x[i] ^= pc[i];
            memcpy(pc, cur, 16);
            memcpy(pp, x, 16);
        }
        memcpy(out + off, x, 16);
    }
}

/* ------------------------------------------------------------------ AES-NI */
static void ige_aesni(const uint8_t *in, uint8_t *out, size_t len, const uint8_t *rk, const uint8_t *iv, int enc)
{
    __m128i k[15], pc, pp, cur, x;
    size_t off;
    int i;
    if (enc) {
        for (i = 0; i < 15; i++) k[i] = _mm_loadu_si128((const __m128i *)(rk + 16 * i));
    } else {
        k[0] = _mm_loadu_si128((const __m128i *)(rk + 16 * 14));
        for (i = 1; i < 14; i++) k[i] = _mm_aesimc_si128(_mm_loadu_si128((const __m128i *)(rk + 16 * (14 - i))));
        k[14] = _mm_loadu_si128((const __m128i *)rk);
    }
    pc = _mm_loadu_si128((const __m128i *)iv);
    pp = _mm_loadu_si128((const __m128i *)(iv + 16));
    for (off = 0; off < len; off += 16) {
        cur = _mm_loadu_si128((const __m128i *)(in + off));
        if (enc) {
            x = _mm_xor_si128(_mm_xor_si128(cur, pc), k[0]);
            for (i = 1; i < 14; i++) x = _mm_aesenc_si128(x, k[i]);
            x = _mm_xor_si128(_mm_aesenclast_si128(x, k[14]), pp);
            pp = cur;
            pc = x;
        } else {
            x = _mm_xor_si128(_mm_xor_si128(cur, pp), k[0]);
            for (i = 1; i < 14; i++) x = _mm_aesdec_si128(x, k[i]);
            x = _mm_xor_si128(_mm_aesdeclast_si128(x, k[14]), pc);
            pc = cur;
            pp = x;
        }
        _mm_storeu_si128((__m128i *)(out + off), x);
    }
}

EXPORT void tn_ige(const uint8_t *in, uint8_t *out, size_t len, const uint8_t *key, const uint8_t *iv, int flags)
{
    uint8_t rk[240];
    init();
    len &= ~(size_t)15;
    expand(key, rk);
    if (has_aesni && !(flags & 2))
        ige_aesni(in, out, len, rk, iv, flags & 1);
    else
        ige_portable(in, out, len, rk, iv, flags & 1);
}

EXPORT int tn_ige_info(void)
{
    init();
    return has_aesni ? 2 : 1;
}
