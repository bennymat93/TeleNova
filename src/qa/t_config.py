# -*- coding: utf-8 -*-
"""3.3.3: configuration file (pack / unpack / refusals). Run: python t_config.py"""
import sys,os,time
sys.path.insert(0, r'C:\My Projects\novaTV Addon\src\plugin.video.telescope\resources\lib')
import configio as c
sess=b'SQLite format 3\x00'+os.urandom(120000)
st={'api_id':'12345','api_hash':'abcdef','bots':'@x,@y','he':u'\u05e2\u05d1\u05e8\u05d9\u05ea'}
for pw in ('', u'\u05e1\u05d9\u05e1\u05de\u05d4 123'):
    t=time.time(); b=c.pack(st,{'telegram.session':sess,'bots.json':b'{}'},pw,{'shared':{'tmdb_key':'k'}}); 
    s2,f2,e2,h=c.unpack(b,pw); print('roundtrip',bool(pw),s2==st,f2['telegram.session']==sess,e2['shared']['tmdb_key']=='k',h['has_session'],len(b),'%.2fs'%(time.time()-t))
    assert s2==st and f2['telegram.session']==sess
    if pw:
        assert sess[:40] not in b and b'abcdef' not in b
enc=c.pack(st,{'telegram.session':sess},'pw')
for name,blob,pw in (('no password',enc,''),('wrong password',enc,'px'),('flipped byte',enc[:5000]+bytes([enc[5000]^1])+enc[5001:],'pw'),('truncated',enc[:-10],'pw'),('garbage',b'hello',''),('plain damaged',c.pack(st,{})[:-3]+b'abc','')):
    try: c.unpack(blob,pw); print('FAIL',name)
    except c.ConfigError as e: print('refused',name,'->',e)
import base64,json,zlib
evil=c.MAGIC+json.dumps({'format':1,'encrypted':False}).encode()+b'\n'+zlib.compress(json.dumps({'settings':{},'files':{'../../evil.py':base64.b64encode(b'x').decode()}}).encode())
try: c.unpack(evil); print('FAIL path')
except c.ConfigError as e: print('refused path traversal ->',e)
print('CONFIG TESTS OK')
