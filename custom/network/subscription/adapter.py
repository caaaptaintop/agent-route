# SPDX-License-Identifier: GPL-3.0-only
"""Explicit private integration API; no device discovery, default CLI or deployment.
The supplied route object implements the contract in README.md. It is trusted code,
not a module path or executable read from an untrusted subscription or state file.
"""
from __future__ import annotations
import copy
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import yaml
import trusted_source as source


PIN_MARKER = '/* PINNED_NODES */ []'


def _array(text, name):
    matches = re.findall(r'^var ' + re.escape(name) + r' = (\[.*?\]);\s*$', text, re.MULTILINE)
    source.require(len(matches) == 1, 'explicit prepared template array is missing or ambiguous')
    try:
        value = json.loads(matches[0])
    except (ValueError, TypeError):
        raise ValueError('prepared template arrays must be JSON') from None
    source.require(isinstance(value, list), 'prepared template arrays must be lists')
    return value


def validate_template(text):
    source.require(text.count(PIN_MARKER) == 1, 'prepared template requires one empty PIN injection marker')
    source.require('/* AI_PROCESS_PATHS */' not in text and '/* BROWSER_UDP_PATHS */' not in text,
                   'prepare platform application paths before enabling trusted publication')
    paths = _array(text, 'AR_AI_PROCESS_PATHS')
    source.require(bool(paths) and all(isinstance(p, str) and p.startswith('^') for p in paths),
                   'prepared AI process paths must not be empty')
    source.require(_array(text, 'AR_BROWSER_UDP_PATHS') == [], 'withdrawn browser UDP scope must remain empty')
    return text


def restore_empty_pin_marker(text):
    """Restore only an already-empty PIN declaration, never erase existing pins."""
    pattern = r'^var AR_PINNED_NODES = \[\];[ \t]*$'
    source.require(len(re.findall(pattern, text, re.MULTILINE)) == 1 and PIN_MARKER not in text,
                   'only an already-empty prepared PIN declaration can be restored')
    text = re.sub(pattern, 'var AR_PINNED_NODES = ' + PIN_MARKER + ';', text, count=1, flags=re.MULTILINE)
    return validate_template(text)


def _read_state(path):
    path = source.external_path(path)
    source.require(path.is_file() and stat.S_ISREG(path.stat().st_mode), 'explicit private trust state required')
    source.require(path.stat().st_mode & 0o077 == 0, 'private trust state must have mode 0600')
    try:
        state = json.loads(path.read_text())
    except (ValueError, UnicodeError):
        raise ValueError('private trust state is not valid JSON') from None
    source.require(isinstance(state, dict) and state.get('version') == 2 and isinstance(state.get('policy_base'), dict),
                   'explicit version-2 controlled policy baseline required')
    return state


