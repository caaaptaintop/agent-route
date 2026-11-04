# SPDX-License-Identifier: GPL-3.0-only
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import yaml
import trusted_source as t


def profile(server='8.8.8.8'):
    return {'proxies': [{'name': 'line', 'type': 'trojan', 'server': server, 'port': 443, 'password': 'synthetic-only', 'sni': 'example.com', 'skip-cert-verify': False}], 'proxy-groups': [{'name': 'IpEqual', 'type': 'select', 'proxies': ['line']}]}


class TrustedSourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.meta = self.root / 'profiles.yaml'
        self.url = 'https://example.com/subscription/synthetic'
        self.meta.write_text(yaml.safe_dump({'items': [{'uid': 'source', 'url': self.url}]}))
        self.state = {'profiles_file': str(self.meta), 'source_uid': 'source', 'url_sha256': t.digest(self.url.encode()), 'stable_identity': t.stable_identity(profile()), 'policy_base': profile(), 'verified_profile': profile(), 'cache_sha256': None}

    def tearDown(self):
        self.tmp.cleanup()

    def cache(self, value):
        return yaml.safe_dump(value).encode()

    def test_verified_authority_can_rotate_server(self):
        fresh = profile('1.1.1.1')
        result, state, fetched = t.resolve_profile(self.state, self.cache(profile('9.9.9.9')), lambda url: fresh)
        self.assertEqual(result, fresh)
        self.assertTrue(fetched)
        self.assertEqual(state['verified_profile'], fresh)
        self.assertIsNone(self.state['cache_sha256'])

    def test_cache_server_is_never_published_as_authority(self):
        supplied = profile('9.9.9.9')
        authentic = profile('1.1.1.1')
        result, _, _ = t.resolve_profile(self.state, self.cache(supplied), lambda _: authentic)
        self.assertEqual(result, authentic)
        self.assertNotEqual(result, supplied)

    def test_unchanged_cache_reuses_verified_source_for_flower_updates(self):
        cache = self.cache(profile())
        self.state['cache_sha256'] = t.digest(cache)
        result, _, fetched = t.resolve_profile(self.state, cache, lambda _: self.fail('must not fetch again'))
        self.assertEqual(result, profile())
        self.assertFalse(fetched)

    def test_changed_source_url_refused_even_for_cached_input(self):
        self.meta.write_text(yaml.safe_dump({'items': [{'uid': 'source', 'url': 'https://other.example.com/new'}]}))
        with self.assertRaisesRegex(ValueError, 'URL changed'):
            t.resolve_profile(self.state, self.cache(profile()))

    def test_cache_auth_protocol_and_tls_changes_refused(self):
        for key, value in [('password', 'changed'), ('port', 8443), ('skip-cert-verify', True), ('sni', 'other.example.com'), ('type', 'http'), ('dialer-proxy', 'DIRECT')]:
            with self.subTest(key=key):
                other = profile()
                other['proxies'][0][key] = value
                with self.assertRaises(ValueError):
                    t.resolve_profile(self.state, self.cache(other), lambda _: self.fail('cache must be refused before fetch'))

    def test_https_auth_change_is_also_refused(self):
        other = profile()
        other['proxies'][0]['password'] = 'changed'
        with self.assertRaisesRegex(ValueError, 'HTTPS source credentials'):
            t.resolve_profile(self.state, self.cache(profile()), lambda _: other)

    def test_empty_duplicate_and_nonpublic_endpoints_refused(self):
        for other in [{'proxies': []}, {'proxies': profile()['proxies'] * 2}, profile('127.0.0.1'), profile('10.0.0.1'), profile('localhost'), profile('foo.invalid')]:
            with self.subTest(value=other):
                with self.assertRaises(ValueError):
                    t.stable_identity(other)

    def test_https_only_no_credentials_or_fragment(self):
        for url in ['http://example.com/sub', 'https://user:pass@example.com/sub', 'https://example.com/sub#fragment']:
            self.meta.write_text(yaml.safe_dump({'items': [{'uid': 'source', 'url': url}]}))
            self.state['url_sha256'] = t.digest(url.encode())
            with self.assertRaises(ValueError):
                t.source_url(self.state)

    def test_fetch_failure_does_not_mutate_state(self):
        before = copy.deepcopy(self.state)
        def failed(_):
            raise ValueError('source unavailable')
        with self.assertRaises(ValueError):
            t.resolve_profile(self.state, self.cache(profile('9.9.9.9')), failed)
        self.assertEqual(self.state, before)

    def writer(self, path, text):
        path.write_text(text)

    def test_publication_success_and_no_old_secret_in_public_report(self):
        a, b = self.root / 'script', self.root / 'output'
        a.write_text('old script'); b.write_text('old output')
        backup = t.atomic_publish([(a, 'new script'), (b, 'new output')], self.root / 'backups', self.writer)
        self.assertEqual(a.read_text(), 'new script')
        self.assertEqual(b.read_text(), 'new output')
        self.assertTrue((backup / '0.before').is_file())

    def test_failed_publication_restores_written_files(self):
        a, b = self.root / 'script', self.root / 'output'
        a.write_text('old script'); b.write_text('old output')
        def writer(path, text):
            if path == b and text == 'new output':
                raise OSError('simulated write failure')
            path.write_text(text)
        with self.assertRaises(OSError):
            t.atomic_publish([(a, 'new script'), (b, 'new output')], self.root / 'backups', writer)
        self.assertEqual(a.read_text(), 'old script')
        self.assertEqual(b.read_text(), 'old output')

    def test_writer_raises_after_replace_is_also_rolled_back(self):
        a, b = self.root / 'script', self.root / 'output'
        a.write_text('old script'); b.write_text('old output')
        def writer(path, text):
            path.write_text(text)
            if path == b and text == 'new output':
                raise OSError('failure after replacement')
        with self.assertRaises(OSError):
            t.atomic_publish([(a, 'new script'), (b, 'new output')], self.root / 'backups', writer)
        self.assertEqual(a.read_text(), 'old script')
        self.assertEqual(b.read_text(), 'old output')

    def test_one_rollback_failure_does_not_stop_other_restores(self):
        a, b, c = [self.root / name for name in ['first', 'second', 'third']]
        for path in [a, b, c]:
            path.write_text('old')
        def writer(path, text):
            if path == c and text == 'new':
                raise OSError('publication failed')
            if path == b and text == 'old':
                raise OSError('rollback failed')
            path.write_text(text)
        with self.assertRaisesRegex(Exception, 'rollback incomplete'):
            t.atomic_publish([(a, 'new'), (b, 'new'), (c, 'new')], self.root / 'backups', writer)
        self.assertEqual(a.read_text(), 'old', 'earlier replacement still needs compensation')
        self.assertEqual(b.read_text(), 'new')
        self.assertEqual(c.read_text(), 'old')

    def test_independent_edit_is_not_overwritten_during_rollback(self):
        a, b = self.root / 'first', self.root / 'second'
        a.write_text('old'); b.write_text('old')
        def writer(path, text):
            if path == b and text == 'new':
                a.write_text('independent edit')
                raise OSError('publication failed')
            path.write_text(text)
        with self.assertRaises(Exception):
            t.atomic_publish([(a, 'new'), (b, 'new')], self.root / 'backups', writer)
        self.assertEqual(a.read_text(), 'independent edit')
        self.assertEqual(b.read_text(), 'old')

    def test_publication_and_backup_paths_reject_repository(self):
        fake_repo = self.root / 'repository'
        fake_repo.mkdir()
        with patch.object(t, 'REPO_ROOT', fake_repo):
            for payloads, backup in [([(fake_repo / 'output', 'private')], self.root / 'backups'),
                                     ([(self.root / 'output', 'private')], fake_repo / 'backups')]:
                with self.assertRaises(ValueError):
                    t.atomic_publish(payloads, backup, self.writer)
        self.assertFalse((fake_repo / 'output').exists())
        self.assertFalse((fake_repo / 'backups').exists())

    def test_https_curl_contract_and_secret_not_in_argv(self):
        import subprocess
        url = 'https://example.com/subscription?token=synthetic-only'
        def run(args, **kwargs):
            self.assertEqual(args[:2], ['/usr/bin/curl', '--disable'])
            self.assertNotIn(url, args)
            self.assertEqual(json.loads(kwargs['input'].split(' = ', 1)[1]), url)
            for forbidden in ['--location', '-L', '--insecure', '-k']:
                self.assertNotIn(forbidden, args)
            self.assertEqual(args[args.index('--proto') + 1], '=https')
            Path(args[args.index('--output') + 1]).write_text(yaml.safe_dump(profile()))
            return subprocess.CompletedProcess(args, 0, '200 0', 'not emitted')
        with patch.object(t.subprocess, 'run', side_effect=run):
            self.assertEqual(t.fetch_https(url), profile())

    def test_private_https_temporary_output_cannot_be_inside_repository(self):
        import contextlib
        fake_repo = self.root / 'repository'
        fake_repo.mkdir()
        with patch.object(t, 'REPO_ROOT', fake_repo), \
                patch.object(t.tempfile, 'TemporaryDirectory', return_value=contextlib.nullcontext(str(fake_repo))), \
                patch.object(t.subprocess, 'run', side_effect=AssertionError('must reject before network')):
            with self.assertRaises(ValueError):
                t.fetch_https('https://example.com/synthetic')
        self.assertFalse((fake_repo / 'source.yaml').exists())

    def test_https_redirect_certificate_and_curl_failures_refused(self):
        import subprocess
        for code, report in [(0, '302 0'), (0, '200 60'), (22, '403 0')]:
            with self.subTest(code=code, report=report):
                with patch.object(t.subprocess, 'run', return_value=subprocess.CompletedProcess([], code, report, 'private token')):
                    with self.assertRaisesRegex(ValueError, 'HTTPS verification') as caught:
                        t.fetch_https('https://example.com/synthetic')
                    self.assertNotIn('private token', str(caught.exception))

    def test_remote_runtime_policy_is_never_adopted(self):
        self.state['policy_base'].update(tun={'enable': True}, mode='rule', port=7890)
        remote = profile('1.1.1.1')
        remote.update(tun={'enable': False}, mode='global', port=0,
                      hosts={'example.com': '127.0.0.1'}, **{'external-controller': '0.0.0.0:9999'})
        remote['proxy-groups'] = [{'name': 'untrusted', 'type': 'select', 'proxies': ['DIRECT']}]
        result, _, _ = t.resolve_profile(self.state, self.cache(profile()), lambda _: remote)
        expected = copy.deepcopy(self.state['policy_base'])
        expected['proxies'][0]['server'] = '1.1.1.1'
        self.assertEqual(result, expected)
        self.assertNotIn('external-controller', result)
        self.assertNotIn('hosts', result)

    def test_sticky_authenticated_scripts_are_not_revoked_on_failure(self):
        a, b = self.root / 'script', self.root / 'output'
        a.write_text('old script'); b.write_text('old output')
        def writer(path, text):
            if path == b:
                raise OSError('simulated failure')
            path.write_text(text)
        with self.assertRaises(OSError):
            t.atomic_publish([(a, 'authenticated extended script'), (b, 'new output')],
                             self.root / 'backups', writer, sticky_paths=(a,))
        self.assertEqual(a.read_text(), 'authenticated extended script')
        self.assertEqual(b.read_text(), 'old output')

    def test_node_name_and_set_changes_require_review(self):
        renamed = profile(); renamed['proxies'][0]['name'] = 'other'
        expanded = profile(); expanded['proxies'].append(dict(expanded['proxies'][0], name='second'))
        for changed in [renamed, expanded]:
            with self.assertRaises(ValueError):
                t.resolve_profile(self.state, self.cache(changed), lambda _: self.fail('must reject before HTTPS'))

    def test_exposed_candidate_pins_survive_data_rollback(self):
        script, data, state = (self.root / name for name in ['script', 'data', 'state'])
        script.write_text('A'); data.write_text('A'); state.write_text('A')
        reader = []
        def writer(path, text):
            if path == state and text == 'B':
                reader.append(data.read_text())
                raise OSError('failure after candidate was fetched')
            path.write_text(text)
        with self.assertRaises(OSError):
            t.atomic_publish([(script, 'AB'), (data, 'B'), (state, 'B')],
                             self.root / 'backups', writer, sticky_paths=(script,))
        self.assertEqual(reader, ['B'])
        self.assertEqual(data.read_text(), 'A')
        self.assertEqual(script.read_text(), 'AB')

    def test_publication_symlink_refused(self):
        target = self.root / 'target'; target.write_text('old')
        link = self.root / 'link'; link.symlink_to(target)
        with self.assertRaises(ValueError):
            t.atomic_publish([(link, 'new')], self.root / 'backups', self.writer)
        self.assertEqual(target.read_text(), 'old')


if __name__ == '__main__':
    unittest.main()
