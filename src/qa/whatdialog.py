import os, sys, json
sys.argv = ['x', '0', '0']
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'crawl.py'), encoding='utf-8').read().split('# listing actions')[0])
sys.stdout.reconfigure(encoding='utf-8')
try:
    print('window:', rpc('GUI.GetProperties', {'properties': ['currentwindow', 'currentcontrol']}, 10))
    labels = ['Control.GetLabel(1)', 'Control.GetLabel(9)', 'Control.GetLabel(10)', 'Control.GetLabel(11)', 'System.CurrentWindow', 'System.CurrentControl',
              'Window.Property(heading)']
    print(json.dumps(rpc('XBMC.GetInfoLabels', {'labels': labels}, 10).get('result'), ensure_ascii=False, indent=1))
    print('modal:', rpc('XBMC.GetInfoBooleans', {'booleans': ['System.HasActiveModalDialog', 'Window.IsActive(yesnodialog)', 'Window.IsActive(progressdialog)', 'Window.IsActive(busydialog)', 'Player.HasMedia']}, 10).get('result'))
except Exception as e:
    print('rpc failed:', e)
