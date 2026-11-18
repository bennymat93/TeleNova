# -*- coding: utf-8 -*-
"""ho.py "<stamp>" <file with the block text>  - replaces the IN PROGRESS block at the top of HANDOFF's start section"""
import io, sys
p = 'C:\\My Projects\\novaTV Addon\\src\\HANDOFF.md'
s = io.open(p, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'
s = s.replace('\r\n', '\n')
A, B = u'<!-- IN-PROGRESS:START -->', u'<!-- IN-PROGRESS:END -->'
body = io.open(sys.argv[2], encoding='utf-8').read().strip()
block = A + u'\n### IN PROGRESS – עודכן ' + sys.argv[1] + u' (להמשיך מכאן)\n' + body + u'\n' + B + u'\n\n'
if A in s:
    s = s[:s.index(A)] + block + s[s.index(B) + len(B):].lstrip('\n')
else:
    k = s.index(u'### המצב עכשיו')
    s = s[:k] + block + s[k:]
io.open(p, 'w', encoding='utf-8', newline='').write(s.replace('\n', nl))
print('handoff updated')