def build_trusted(args, route, validate):
    """Publish an explicitly configured private generation under one control lock.
    The route implementation is supplied by the authorized integration runner.
    No URL, node, profile identifier, application path or deployment path is fixed here.
    """
    paths = {key: source.external_path(getattr(args, key))
             for key in ('trust_state', 'flower', 'ipequal', 'output', 'backup_dir')}
    state_path = paths['trust_state']
    _read_state(state_path)
    lock_path = source.external_path(Path(str(state_path) + '.lock'))
    flags = os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(lock_path, flags, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        source.require(stat.S_ISREG(os.fstat(lock.fileno()).st_mode), 'control lock must be a regular file')
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = _read_state(state_path)
        state_before = state_path.read_bytes()
        required = ('source_cache', 'profiles_file', 'template', 'pinned_script', 'deployed_script', 'unified_cache')
        source.require(all(key in state for key in required), 'private source or template path missing')
        private = {key: source.external_path(state[key]) for key in required}
        source.require(private['source_cache'] == paths['ipequal'], 'source cache does not match trust binding')
        ledger_path = source.external_path(Path(str(state_path) + '.accepted-pins.json'))
        targets = [private['pinned_script'], private['deployed_script'], private['unified_cache'],
                   paths['output'], state_path]
        source.require(len(set(targets)) == len(targets), 'publication targets overlap')
        inputs = [paths['flower'], paths['ipequal'], private['profiles_file'], private['template']]
        source.require(not set(targets).intersection(inputs + [lock_path, ledger_path])
                       and not {lock_path, ledger_path}.intersection(inputs),
                       'publication inputs, lock, ledger and targets overlap')
        source.require(all(path.is_file() for path in inputs), 'explicit private source or template file required')
        source_bytes = {path: path.read_bytes() for path in inputs}
        template = validate_template(source_bytes[private['template']].decode())
        try:
            flower = yaml.safe_load(source_bytes[paths['flower']])
        except Exception:
            raise ValueError('ordinary source cache is not valid YAML') from None
        source.require(isinstance(flower, dict), 'ordinary source cache must be a mapping')
        ip, updated, fetched = source.resolve_profile(state, source_bytes[paths['ipequal']], source.fetch_https)
        ledger_before = ledger_path.read_bytes() if ledger_path.exists() else None
        ledger = {'url_sha256': state['url_sha256'], 'stable_identity': state['stable_identity'], 'pins': []}
        if ledger_before is not None:
            source.require(ledger_path.is_file() and ledger_path.stat().st_mode & 0o077 == 0,
                           'authenticated pin ledger must be private')
            try:
                ledger = json.loads(ledger_before)
            except (ValueError, UnicodeError):
                raise ValueError('authenticated pin ledger is not valid JSON') from None
            source.require(isinstance(ledger, dict) and ledger.get('url_sha256') == state['url_sha256']
                           and ledger.get('stable_identity') == state['stable_identity'],
                           'authenticated pin ledger binding changed')
        source.require(isinstance(ledger.get('pins'), list)
                       and all(isinstance(pin, dict) and set(pin) == {'name', 'digest'}
                               and isinstance(pin['name'], str) and pin['name']
                               and isinstance(pin['digest'], str) and re.fullmatch(r'[a-f0-9]{64}', pin['digest'])
                               for pin in ledger['pins']), 'invalid authenticated pin ledger')
        _, current_pins = route.compile_script(template, ip)
        _, previous_pins = route.compile_script(template, {'proxies': state.get('published_nodes') or ip['proxies']})
        pins = {(pin['name'], pin['digest']): pin for pin in ledger['pins'] + previous_pins + current_pins}
        ledger['pins'] = sorted(pins.values(), key=lambda pin: (pin['name'], pin['digest']))
        script = template.replace(PIN_MARKER, json.dumps(ledger['pins'], ensure_ascii=False))
        out = route.apply_overlay(script, route.merge_profiles(flower, ip))
        expected = {'IPEqual::' + node['name'] for node in ip['proxies']}
        actual = set(next(group for group in out['proxy-groups'] if group['name'] == route.AI_GROUP)['proxies'])
        source.require(actual == expected, 'trusted publication did not retain every authenticated node')
        counts = {'flower': len(flower['proxies']), 'ipequal': len(ip['proxies']),
                  'groups': len(out['proxy-groups']), 'rules': len(out['rules'])}
        validate(out, counts)
        source.require(route.apply_overlay(script, out) == out, 'trusted publication overlay is not idempotent')
        source.require(all(path.read_bytes() == data for path, data in source_bytes.items())
                       and state_path.read_bytes() == state_before,
                       'source or state changed during generation; retry with stable inputs')
        updated['published_nodes'] = copy.deepcopy(ip['proxies'])
        text = yaml.safe_dump(out, allow_unicode=True, sort_keys=False, width=4096)
        # Authenticated exposed generations stay accepted while data is replaced.
        payloads = [(private['pinned_script'], script), (private['deployed_script'], script),
                    (private['unified_cache'], text), (paths['output'], text),
                    (state_path, json.dumps(updated, ensure_ascii=False, indent=2) + '\n')]
        source.require((ledger_path.read_bytes() if ledger_path.exists() else None) == ledger_before,
                       'authenticated pin ledger changed during generation')
        # Durable authorization precedes every externally observable candidate.
        # Retain the ledger and exposed scripts even if later data publication fails.
        route.private_write(ledger_path, json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')
        backup = source.atomic_publish(payloads, paths['backup_dir'], route.private_write,
                                       sticky_paths=(private['pinned_script'], private['deployed_script']))
        return counts, text, fetched, backup
