"""Synthetic tests only: documentation addresses, invented interfaces, no live PF."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('prepare_dhcp', HERE / 'prepare_dhcp.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

LEGACY = b'''# Synthetic legacy DHCP block; documentation-only address.
pass out quick on en77 inet proto udp from { 0.0.0.0 (en77) } port 68 to { 255.255.255.255 192.0.2.1 } port 67 no state
pass in quick on en77 inet proto udp from 192.0.2.1 port 67 to any port 68 no state
'''
PREFIX = b'''# Synthetic partial anchor, never load as a system ruleset.
pass quick on lo0 all no state
block drop out quick on en77 inet proto udp from any to 192.0.2.0/24 port 53
'''
SUFFIX = b'block drop quick all label "synthetic_default"\n'
SOURCE = PREFIX + LEGACY + SUFFIX
DIGEST = hashlib.sha256(SOURCE).hexdigest()

def convert(source=SOURCE, legacy=LEGACY, digest=DIGEST):
    return m.build_candidate(source, legacy, digest)

class RuleTests(unittest.TestCase):
    def test_preserves_every_byte_outside_legacy_block(self):
        candidate, report = convert()
        self.assertEqual(candidate, PREFIX + m.ROAMING_BLOCK + SUFFIX)
        self.assertEqual(report['validation']['outside_block_bytes_preserved'], True)
    def test_template_matches_generated_block(self):
        self.assertEqual((HERE/'dhcp-roaming.pf').read_bytes(), m.ROAMING_BLOCK)
    def test_root_socket_port_pair_and_no_state(self):
        lines=[x for x in m.ROAMING_BLOCK.decode().splitlines() if x.startswith('pass ')]
        self.assertEqual(len(lines),2)
        self.assertIn('from any port 68 to any port 67 user 0 no state',lines[0])
        self.assertIn('from any port 67 to any port 68 no state',lines[1])
        self.assertNotIn(' on ', '\n'.join(lines))
    def test_report_does_not_claim_native_or_live_validation(self):
        _,r=convert()
        self.assertFalse(r['validation']['native_pf_syntax_checked'])
        self.assertFalse(r['validation']['deployed'])
        self.assertFalse(r['validation']['real_network_verified'])
    def test_wrong_source_digest_refused(self):
        with self.assertRaises(ValueError):convert(digest='0'*64)
    def test_invalid_digest_refused(self):
        for value in ['', 'f'*63, 'X'*64, 'f'*65]:
            with self.subTest(value=value),self.assertRaises(ValueError):convert(digest=value)
    def test_missing_block_refused(self):
        source=PREFIX+SUFFIX
        with self.assertRaises(ValueError):convert(source=source,digest=hashlib.sha256(source).hexdigest())
    def test_duplicate_block_refused(self):
        source=SOURCE+LEGACY
        with self.assertRaises(ValueError):convert(source=source,digest=hashlib.sha256(source).hexdigest())
    def test_existing_roaming_label_refused(self):
        source=SOURCE+b'# dhcp_roaming_out already present\n'
        with self.assertRaises(ValueError):convert(source=source,digest=hashlib.sha256(source).hexdigest())
    def test_unrelated_rule_cannot_be_removed_as_legacy(self):
        legacy=LEGACY+b'block drop quick all\n';source=PREFIX+legacy+SUFFIX
        with self.assertRaises(ValueError):convert(source,legacy,hashlib.sha256(source).hexdigest())
    def test_tcp_or_broad_legacy_shape_refused(self):
        for legacy in [LEGACY.replace(b'proto udp',b'proto tcp'),LEGACY.replace(b'port 68',b'port any'),LEGACY.replace(b'no state',b'keep state')]:
            source=PREFIX+legacy+SUFFIX
            with self.subTest(legacy=legacy),self.assertRaises(ValueError):convert(source,legacy,hashlib.sha256(source).hexdigest())
    def test_inconsistent_interface_or_server_refused(self):
        for legacy in [LEGACY.replace(b'pass in quick on en77',b'pass in quick on en88'),LEGACY.replace(b'from 192.0.2.1 port',b'from 198.51.100.1 port')]:
            source=PREFIX+legacy+SUFFIX
            with self.subTest(legacy=legacy),self.assertRaises(ValueError):convert(source,legacy,hashlib.sha256(source).hexdigest())
    def test_comment_and_line_boundary_requirements(self):
        for legacy in [LEGACY.rstrip(b'\n'), b'# only comments\n', LEGACY+b'include "other.pf"\n']:
            source=PREFIX+legacy+SUFFIX
            with self.subTest(legacy=legacy),self.assertRaises(ValueError):convert(source,legacy,hashlib.sha256(source).hexdigest())
    def test_matching_block_must_start_at_a_line_boundary(self):
        source=PREFIX+b'not-a-line-boundary'+LEGACY+SUFFIX
        with self.assertRaises(ValueError):convert(source=source,digest=hashlib.sha256(source).hexdigest())
    def test_multiple_documentation_networks_are_not_hardcoded(self):
        for iface,server in [('en88','198.51.100.1'),('bridge77','203.0.113.1')]:
            legacy=LEGACY.replace(b'en77',iface.encode()).replace(b'192.0.2.1',server.encode())
            source=PREFIX+legacy+SUFFIX
            result,_=convert(source,legacy,hashlib.sha256(source).hexdigest())
            self.assertEqual(result,PREFIX+m.ROAMING_BLOCK+SUFFIX)
    def test_report_contains_only_local_hashes_not_input_contents(self):
        _,report=convert();text=json.dumps(report)
        self.assertNotIn('192.0.2.1',text);self.assertNotIn('en77',text)
        self.assertEqual(report['source_sha256'],DIGEST)
    def test_nul_or_crlf_legacy_refused(self):
        for legacy in [LEGACY.replace(b'\n',b'\r\n'),LEGACY+b'\x00\n']:
            source=PREFIX+legacy+SUFFIX
            with self.subTest(legacy=legacy),self.assertRaises(ValueError):convert(source,legacy,hashlib.sha256(source).hexdigest())

class FilesystemTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name).resolve()
        self.repo=self.base/'synthetic-repository';self.repo.mkdir()
        self.source=self.base/'source.pf';self.source.write_bytes(SOURCE)
        self.legacy=self.base/'legacy.pf';self.legacy.write_bytes(LEGACY)
        self.output=self.base/'new-bundle'
        self.repo_patch=patch.object(m,'REPO_ROOT',self.repo);self.repo_patch.start()
    def tearDown(self):self.repo_patch.stop();self.tmp.cleanup()
    def prepare(self,**kwargs):
        args={'source_path':self.source,'legacy_path':self.legacy,'output_dir':self.output,'expected_sha256':DIGEST}
        args.update(kwargs);return m.prepare_bundle(**args)
    def test_writes_new_private_bundle_only(self):
        result=self.prepare();self.assertEqual(result['status'],'candidate-only')
        self.assertEqual((self.output/'candidate.pf').read_bytes(),PREFIX+m.ROAMING_BLOCK+SUFFIX)
        self.assertEqual({x.name for x in self.output.iterdir()},{'candidate.pf','review.json'})
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode),0o700)
        for p in self.output.iterdir():self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600)
        self.assertEqual(self.source.read_bytes(),SOURCE)
    def test_existing_output_never_overwritten(self):
        self.output.mkdir();(self.output/'user-data').write_text('keep')
        with self.assertRaises((ValueError,FileExistsError)):self.prepare()
        self.assertEqual((self.output/'user-data').read_text(),'keep')
    def test_repository_input_and_output_refused(self):
        source=self.repo/'source.pf';source.write_bytes(SOURCE)
        legacy=self.repo/'legacy.pf';legacy.write_bytes(LEGACY)
        for args in [{'source_path':source},{'legacy_path':legacy},{'output_dir':self.repo/'output'}]:
            with self.subTest(args=args),self.assertRaises(ValueError):self.prepare(**args)
    def test_relative_paths_refused(self):
        with self.assertRaises(ValueError):self.prepare(source_path=Path('relative.pf'))
    def test_symlink_input_refused(self):
        linked=self.base/'linked.pf';linked.symlink_to(self.source)
        with self.assertRaises(ValueError):self.prepare(source_path=linked)
    def test_symlink_output_refused(self):
        self.output.symlink_to(self.repo,target_is_directory=True)
        with self.assertRaises((ValueError,FileExistsError)):self.prepare()
    def test_symlink_parent_cannot_point_into_repository(self):
        linked=self.base/'linked';linked.symlink_to(self.repo,target_is_directory=True)
        with self.assertRaises(ValueError):self.prepare(output_dir=linked/'output')
    def test_failure_before_creation_leaves_no_output(self):
        with self.assertRaises(ValueError):self.prepare(expected_sha256='0'*64)
        self.assertFalse(self.output.exists())
    def test_second_file_failure_cleans_only_own_outputs(self):
        original=m.write_new_file;count=[0]
        def fail_second(*args,**kwargs):
            count[0]+=1
            if count[0]==2:raise OSError('synthetic write failure')
            return original(*args,**kwargs)
        with patch.object(m,'write_new_file',side_effect=fail_second):
            with self.assertRaises(OSError):self.prepare()
        self.assertFalse(self.output.exists());self.assertEqual(self.source.read_bytes(),SOURCE)
    def test_directory_and_oversized_input_refused(self):
        with self.assertRaises(ValueError):self.prepare(source_path=self.base)
        self.source.write_bytes(b'x'*(m.MAX_BYTES+1))
        with self.assertRaises(ValueError):self.prepare()

if __name__=='__main__':unittest.main(verbosity=2)
