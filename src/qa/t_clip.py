# -*- coding: utf-8 -*-
"""3.3.3: clipboard history + the Windows clipboard (Hebrew, emoji). Run: python t_clip.py"""
import sys,types,os,tempfile
x=types.ModuleType('xbmc'); x.getCondVisibility=lambda c: c=='System.Platform.Windows'; sys.modules['xbmc']=x
sys.path.insert(0, r'C:\My Projects\novaTV Addon\src\plugin.video.nova\resources\lib')
import clip
assert clip.clean(' a\r\nb\x00\tc\x07 ')=='a b c', repr(clip.clean(' a\r\nb\x00\tc\x07 '))
d=tempfile.mkdtemp(); s=clip.Store(os.path.join(d,'c.json'))
for i in range(80): s.add('t%d'%i)
s.add('t5'); s.pin('t5'); s.add('api_hash_123',used=True); s.pin('api_hash_123')
s2=clip.Store(os.path.join(d,'c.json'))
o=[i['t'] for i in s2.ordered()]
print(len(s2.items), o[:4])
assert o[0]=='api_hash_123' and o[1]=='t5' and len(s2.items)==61 and o[2]=='t79'
s2.pin('t5',False); s2.clear(); print([i['t'] for i in s2.ordered()])
old=clip.system_read(); print('has', clip.system_has(), 'seq', clip.system_seq())
txt=u'abc \u05e2\u05d1\u05e8\u05d9\u05ea \U0001F600 1234567890:AAH-xyz'
print('write', clip.system_write(txt)); r=clip.system_read(); print('read ok', r==txt, clip.system_seq())
clip.system_write(old or '')
print('CLIP TESTS OK')
