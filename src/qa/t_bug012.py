# 4.2.7: BUG-012 - a broken number/list in a plugin link closes the directory quietly (no raw error toast)
import ast, os, sys
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'plugin.video.nova', 'default.py')
tree = ast.parse(open(SRC, encoding='utf-8').read())
quiet = None
for node in ast.walk(tree):
    if isinstance(node, ast.Try):
        for h in node.handlers:
            if isinstance(h.type, ast.Tuple):
                names = {e.id for e in h.type.elts if isinstance(e, ast.Name)}
                if 'KeyError' in names:
                    quiet = (names, h)
assert quiet, 'quiet handler not found'
names, h = quiet
for need in ('KeyError', 'TypeError', 'ValueError', 'IndexError'):
    assert need in names, need + ' not in quiet handler'
body = ast.dump(h)
assert 'notification' not in body, 'quiet handler shows a notification'
assert 'endOfDirectory' in body
print('OK bug012', sorted(names))
