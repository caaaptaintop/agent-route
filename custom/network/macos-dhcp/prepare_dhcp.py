#!/usr/bin/env python3
"""Prepare a DHCP-only PF candidate offline; never deploy or run system commands.

Inputs and outputs are explicitly selected outside this repository. A narrowly
recognized legacy block is replaced byte-for-byte; all other bytes are kept.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import sys

REPO_ROOT = Path(__file__).resolve().parents[3]
MAX_BYTES = 2 * 1024 * 1024
ROAMING_BLOCK = b'''# DHCPv4 roaming: privileged root client socket, no fixed gateway/interface.
# This is not a configd/PID allow-list and does not create PF state.
# Replies may target an address not assigned yet (unicast OFFER/ACK).
pass out quick inet proto udp from any port 68 to any port 67 user 0 no state label "dhcp_roaming_out"
pass in quick inet proto udp from any port 67 to any port 68 no state label "dhcp_roaming_in"
'''
OUT_PATTERN = re.compile(
    r'pass out quick on (?P<interface>[A-Za-z][A-Za-z0-9_]{0,14}) '
    r'inet proto udp from \{ 0\.0\.0\.0 \((?P=interface)\) \} '
    r'port 68 to \{ 255\.255\.255\.255 (?P<server>[0-9.]+) \} '
    r'port 67 no state'
)

def require(condition, message):
    if not condition:
        raise ValueError(message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def validate_legacy(block):
    require(isinstance(block, bytes) and 0 < len(block) <= MAX_BYTES,
            'Legacy block must be nonempty bounded bytes')
    require(block.endswith(b'\n') and b'\r' not in block and b'\x00' not in block,
            'Legacy block must use complete LF lines without NUL')
    try:
        text = block.decode('utf-8')
    except UnicodeDecodeError:
        raise ValueError('Legacy block must be UTF-8') from None
    rules = [line for line in text.splitlines()
             if line.strip() and not line.lstrip().startswith('#')]
    require(len(rules) == 2, 'Only the supported two-rule DHCP block is accepted')
    match = OUT_PATTERN.fullmatch(rules[0])
    require(match is not None, 'Unsupported outgoing DHCP rule shape')
    try:
        server = ipaddress.IPv4Address(match['server'])
    except ipaddress.AddressValueError:
        raise ValueError('Legacy server must be an IPv4 address') from None
    require(not server.is_multicast and not server.is_unspecified
            and int(server) != 0xffffffff, 'Legacy server must be unicast IPv4')
    expected = ('pass in quick on ' + match['interface']
                + ' inet proto udp from ' + str(server)
                + ' port 67 to any port 68 no state')
    require(rules[1] == expected, 'Unsupported or inconsistent incoming DHCP rule')

def build_candidate(source, legacy, expected_sha256):
    require(isinstance(source, bytes) and 0 < len(source) <= MAX_BYTES,
            'Source must be nonempty bounded bytes')
    require(isinstance(expected_sha256, str)
            and re.fullmatch(r'[0-9a-f]{64}', expected_sha256) is not None,
            'An explicit lowercase source SHA-256 is required')
    require(digest(source) == expected_sha256, 'Source digest does not match')
    require(b'\x00' not in source, 'Source contains NUL')
    validate_legacy(legacy)
    require(source.count(legacy) == 1, 'Legacy block must match exactly once')
    require(b'dhcp_roaming_out' not in source and b'dhcp_roaming_in' not in source,
            'Roaming labels already exist; review rather than append')
    index = source.index(legacy)
    require(index == 0 or source[index - 1:index] == b'\n',
            'Legacy block must begin at a line boundary')
    prefix, suffix = source[:index], source[index + len(legacy):]
    candidate = prefix + ROAMING_BLOCK + suffix
    report = {
        'schema_version': 1,
        'status': 'candidate-only',
        'source_sha256': digest(source),
        'candidate_sha256': digest(candidate),
        'legacy_block_sha256': digest(legacy),
        'validation': {
            'supported_legacy_shape': True,
            'outside_block_bytes_preserved': True,
            'root_socket_outgoing_only': True,
            'native_pf_syntax_checked': False,
            'deployed': False,
            'real_network_verified': False,
        },
    }
    return candidate, report

def external_path(value):
    path = Path(value)
    require(path.is_absolute(), 'Paths must be absolute and outside the repository')
    lexical = Path(os.path.abspath(path))
    resolved = path.resolve(strict=False)
    root = REPO_ROOT.resolve()
    for item in [lexical, resolved]:
        require(item != root and root not in item.parents,
                'Repository input/output is forbidden')
    return path, resolved

def read_external(value):
    path, _ = external_path(value)
    require(not path.is_symlink(), 'Symlink input is forbidden')
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_BYTES,
                'Input must be a bounded regular file')
        chunks = bytearray()
        while len(chunks) <= MAX_BYTES:
            chunk = os.read(fd, min(65536, MAX_BYTES + 1 - len(chunks)))
            if not chunk:
                break
            chunks.extend(chunk)
        content = bytes(chunks)
        after = os.fstat(fd)
    finally:
        os.close(fd)
    require(len(content) <= MAX_BYTES
            and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
            'Input changed while reading')
    # The digest supplied by the caller is the source-content trust decision.
    return content

def write_new_file(directory_fd, name, content):
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=directory_fd)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        try:
            os.unlink(name, dir_fd=directory_fd)
        except OSError:
            pass
        raise

def prepare_bundle(source_path, legacy_path, output_dir, expected_sha256):
    source = read_external(source_path)
    legacy = read_external(legacy_path)
    candidate, report = build_candidate(source, legacy, expected_sha256)
    original, output = external_path(output_dir)
    require(not original.is_symlink(), 'Symlink output is forbidden')
    require(not output.exists(), 'Output directory must not already exist')
    require(output.name not in ['', '.', '..'], 'Invalid output directory')
    require(output.parent.is_dir(), 'Output parent must already exist')
    parent_fd = os.open(output.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    directory_fd = None
    created = []
    made_directory = False
    try:
        os.mkdir(output.name, mode=0o700, dir_fd=parent_fd)
        made_directory = True
        directory_fd = os.open(output.name, os.O_RDONLY | os.O_DIRECTORY
                               | os.O_NOFOLLOW, dir_fd=parent_fd)
        os.fchmod(directory_fd, 0o700)
        for name, content in [('candidate.pf', candidate),
                              ('review.json', (json.dumps(report, indent=2) + '\n').encode())]:
            write_new_file(directory_fd, name, content)
            created.append(name)
        os.fsync(directory_fd)
        os.fsync(parent_fd)
    except BaseException:
        if directory_fd is not None:
            for name in created:
                try:
                    os.unlink(name, dir_fd=directory_fd)
                except OSError:
                    pass
        if made_directory:
            try:
                os.rmdir(output.name, dir_fd=parent_fd)
            except OSError:
                pass  # Never remove files introduced by another actor.
        raise
    finally:
        if directory_fd is not None:
            os.close(directory_fd)
        os.close(parent_fd)
    return report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--legacy-block', required=True, type=Path)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    try:
        report = prepare_bundle(args.source, args.legacy_block,
                                args.output_dir, args.source_sha256)
    except (ValueError, OSError):
        # Do not echo source contents, local server addresses or file paths.
        print('Refused: check paths, explicit source digest, legacy shape and new output directory.',
              file=sys.stderr)
        return 1
    print(json.dumps({'status': report['status'],
                      'native_pf_syntax_checked': False, 'deployed': False}))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
