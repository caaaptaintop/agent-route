# SPDX-License-Identifier: GPL-3.0-only
"""Authenticated endpoint rotation; never trusts a changed cache as an authority.
Private state is explicitly initialized outside source control. Only server may rotate;
node names, credentials and every other transport field remain anchored. Publications
retain a private authenticated full-pin ledger to tolerate interrupted readers.
"""
from __future__ import annotations
import copy
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import uuid
from urllib.parse import urlsplit
import yaml

# Public-layer adaptation: all private files stay outside this repository.
REPO_ROOT = Path(__file__).resolve().parents[3]


def require(ok, message):
    if not ok:
        raise ValueError(message)


def external_path(value):
    """Reject both lexical in-repository paths and symlink aliases into it."""
    path = Path(value)
    require(path.is_absolute(), 'private paths must be absolute and outside the repository')
    lexical = Path(os.path.abspath(path))
    resolved = path.resolve()
    root = REPO_ROOT.resolve()
    require(not lexical.is_relative_to(root) and not resolved.is_relative_to(root),
            'private paths must remain outside the repository')
    require(not path.is_symlink(), 'private file symlink refused')
    return resolved


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stable_identity(profile):
    nodes = profile.get('proxies', [])
    require(bool(nodes), 'trusted source has no nodes')
    names = [n.get('name') for n in nodes]
    require(all(isinstance(n, str) and n for n in names) and len(names) == len(set(names)), 'invalid trusted source node names')
    for n in nodes:
        require(not any(n.get(k) for k in ('dialer-proxy', 'interface-name', 'routing-mark')), 'indirect trusted transport refused')
        server = n.get('server')
        require(isinstance(server, str) and bool(server), 'invalid source server')
        try:
            address = ipaddress.ip_address(server)
        except ValueError:
            require(bool(re.fullmatch(r'(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}', server)) and not server.lower().endswith(('.local', '.localhost', '.internal', '.invalid')), 'invalid public source hostname')
        else:
            require(address.is_global, 'non-public source endpoint refused')
    stable = [{k: v for k, v in n.items() if k != 'server'} for n in nodes]
    return digest(json.dumps(sorted(stable, key=lambda n: n['name']), sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode())


def source_url(state):
    meta = yaml.safe_load(external_path(state['profiles_file']).read_text())
    items = [x for x in meta.get('items', []) if x.get('uid') == state['source_uid']]
    require(len(items) == 1, 'registered source is missing or ambiguous')
    url = items[0].get('url', '')
    parsed = urlsplit(url)
    require(parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username and not parsed.password and not parsed.fragment, 'source must use original HTTPS authority')
    require(digest(url.encode()) == state['url_sha256'], 'registered source URL changed; explicit review required')
    return url


def fetch_https(url):
    # URL can contain a subscription token; pass it on stdin, never in argv/logs.
    with tempfile.TemporaryDirectory(prefix='trusted-subscription-') as directory:
        path = external_path(Path(directory) / 'source.yaml')
        args = ['/usr/bin/curl', '--disable', '--silent', '--fail', '--proto', '=https', '--connect-timeout', '5', '--max-time', '20', '--max-filesize', '4194304', '--user-agent', 'clash-verge/v2.5.10', '--output', str(path), '--write-out', '%{http_code} %{ssl_verify_result}', '--config', '-']
        try:
            result = subprocess.run(args, input='url = ' + json.dumps(url) + '\n', capture_output=True, text=True, timeout=24)
        except (OSError, subprocess.TimeoutExpired):
            raise ValueError('trusted source HTTPS request failed; previous output retained') from None
        require(result.returncode == 0 and result.stdout.strip() == '200 0', 'trusted source HTTPS verification failed; redirects are not trusted automatically')
        try:
            profile = yaml.safe_load(path.read_bytes())
        except Exception:
            raise ValueError('trusted source response is not valid YAML') from None
    require(isinstance(profile, dict), 'trusted source response must be a mapping')
    return profile


def resolve_profile(state, cache_bytes, fetcher=None):
    fetcher = fetcher or fetch_https
    url = source_url(state)
    try:
        cached = yaml.safe_load(cache_bytes)
    except Exception:
        raise ValueError('source trigger cache is not valid YAML') from None
    require(isinstance(cached, dict) and stable_identity(cached) == state['stable_identity'], 'source credentials or transport changed; explicit review required')
    cache_sha = digest(cache_bytes)
    reused = cache_sha == state.get('cache_sha256') and bool(state.get('verified_profile'))
    verified = copy.deepcopy(state['verified_profile']) if reused else fetcher(url)
    require(stable_identity(verified) == state['stable_identity'], 'HTTPS source credentials or transport changed; explicit review required')
    # The authority may rotate endpoints, not this device's TUN, controller,
    # groups or runtime policy. Only server values enter the enrolled baseline.
    base = copy.deepcopy(state['policy_base'])
    require(stable_identity(base) == state['stable_identity'], 'enrolled policy baseline does not match stable identity')
    remote = {node['name']: node for node in verified['proxies']}
    for node in base['proxies']:
        node['server'] = remote[node['name']]['server']
    verified = base
    result = copy.deepcopy(state)
    result.update(cache_sha256=cache_sha, verified_profile=verified)
    if not reused:
        result['verified_at'] = time.time()
    return verified, result, not reused


def compatible_script(v2, template, current, previous):
    nodes = list(current['proxies'])
    seen = {json.dumps(n, sort_keys=True) for n in nodes}
    for node in previous:
        key = json.dumps(node, sort_keys=True)
        if key not in seen:
            nodes.append(node)
            seen.add(key)
    return v2.compile_script(template, {'proxies': nodes})[0]


def atomic_publish(payloads, backup_dir, writer, sticky_paths=()):
    """Rollback data on handled errors; do not revoke authenticated exposed pins.
    Each target is replaced atomically, not a claim of cross-file power-loss atomicity.
    """
    payloads = [(external_path(path), text) for path, text in payloads]
    require(len({path for path, _ in payloads}) == len(payloads), 'publication targets overlap')
    sticky_paths = {external_path(path) for path in sticky_paths}
    require(sticky_paths.issubset({path for path, _ in payloads}), 'sticky target is not a publication target')
    run = external_path(backup_dir) / ('source-rotation-' + time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6])
    run.mkdir(mode=0o700, parents=True)
    before = {}
    for i, (path, text) in enumerate(payloads):
        require(not path.is_symlink(), 'publication symlink refused')
        before[path] = path.read_bytes() if path.exists() else None
        if before[path] is not None:
            (run / (str(i) + '.before')).write_bytes(before[path])
            (run / (str(i) + '.before')).chmod(0o600)
    (run / 'targets.json').write_text(json.dumps([str(p) for p, _ in payloads], ensure_ascii=False) + '\n')
    (run / 'targets.json').chmod(0o600)
    written = []
    try:
        for path, text in payloads:
            current = path.read_bytes() if path.exists() else None
            require(current == before[path], 'publication target changed concurrently')
            if current != text.encode():
                # A writer may replace successfully and only then raise (e.g. fsync).
                # Record the attempted version first; compensation checks actual bytes.
                written.append((path, text.encode()))
                writer(path, text)
    except BaseException:
        incomplete = False
        for path, published in reversed(written):
            if path in sticky_paths:
                continue
            try:
                require(external_path(path) == path, 'publication target identity changed')
                current = path.read_bytes() if path.exists() else None
                if current == before[path]:
                    continue
                # Never overwrite an independent edit made after our replacement.
                if current != published:
                    incomplete = True
                    continue
                if before[path] is None:
                    path.unlink()
                else:
                    writer(path, before[path].decode())
            except BaseException:
                # One failed restore cannot prevent compensation of earlier targets.
                incomplete = True
        if incomplete:
            raise ValueError('publication failed; rollback incomplete; private recovery review required') from None
        raise
    return run
