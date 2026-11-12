/* Self-check of tnige on the device it was built for: prints one line per case, compared with the values the
 * verified Windows build gives for the same inputs (src/qa/android_native_test.py).
 * Build:  clang --target=<abi> -O2 -fPIE -pie -o tntest tntest.c tnige.c */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

void tn_ige(const uint8_t *in, uint8_t *out, size_t len, const uint8_t *key, const uint8_t *iv, int flags);
int tn_ige_info(void);

static uint64_t fnv(const uint8_t *p, size_t n)
{
    uint64_t h = 1469598103934665603ULL;
    size_t i;
    for (i = 0; i < n; i++) { h ^= p[i]; h *= 1099511628211ULL; }
    return h;
}

int main(void)
{
    static uint8_t in[65536], out[65536], back[65536];
    uint8_t key[32], iv[32];
    int i, flags;
    for (i = 0; i < 32; i++) { key[i] = (uint8_t)(i * 7 + 3); iv[i] = (uint8_t)(200 - i * 5); }
    for (i = 0; i < 65536; i++) in[i] = (uint8_t)((i * 31 + (i >> 8) * 17) & 0xFF);
    printf("info %d\n", tn_ige_info());
    for (flags = 0; flags <= 2; flags += 2) {
        tn_ige(in, out, 65536, key, iv, flags | 1);
        printf("enc flags=%d %016llx\n", flags, (unsigned long long)fnv(out, 65536));
        tn_ige(out, back, 65536, key, iv, flags);
        printf("roundtrip flags=%d %s\n", flags, memcmp(in, back, 65536) == 0 ? "ok" : "BAD");
        tn_ige(in, out, 65536, key, iv, flags);
        printf("dec flags=%d %016llx\n", flags, (unsigned long long)fnv(out, 65536));
    }
    return 0;
}
