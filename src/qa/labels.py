import re, sys
sys.stdout.reconfigure(encoding='utf-8')
base = r'C:\My Projects\novaTV Addon\src\plugin.video.telescope\resources'
po = open(base + r'\language\resource.language.he_il\strings.po', encoding='utf-8').read()
he = dict(re.findall(r'msgctxt "#(\d+)"\s*\nmsgid "[^"]*"\s*\nmsgstr "([^"]*)"', po))
xml = open(base + r'\settings.xml', encoding='utf-8').read()
for sid, lab in re.findall(r'<setting id="(\w+)"[^>]*label="(\d+)"', xml):
    if sid in ('strict', 'min_quality', 'hide_cam', 'hide_slow', 'keep_unprobed', 'probe_count', 'max_results', 'search_limit',
               'max_aliases', 'max_queries', 'parallel', 'readahead', 'cache_mb', 'use_telemedia', 'stremio_servers', 'chiko',
               'chiko_keywords', 'gemini_key', 'api_id', 'api_hash', 'tmdb_key', 'ai_aliases', 'ai_verify', 'lang_pref'):
        print('%-16s %s' % (sid, he.get(lab)))
print('--- menu strings')
for k, v in he.items():
    if any(w in v for w in ('גילוי', 'הצטרף', 'הטלגרם שלי', 'חשבון', 'QR', 'התחבר', 'צ\'יקו', 'ערוצים')):
        print(k, v[:80])
