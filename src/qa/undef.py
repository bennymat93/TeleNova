import ast, builtins, glob, sys
B = set(dir(builtins)) | {'__file__', '__name__', '__doc__'}
for f in sorted(glob.glob(sys.argv[1] + '/**/*.py', recursive=True)):
    if '\\native\\' in f or '\\qa\\' in f: continue
    tree = ast.parse(open(f, encoding='utf-8').read(), f)
    defined = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)): defined.add(n.name)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            a = n.args
            for x in a.args + a.kwonlyargs + getattr(a, 'posonlyargs', []): defined.add(x.arg)
            if a.vararg: defined.add(a.vararg.arg)
            if a.kwarg: defined.add(a.kwarg.arg)
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            for al in n.names: defined.add((al.asname or al.name).split('.')[0])
        if isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)): defined.add(n.id)
        if isinstance(n, ast.ExceptHandler) and n.name: defined.add(n.name)
        if isinstance(n, (ast.Global, ast.Nonlocal)): defined.update(n.names)
    for n in ast.walk(tree):
        if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id not in defined and n.id not in B:
            print('  %s:%d  %s' % (f.replace(sys.argv[1], ''), n.lineno, n.id))
print('checked')
