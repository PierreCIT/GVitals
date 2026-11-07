#!/usr/bin/env python3
# Modified for GVitals on 2026-11-07.
"""Check the release archive independently of the source tree."""
import json
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != "--expect-translations"):
    raise SystemExit(f"Usage: {sys.argv[0]} extension.zip [--expect-translations]")

with ZipFile(sys.argv[1]) as archive:
    names = set(archive.namelist())
    assert archive.testzip() is None, 'Corrupt archive member'
    assert all(not name.startswith('/') and '..' not in name.split('/') for name in names), 'Unsafe archive path'
    required = {'metadata.json', 'extension.js', 'prefs.js', 'prefs.ui', 'chart.js', 'menuItem.js',
                'sensors.js', 'values.js', 'stylesheet.css', 'helpers/chartSettings.js',
                'schemas/org.gnome.shell.extensions.vitals.gschema.xml', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
                'README.md', 'tools/package.sh', 'tools/compile-translations.sh', 'icons/flags/flag-icons.LICENSE'}
    assert required <= names, f'Missing files: {sorted(required - names)}'
    assert not any(name.startswith(('tests/', '.git/')) for name in names), 'Development files in archive'
    assert 'schemas/gschemas.compiled' not in names, 'Compiled schemas must be generated at installation'
    if len(sys.argv) == 3:
        assert any(re.fullmatch(r'locale/[^/]+/LC_MESSAGES/vitals\.mo', name) for name in names), 'Compiled translations missing'
    for name in names:
        if re.fullmatch(r'locale/[^/]+/LC_MESSAGES/vitals\.mo', name):
            assert name[:-3] + '.po' in names, f'Translation source missing for {name}'
    for name in ('sensors.js', 'values.js'):
        source = archive.read(name).decode('utf-8')
        assert 'Copyright (c) 2018, Chris Monahan' in source and 'Redistribution and use' in source, f'Missing BSD notice: {name}'
    for name in ('extension.js', 'prefs.js', 'menuItem.js', 'sensors.js', 'values.js',
                 'helpers/subprocess.js', 'prefs.ui', 'schemas/org.gnome.shell.extensions.vitals.gschema.xml'):
        source = archive.read(name).decode('utf-8')
        assert re.search(r'Modified for GVitals on \d{4}-\d{2}-\d{2}', source), f'Modification notice missing: {name}'
    metadata = json.loads(archive.read('metadata.json'))
    assert metadata['uuid'] == 'GVitals@NoeimDev', 'Unexpected UUID'
    assert re.search(r'Modified for GVitals on \d{4}-\d{2}-\d{2}', metadata.get('x-gvitals-modified', ''))
    assert all(metadata.get(key) for key in ('name', 'description', 'url', 'shell-version', 'settings-schema'))
    schema = ET.fromstring(archive.read('schemas/org.gnome.shell.extensions.vitals.gschema.xml'))
    assert any(item.get('id') == metadata['settings-schema'] for item in schema.findall('schema')), 'Schema mismatch'
    ET.fromstring(archive.read('prefs.ui'))
    # A release must contain every module referenced by relative ES imports.
    for name in sorted(n for n in names if n.endswith('.js')):
        source = archive.read(name).decode('utf-8')
        for relative in re.findall(r"(?:from\s+|import\s*\()\s*['\"](\.{1,2}/[^'\"]+)['\"]", source):
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), relative))
            assert target in names, f'{name} imports missing {target}'
    for theme in ('original', 'gnome'):
        assert any(name.startswith(f'icons/{theme}/') and name.endswith('.svg') for name in names), f'Missing {theme} icons'
print('Release package metadata, schema, UI, assets and module imports verified')
