# SPDX-License-Identifier: GPL-3.0-only
"""Synthetic orchestration tests: no actual subscription, curl, Node or client."""
import copy
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import yaml
import trusted_source as t
import adapter as a


def profile(server='8.8.8.8', name='line', group='IpEqual'):
    return {'proxies': [{'name': name, 'type': 'trojan', 'server': server, 'port': 443,
                         'password': 'synthetic-only', 'sni': 'example.com'}],
            'proxy-groups': [{'name': group, 'type': 'select', 'proxies': [name]}]}


PREPARED = ('var AR_PINNED_NODES = [];\n'
            'var AR_AI_PROCESS_PATHS = ["^/__test_home__/dedicated/"];\n'
            'var AR_BROWSER_UDP_PATHS = [];\n')


class SyntheticRoute:
    """Test double for the documented route API, not a full merge implementation."""
    AI_GROUP = 'AI-Claude-Codex-IPEqual'

    def __init__(self):
        self.compiled = []
        self.writes = []

    def compile_script(self, template, source):
        self.compiled.append(copy.deepcopy(source['proxies']))
        pins = [{'name': n['name'], 'digest': t.digest(json.dumps(n, sort_keys=True).encode())}
                for n in source['proxies']]
        return template.replace('/* PINNED_NODES */ []', json.dumps(pins)), pins

    def merge_profiles(self, flower, ip):
        nodes = []
        for prefix, source in [('Flower::', flower), ('IPEqual::', ip)]:
            for node in source['proxies']:
                nodes.append(dict(node, name=prefix + node['name']))
        return {'proxies': nodes, 'proxy-groups': [{'name': self.AI_GROUP, 'type': 'select',
                'proxies': ['IPEqual::' + n['name'] for n in ip['proxies']]}],
                'rules': ['MATCH,主代理'], 'dns': {'synthetic': True}}

    def apply_overlay(self, script, config):
        return copy.deepcopy(config)

    def private_write(self, path, text):
        self.writes.append(path)
        fd, temporary = tempfile.mkstemp(dir=path.parent)
        try:
            with os.fdopen(fd, 'w') as handle:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            path.chmod(0o600)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.template = self.root / 'template.js'
        self.template.write_text(a.restore_empty_pin_marker(PREPARED))
        self.meta = self.root / 'profiles.yaml'
        url = 'https://example.com/subscription/synthetic'
        self.meta.write_text(yaml.safe_dump({'items': [{'uid': 'synthetic-source', 'url': url}]}))
        self.state_path = self.root / 'trust.json'
        self.flower = self.root / 'flower.yaml'
        self.ip = self.root / 'ip.yaml'
        self.flower.write_text(yaml.safe_dump(profile('9.9.9.9', 'ordinary', 'Proxies')))
        self.ip.write_text(yaml.safe_dump(profile()))
        self.state = {'version': 2, 'policy_base': profile(), 'profiles_file': str(self.meta), 'source_uid': 'synthetic-source',
                      'url_sha256': t.digest(url.encode()), 'stable_identity': t.stable_identity(profile()),
                      'source_cache': str(self.ip), 'template': str(self.template),
                      'pinned_script': str(self.root / 'pinned.js'),
                      'deployed_script': str(self.root / 'deployed.js'),
                      'unified_cache': str(self.root / 'unified.yaml'),
                      'verified_profile': profile(), 'cache_sha256': t.digest(self.ip.read_bytes()),
                      'published_nodes': profile()['proxies']}
        self.save_state()
        self.args = SimpleNamespace(trust_state=self.state_path, flower=self.flower, ipequal=self.ip,
                                    output=self.root / 'served.yaml', backup_dir=self.root / 'backups')
        self.route = SyntheticRoute()

    def tearDown(self):
        self.tmp.cleanup()

    def save_state(self):
        self.state_path.write_text(json.dumps(self.state))
        self.state_path.chmod(0o600)

    def validate(self, out, counts):
        self.assertEqual(counts['ipequal'], 1)
        self.assertEqual(out['rules'], ['MATCH,主代理'])

    def build(self):
        return a.build_trusted(self.args, self.route, self.validate)

    def test_complete_publication_uses_explicit_prepared_template(self):
        with patch.object(t, 'fetch_https', side_effect=AssertionError('unchanged source must not fetch')):
            counts, text, fetched, backup = self.build()
        self.assertFalse(fetched)
        self.assertEqual(counts['flower'], 1)
        self.assertEqual(self.args.output.read_text(), text)
        self.assertEqual([p.name for p in self.route.writes],
                         ['trust.json.accepted-pins.json', 'pinned.js', 'deployed.js', 'unified.yaml', 'served.yaml', 'trust.json'])
        self.assertTrue(backup.is_dir())
        self.assertIn('^/__test_home__/dedicated/', (self.root / 'pinned.js').read_text())
        self.assertEqual(self.state_path.stat().st_mode & 0o777, 0o600)

    def test_server_rotation_retains_one_previous_full_identity(self):
        self.ip.write_text(yaml.safe_dump(profile('4.2.2.2')))
        fresh = profile('1.1.1.1')
        with patch.object(t, 'fetch_https', return_value=fresh) as fetch:
            _, text, fetched, _ = self.build()
        self.assertTrue(fetched)
        fetch.assert_called_once_with('https://example.com/subscription/synthetic')
        self.assertEqual({n['server'] for batch in self.route.compiled for n in batch}, {'8.8.8.8', '1.1.1.1'})
        self.assertNotIn('4.2.2.2', text, 'cache-supplied endpoint must never be published')
        state = json.loads(self.state_path.read_text())
        self.assertEqual(state['published_nodes'], fresh['proxies'])
        self.assertEqual(state['verified_profile'], fresh)

    def test_failed_exposed_generation_survives_next_successful_rotation(self):
        self.build()
        self.ip.write_text(yaml.safe_dump(profile('4.2.2.2')))
        original_writer = self.route.private_write
        def fail_output(path, text):
            if path == self.args.output and '1.1.1.1' in text:
                raise OSError('simulated served output failure')
            original_writer(path, text)
        self.route.private_write = fail_output
        with patch.object(t, 'fetch_https', return_value=profile('1.1.1.1')):
            with self.assertRaises(OSError):
                self.build()
        ledger_path = Path(str(self.state_path) + '.accepted-pins.json')
        ledger_after_failure = json.loads(ledger_path.read_text())
        self.assertEqual(len(ledger_after_failure['pins']), 2)
        self.assertIn(ledger_after_failure['pins'][0]['digest'], (self.root / 'deployed.js').read_text())
        self.assertIn('8.8.8.8', self.args.output.read_text(), 'data output rolls back while script authorization stays')
        self.route.private_write = original_writer
        self.ip.write_text(yaml.safe_dump(profile('4.2.2.3')))
        with patch.object(t, 'fetch_https', return_value=profile('9.9.9.9')):
            self.build()
        ledger = json.loads(ledger_path.read_text())
        self.assertEqual(len(ledger['pins']), 3, 'do not prune an authenticated in-flight generation')
        for pin in ledger['pins']:
            self.assertIn(pin['digest'], (self.root / 'deployed.js').read_text())
        self.assertIn('9.9.9.9', self.args.output.read_text())

    def test_ledger_binding_and_permissions_are_checked(self):
        ledger_path = Path(str(self.state_path) + '.accepted-pins.json')
        ledger_path.write_text(json.dumps({'url_sha256': 'changed', 'stable_identity': self.state['stable_identity'], 'pins': []}))
        ledger_path.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'ledger binding'):
            self.build()
        ledger_path.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'ledger must be private'):
            self.build()
        self.assertEqual(self.route.writes, [])

    def test_version_one_state_requires_explicit_new_policy_enrollment(self):
        self.state['version'] = 1
        self.save_state()
        with self.assertRaisesRegex(ValueError, 'version-2'):
            self.build()
        self.assertEqual(self.route.writes, [])

    def test_source_cache_binding_mismatch_refused(self):
        self.state['source_cache'] = str(self.root / 'other.yaml')
        self.save_state()
        with self.assertRaisesRegex(ValueError, 'binding'):
            self.build()
        self.assertEqual(self.route.writes, [])

    def test_raw_or_unprepared_template_refused(self):
        for text in [PREPARED, PREPARED.replace('["^/__test_home__/dedicated/"]', '[]'),
                     PREPARED.replace('["^/__test_home__/dedicated/"]', '/* AI_PROCESS_PATHS */ []'),
                     PREPARED.replace('var AR_BROWSER_UDP_PATHS = [];', 'var AR_BROWSER_UDP_PATHS = ["browser"];')]:
            with self.subTest(text=text):
                self.template.write_text(text)
                with self.assertRaises(ValueError):
                    self.build()
        self.assertEqual(self.route.writes, [])

    def test_restore_marker_never_erases_existing_pins(self):
        with self.assertRaises(ValueError):
            a.restore_empty_pin_marker(PREPARED.replace('AR_PINNED_NODES = []', 'AR_PINNED_NODES = [{"name":"x"}]'))
        self.assertIn('/* PINNED_NODES */ []', a.restore_empty_pin_marker(PREPARED))

    def test_private_state_requires_restricted_mode(self):
        self.state_path.chmod(0o644)
        with self.assertRaisesRegex(ValueError, '0600'):
            self.build()

    def test_input_target_overlap_and_output_alias_refused(self):
        for key, value in [('pinned_script', str(self.flower)), ('deployed_script', self.state['pinned_script']),
                           ('unified_cache', str(self.template))]:
            with self.subTest(key=key):
                before = copy.deepcopy(self.state)
                self.state[key] = value
                self.save_state()
                with self.assertRaisesRegex(ValueError, 'overlap'):
                    self.build()
                self.state = before
        self.assertEqual(self.route.writes, [])

    def test_validator_failure_does_not_publish(self):
        before = self.state_path.read_bytes()
        def invalid(out, counts):
            raise ValueError('synthetic validation failure')
        with self.assertRaises(ValueError):
            a.build_trusted(self.args, self.route, invalid)
        self.assertEqual(self.route.writes, [])
        self.assertEqual(self.state_path.read_bytes(), before)
        self.assertFalse(self.args.output.exists())

    def test_source_change_during_build_refused(self):
        def changed(out, counts):
            self.flower.write_text('changed independently')
        with self.assertRaisesRegex(ValueError, 'changed during'):
            a.build_trusted(self.args, self.route, changed)
        self.assertEqual(self.route.writes, [])

    def test_external_path_refuses_relative_repository_and_symlink_aliases(self):
        fake_repo = self.root / 'repository'
        fake_repo.mkdir()
        outside_alias = self.root / 'alias'
        outside_alias.symlink_to(fake_repo, target_is_directory=True)
        with patch.object(t, 'REPO_ROOT', fake_repo):
            for path in [Path('relative'), fake_repo / 'private.json', outside_alias / 'private.json']:
                with self.subTest(path=path):
                    with self.assertRaises(ValueError):
                        t.external_path(path)
            self.assertEqual(t.external_path(self.root / 'external.json'), self.root / 'external.json')

    def test_every_state_input_output_and_backup_path_rejects_repository(self):
        fake_repo = self.root / 'repository'
        fake_repo.mkdir()
        with patch.object(t, 'REPO_ROOT', fake_repo):
            for key in ['profiles_file', 'source_cache', 'template', 'pinned_script', 'deployed_script', 'unified_cache']:
                with self.subTest(key=key):
                    old = self.state[key]
                    self.state[key] = str(fake_repo / 'private')
                    self.save_state()
                    with self.assertRaises(ValueError):
                        self.build()
                    self.state[key] = old
            self.save_state()
            for key in ['trust_state', 'flower', 'ipequal', 'output', 'backup_dir']:
                with self.subTest(key=key):
                    old = getattr(self.args, key)
                    setattr(self.args, key, fake_repo / 'private')
                    with self.assertRaises(ValueError):
                        self.build()
                    setattr(self.args, key, old)
        self.assertEqual(self.route.writes, [])


if __name__ == '__main__':
    unittest.main()
