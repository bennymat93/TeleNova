# -*- coding: utf-8 -*-
"""The second half of the sealed-file test: what web/sealed.js sealed (repacked.json, written by t_web.js) is opened
here with the build's own configio.unpack + zipfile, and the document inside is compared, canonical text against
canonical text.

  python check_repack.py <folder>"""
import base64, hashlib, importlib.util, io, json, os, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..')


def load(name, *path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SRC, *path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main(folder):
    sd = load('syncdoc', 'plugin.video.nova', 'resources', 'lib', 'syncdoc.py')
    configio = load('configio', 'plugin.video.telescope', 'resources', 'lib', 'configio.py')
    with open(os.path.join(folder, 'repacked.json'), encoding='utf-8') as f:
        cases = json.load(f)
    bad = []
    for c in cases:
        blob = base64.b64decode(c['blob'])
        try:
            settings, files, extra, head = configio.unpack(blob, c['password'])
        except configio.ConfigError as e:
            bad.append('%s: Python refuses the file sealed in the browser: %s' % (c['name'], e))
            continue
        if bool(head.get('encrypted')) != bool(c['password']):
            bad.append('%s: header' % c['name'])
        if 'canon' in c:
            try:
                with zipfile.ZipFile(io.BytesIO(files['setup.zip'])) as z:      # exactly autosync.KodiHost.cloud_get
                    doc = json.loads(z.read('sync.json').decode('utf-8'))
            except Exception as e:
                bad.append('%s: the zip made in the browser: %s' % (c['name'], e))
                continue
            if sd.canon(doc) != c['canon']:
                bad.append('%s: the document differs after the round trip' % c['name'])
            if not sd.same(sd.merge(doc, None), doc):
                bad.append('%s: the document the browser wrote is not in normal form' % c['name'])
            if extra != {'note': c['note']}:
                bad.append('%s: the note differs' % c['name'])
            if c['password']:
                try:
                    configio.unpack(blob, c['password'] + 'x')
                    bad.append('%s: opened with a wrong password' % c['name'])
                except configio.ConfigError:
                    pass
        else:
            name = [k for k in files][0]
            if settings != c['settings'] or extra != c['extra'] or hashlib.sha256(files[name]).hexdigest() != c['file_sha256']:
                bad.append('%s: content differs' % c['name'])
    for b in bad:
        print('FAIL', b)
    print('python opened %d files sealed by sealed.js' % len(cases) if not bad else 'REPACK: %d problems' % len(bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
