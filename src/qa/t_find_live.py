# -*- coding: utf-8 -*-
"""A real search through the engine of the running Kodi: how long, how many sources, how many carry the 4.0.5 marks.
   python t_find_live.py tv tt0903747 1 1      |      python t_find_live.py movie tt0111161
Prints counts and file names only."""
import io, sys, time
import tg_rpc

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
kind, imdb = sys.argv[1], sys.argv[2]
target = {'type': kind, 'imdb': imdb, 'refresh': True}
if kind == 'tv':
    target.update(season=int(sys.argv[3]), episode=int(sys.argv[4]))
t0 = time.time()
job = tg_rpc.call('find_start', target=target, timeout=30)['result']
job_id = job.get('job') if isinstance(job, dict) else job
st = {}
while time.time() - t0 < 90:
    time.sleep(1)
    st = tg_rpc.call('find_status', job=job_id, timeout=30)['result']
    if st.get('done') or st.get('error') or st.get('state') in ('done', 'error'):
        break
res = st.get('result') or st.get('results') or []
print('%.1fs  %d sources  error=%s  stats=%s' % (time.time() - t0, len(res), st.get('error'), st.get('stats')))
synced = [r for r in res if r.get('he_sub_synced')]
print('synced Hebrew subtitle (Wizdom): %d  exact=%d group=%d' % (
    len(synced), sum(1 for r in synced if r['he_sub_synced'] == 'exact'), sum(1 for r in synced if r['he_sub_synced'] == 'group')))
print('backends:', dict((b, sum(1 for r in res if r.get('backend') == b)) for b in set(r.get('backend') for r in res)))
for r in res[:8]:
    print('  %5.1f %-4s %-6s %s' % (r.get('score') or 0, r.get('backend'), r.get('he_sub_synced') or '-', (r.get('file') or '')[:80]))
print('length notes:', [w for r in res for w in (r.get('why') or []) if isinstance(w, str) and 'length' in w][:4])
