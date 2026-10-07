"""Own-three-file delivery. No Obsidian calls; begin needs a fresh ROOT grant."""
from pathlib import Path
import datetime as dt
import hashlib
import json
import os
import sys
import tempfile
import time

OWNER = '01a10c7c-6e4a-7ad0-8e52-5e0c9bb51484'
JOB = 'manager016-enso-files-20261007'
ROOT = Path('/Users/eme/Obsidian/ENSO')
LEASE = Path('/var/folders/gd/hvzhhtjs0794fpy1_27c0hg40000gn/T/enso-mac-lease-01a0f837-20261006.json')
ID = 'aigility-plugin-manager'
PINS = {
    'main.js': 'bf1d245660349e4f1f4578a38a4563eee15bd5a5833c12639468d75aff201223',
    'manifest.json': '1d08012e04dfbd2edeaf5833813af8101afdb7438c9d220019ec39b97f7567c4',
    'styles.css': 'c5b8a3d5fd8250e3fd1156325164aaab83db70d0a68ff31cbc126be691cbf95a',
}

def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def syncdir(p):
    fd = os.open(p, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def save(p, data):
    with Path(p).open('xb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    syncdir(Path(p).parent)

def record(p, value):
    save(p, (json.dumps(value, indent=2) + '\n').encode())

def identity(p):
    s = Path(p).stat()
    return {'realpath': str(Path(p).resolve()), 'dev': s.st_dev, 'ino': s.st_ino}

def protected_paths(temporary=None):
    config = ROOT / '.obsidian'
    target = config / 'plugins' / ID
    paths = set(config.glob('*.json')) | set((config / 'plugins').glob('*/data.json'))
    paths.update(p for p in target.rglob('*') if p.is_file() and p != temporary and
                 (p.parent != target or p.name not in PINS))
    return sorted(str(p) for p in paths)

def prepare():
    project = Path(__file__).resolve().parent.parent
    target = ROOT / '.obsidian/plugins' / ID
    assert not any((target / n).is_symlink() for n in PINS), 'Own artifacts must be regular files'
    assert ID not in json.loads((ROOT / '.obsidian/community-plugins.json').read_text()), 'Manager no longer OFF'
    assert {n: sha(project / n) for n in PINS} == PINS, 'Candidate drift'
    manifest = json.loads((project / 'manifest.json').read_text())
    assert manifest['id'] == ID and manifest['version'] == '0.1.6'
    package = Path(tempfile.mkdtemp(prefix='manager016-enso-files-'))
    (package / 'candidate').mkdir()
    for n in PINS:
        save(package / 'candidate' / n, (project / n).read_bytes())
    save(package / 'runner.py', Path(__file__).read_bytes())
    protected = {p: sha(p) for p in protected_paths()}
    baseline = {
        'owner': OWNER, 'job': JOB, 'root': identity(ROOT), 'target': identity(target),
        'leasePath': str(LEASE), 'runnerSha': sha(package / 'runner.py'),
        'artifacts': PINS, 'preimages': {n: sha(target / n) for n in PINS},
        'protected': protected, 'nativeOFF': True,
        'at': dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    # Detect changes across the snapshot before publishing READY.
    assert {p: sha(p) for p in protected_paths()} == protected, 'Snapshot drift'
    assert {n: sha(target / n) for n in PINS} == baseline['preimages'], 'Own snapshot drift'
    record(package / 'loaded.json', baseline)
    syncdir(package)
    syncdir(package.parent)
    print(json.dumps({'package': str(package), 'loadedSHA': sha(package / 'loaded.json'),
                      'runnerSHA': baseline['runnerSha'], 'protectedFileCount': len(protected)}))

def begin(package):
    package = Path(package).resolve()
    baseline = json.loads((package / 'loaded.json').read_text())
    lease_bytes = LEASE.read_bytes()
    grant = json.loads(lease_bytes)
    epoch = lambda value: dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    now = time.time()
    assert grant['status'] == 'GRANTED' and grant['owner'] == OWNER and grant['executor'] == OWNER
    assert grant['job'] == JOB and grant['loadedSHA'] == sha(package / 'loaded.json')
    assert Path(grant['packageDirectory']).resolve() == package and grant['token']
    assert now < epoch(grant['ackBy']) and now < epoch(grant['absoluteHardDeadline']), 'Expired grant'
    assert sha(Path(__file__)) == baseline['runnerSha'], 'Runner drift'
    assert not (package / 'control.json').exists(), 'Begin once; existing control requires closure'
    hard = epoch(grant['absoluteHardDeadline'])
    start_by, action_by = min(now + 15, hard), min(now + 60, hard)
    control = {'token': grant['token'], 'job': JOB, 'acknowledgedAt': now,
               'startBy': start_by, 'actionBy': action_by, 'pending': True}
    record(package / 'control.json', control)
    control_sha = sha(package / 'control.json')
    target = ROOT / '.obsidian/plugins' / ID
    expected = dict(baseline['preimages'])
    copied = []

    def guard(deadline, temporary=None):
        assert time.time() < deadline, 'Deadline expired'
        assert LEASE.read_bytes() == lease_bytes and sha(package / 'control.json') == control_sha, 'Lease/control drift'
        assert identity(ROOT) == baseline['root'] and identity(target) == baseline['target'], 'Target identity drift'
        assert {p: sha(p) for p in protected_paths(temporary)} == baseline['protected'], 'Protected config drift'
        assert not any((target / n).is_symlink() for n in PINS), 'Own artifact symlink drift'
        assert {n: sha(target / n) for n in PINS} == expected, 'Own file drift'
        assert sha(package / 'runner.py') == baseline['runnerSha'], 'Frozen runner drift'

    try:
        guard(start_by)
        buffers = {n: (package / 'candidate' / n).read_bytes() for n in PINS}
        assert {n: hashlib.sha256(b).hexdigest() for n, b in buffers.items()} == PINS
        backup = package / 'backup'
        backup.mkdir()
        for n in PINS:
            save(backup / n, (target / n).read_bytes())
        for i, p in enumerate(baseline['protected']):
            save(backup / ('protected-' + str(i)), Path(p).read_bytes())
        record(backup / 'index.json', baseline)
        syncdir(backup)
        syncdir(package)
        guard(start_by)
        record(package / 'first-action.json', {'token': grant['token'], 'at': time.time()})
        for n, b in buffers.items():
            guard(action_by)
            temporary = target / ('.' + n + '.' + grant['token'] + '.tmp')
            save(temporary, b)
            os.chmod(temporary, (target / n).stat().st_mode & 0o777)
            guard(action_by, temporary)
            os.replace(temporary, target / n)
            syncdir(target)
            expected[n] = PINS[n]
            copied.append(n)
            guard(action_by)
        guard(action_by)
        receipt = {'status': 'SETTLED', 'pending': False, 'token': grant['token'],
                   'job': JOB, 'installedVersion': '0.1.6', 'nativeOFF': True,
                   'loadedVerified': False, 'artifacts': expected, 'copied': copied,
                   'protectedFileCount': len(baseline['protected']), 'protectedDrift': [],
                   'at': dt.datetime.now(dt.timezone.utc).isoformat()}
    except Exception as error:
        receipt = {'status': 'FAILED_PRESERVED', 'pending': False, 'token': grant['token'],
                   'job': JOB, 'copied': copied, 'error': str(error),
                   'at': dt.datetime.now(dt.timezone.utc).isoformat()}
    record(package / 'result.json', receipt)
    print(json.dumps(receipt))

if __name__ == '__main__':
    if sys.argv[1:] == ['prepare']:
        prepare()
    elif len(sys.argv) == 3 and sys.argv[1] == 'begin':
        begin(sys.argv[2])
    else:
        raise SystemExit('prepare | begin PACKAGE')
