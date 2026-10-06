from pathlib import Path
import hashlib

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

expected = {
    'mobile-v4/js/home-toolbar.js': '9086daa006f9fa9c271cdedf3079d6a948f8b7b2494ea31e0dc2085424b31752',
    'mobile-v4/js/home-toolbar.css': 'ab1c328a35218c85989160fae1de1bc49e31b964521225f7e0aeb7b3c0e53d29',
    'mobile-v4/tests/home-toolbar.cjs': 'f6d3fdf7839a68f713d33f9679d4600cd4244ead8173de05c43554c3b1aca71c',
    'mobile-v4/app.html': '0fa59baf9c5826042da2e63666e59d6c83761654179b2112da71d98c06a521ac'
}
for path, digest in expected.items():
    assert sha(path) == digest, 'Unreviewed source: ' + path
p = Path('mobile-v4/app.html')
s = p.read_text()
a = '\n</head>\n<body>'
b = '\n</body>\n</html>'
assert s.count(a) == 1 and s.count(b) == 1
s = s.replace(a, '\n<link rel="stylesheet" href="js/home-toolbar.css?v=20261006-menu1">' + a)
s = s.replace(b, '\n<script src="js/home-toolbar.js?v=20261006-menu1"></script>' + b)
p.write_text(s)
assert sha(p) == '99aeace3cd55f3ec16055126b777366dd35ac4e27f546a9c1c80cd6a9f9cade1'
for entry in ['index.html', 'mobile-v4/index.html']:
    p = Path(entry)
    s = p.read_text()
    assert s.count('20261006-a4-1') == 2, 'Entry URL changed: ' + entry
    p.write_text(s.replace('20261006-a4-1', '20261006-menu1'))
print('Verified exact locally tested compact toolbar integration.')
