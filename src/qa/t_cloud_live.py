# -*- coding: utf-8 -*-
"""Live check of the setup kept in the Telegram account (engine RPC, the running Kodi, account logged in):
upload a small test file as the device "qa-selftest", list, download, compare, delete - nothing else in Saved
Messages is touched, and no copy of a real device is read or changed. Prints sizes and counts only."""
import base64, io, sys, time, zipfile
import tg_rpc

buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('bn_backup.txt', 'self test %d\n' % time.time())
    z.writestr('addon_data/plugin.video.nova/qa_selftest.json', '{"x": "%s"}' % ('y' * 2000))
data = buf.getvalue()
bad = []
t = time.time()
before = tg_rpc.call('cloud_list', timeout=60)['result']
put = tg_rpc.call('cloud_put', timeout=200, data=base64.b64encode(data).decode(), device='qa-selftest',
                  name='QA self test', build='qa', fp='selftest')['result']
print('upload: id ok=%s in %.1fs' % (bool(put.get('id')), time.time() - t))
items = tg_rpc.call('cloud_list', timeout=60)['result']
mine = [i for i in items if i['note'].get('device') == 'qa-selftest']
if len(mine) != 1 or mine[0]['id'] != put['id'] or mine[0]['note'].get('fp') != 'selftest':
    bad.append('list after upload: %d test copies' % len(mine))
print('copies in the account: %d before, %d now; test copy %d bytes sealed (zip %d bytes)' % (
    len(before), len(items), mine[0]['size'] if mine else -1, len(data)))
got = base64.b64decode(tg_rpc.call('cloud_get', timeout=200, id=put['id'])['result']['data'])
if got != data:
    bad.append('download differs from upload')
put2 = tg_rpc.call('cloud_put', timeout=200, data=base64.b64encode(data).decode(), device='qa-selftest',
                   name='QA self test', build='qa', fp='selftest2')['result']
if put2.get('removed') != 1:
    bad.append('second upload removed %s older copies (1 expected)' % put2.get('removed'))
rm = tg_rpc.call('cloud_delete', timeout=60, ids=[put2['id'], 1])['result']       # id 1: not a setup file - ignored
if rm.get('removed') != 1:
    bad.append('delete removed %s' % rm.get('removed'))
after = tg_rpc.call('cloud_list', timeout=60)['result']
if len(after) != len(before) or any(i['note'].get('device') == 'qa-selftest' for i in after):
    bad.append('test copy left behind')
for b in bad:
    print('FAIL', b)
print('CLOUD LIVE OK' if not bad else 'CLOUD LIVE: %d problems' % len(bad))
sys.exit(1 if bad else 0)
