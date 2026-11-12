import os, sys
sys.argv = ['x', '0', '0']
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crawl.py'), encoding='utf-8').read().split('# listing actions')[0])
print('quit:', rpc('Application.Quit').get('result'))
