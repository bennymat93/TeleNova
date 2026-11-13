# -*- coding: utf-8 -*-
"""4.0.8: an AI / machine Hebrew subtitle shows Hebrew only. No network."""
import importlib.util, io, os, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('mtrans', os.path.join(HERE, '..', 'plugin.video.nova', 'resources', 'lib', 'mtrans.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
bad = []


def check(cond, what):
    if not cond:
        bad.append(what)


H = m.is_hebrew
check(H(u'מה קורה?') and H(u'אני אוהב את iPhone') and H(u'- לא. - כן!'), 'Hebrew, also with a brand inside')
check(H('...') and H('12:30') and H(u'♪ ♪') and H(''), 'no letters at all is fine')
check(not H('What is going on?') and not H(u'Что происходит?') and not H(u'ماذا يحدث'), 'another language')
check(not H(u'כן, but I really do not think so at all'), 'mostly foreign with one Hebrew word is not Hebrew')

src = ['Hello there.', 'What are you doing?', '...', u'Привет', 'John!', u'שלום', 'Nothing translates this']
out = [u'שלום לך.', 'What are you doing?', '...', u'Привет', 'John!', u'שלום', 'Nothing translates this']
table = {'What are you doing?': u'מה אתה עושה?', u'Привет': u'היי', 'John!': u"ג'ון!", 'Nothing translates this': 'Nothing translates this'}
asked = []


def again(line):
    asked.append(line)
    return table.get(line, '')


st = {}
res = m.hebrew_only(src, out, 'en', st, again=again)
check(res == [u'שלום לך.', u'מה אתה עושה?', '...', u'היי', u"ג'ון!", u'שלום', ''], 'every line Hebrew or left out: %r' % res)
check(asked == ['What are you doing?', u'Привет', 'John!', 'Nothing translates this'], 'only the lines that were not Hebrew are asked again')
check(st == {'retranslated': 3, 'not_hebrew_dropped': 1}, 'counted: %r' % st)
check(all(m.is_hebrew(x) for x in res), 'nothing foreign is left')
check(m.hebrew_only(['a b c', 'd e f'], None, again=lambda l: u'אבג') == [u'אבג', u'אבג'], 'a missing answer is translated line by line')
check(m.hebrew_only(['a b c'], ['x', 'y'], again=lambda l: '') == [''], 'a wrong-length answer never shifts lines')
check(m.hebrew_only([u'כבר עברית'], ['already hebrew'], again=lambda l: '') == [u'כבר עברית'], 'a Hebrew source line is kept as it is')
check(m.hebrew_only(['Hi'], [u'היי'], again=lambda l: 1 / 0) == [u'היי'], 'good lines never call the engines')


def boom(line):
    raise IOError('network')


check(m.hebrew_only(['Hi'], ['Hi'], again=boom) == [''], 'a failing engine drops the line, never raises')
# the default path uses the module's engines: stand-ins, no network
calls = []
m.ENGINES = [('a', lambda lines, s, d: calls.append('a') or ['still english']), ('b', lambda lines, s, d: calls.append('b') or [u'עכשיו בעברית'])]
check(m.hebrew_only(['now in hebrew'], ['now in hebrew']) == [u'עכשיו בעברית'] and calls == ['a', 'b'], 'the next engine is tried')
m.translate = lambda lines, src, dst, stats=None, deadline=None: [u'שורה אחת', 'line two', u'שורה שלוש']
m.ENGINES = [('a', lambda lines, s, d: ['no'])]
cues = m.translate_cues([{'start': 0, 'end': 1, 'text': 'one'}, {'start': 1, 'end': 2, 'text': 'two'}, {'start': 2, 'end': 3, 'text': 'three'}])
check([c['he'] for c in cues] == [u'שורה אחת', u'שורה שלוש'] and cues[1]['start'] == 2, 'a cue that could not be made Hebrew is not shown; times stay with their lines')

for b in bad:
    print('FAIL', b)
print('HEBREW ONLY TESTS OK' if not bad else 'HEBREW ONLY TESTS: %d problems' % len(bad))
sys.exit(1 if bad else 0)
