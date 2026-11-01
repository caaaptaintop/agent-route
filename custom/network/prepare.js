// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const policy = require('./route.template');
const templatePath = path.join(__dirname, 'route.template.js');
const repoRoot = path.resolve(__dirname, '../..');
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function validName(name) {
  return typeof name === 'string' && name.length > 0 && !/[\r\n,#]/.test(name)
    && !['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL', 'COMPATIBLE', policy.group, 'All-Subscriptions'].includes(name);
}
function escapeRegex(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function exactExecutableExpression(p) {
  requireThat(typeof p === 'string' && p.startsWith('/') && p !== '/' && p.length < 1500
    && !/[\x00-\x1f,]/.test(p) && !p.endsWith('/') && path.posix.normalize(p) === p,
    '额外应用必须提供规范化的绝对可执行文件路径，不接受正则或目录');
  const generic = ['node', 'bun', 'sh', 'bash', 'zsh', 'fish', 'python', 'python3', 'env', 'curl', 'wget', 'Google Chrome', 'Brave Browser', 'Tabbit', 'Safari'];
  requireThat(!generic.includes(path.posix.basename(p)), '不接受通用解释器、Shell、下载器或浏览器可执行文件');
  // Literal-only: neither top-level alternation nor unsupported RE2 syntax can escape the scope.
  return '^' + escapeRegex(p) + '$';
}
function scopes(home) {
  requireThat(typeof home === 'string' && home.startsWith('/') && home.length > 1 && !/[\x00-\x1f,]/.test(home), '需要有效的macOS绝对home路径');
  const h = escapeRegex(home.replace(/\/$/, ''));
  return {
    ai: [
      '^/Applications/Claude\\.app/Contents/',
      '^/Applications/ChatGPT\\.app/Contents/Resources/codex-cli/CodexCLI\\.app/Contents/',
      '^/Applications/ChatGPT\\.app/Contents/Frameworks/Codex Framework\\.framework/Versions/[^/]+/Helpers/Codex \\(Service\\)\\.app/Contents/',
      '^/Applications/Antigravity\\.app/Contents/',
      '^' + h + '/\\.local/(bin/claude|share/claude/versions/[0-9]+\\.[0-9]+\\.[0-9]+(-[^/]+)?)$',
      '^' + h + '/\\.claude/downloads/claude-[0-9]+\\.[0-9]+\\.[0-9]+(-[^/]+)?-darwin-(arm64|x64)$'
    ],
    browser: ['^/Applications/Google Chrome\\.app/Contents/', '^/Applications/Brave Browser\\.app/Contents/', '^/Applications/Tabbit\\.app/Contents/']
  };
}
function validatePins(pins) {
  requireThat(Array.isArray(pins), 'pins必须是数组；不要把原始订阅作为pins输入');
  const names = new Set();
  return pins.map(p => {
    requireThat(p && Object.keys(p).sort().join(',') === 'digest,name' && validName(p.name)
      && /^[a-f0-9]{64}$/.test(p.digest) && !names.has(p.name), 'pin字段、名称或摘要无效/重复');
    names.add(p.name);
    return {name: p.name, digest: p.digest};
  });
}
function fingerprint(nodes) {
  requireThat(Array.isArray(nodes) && nodes.length > 0, '需要已逐项核实的非空节点数组');
  const names = new Set();
  const types = ['vless', 'vmess', 'trojan', 'ss', 'ssr', 'socks5', 'http', 'hysteria', 'hysteria2', 'tuic', 'anytls', 'wireguard', 'snell', 'ssh'];
  return nodes.map(n => {
    requireThat(n && validName(n.name) && !names.has(n.name) && types.includes(n.type)
      && typeof n.server === 'string' && n.server.length > 0 && !/[\r\n,#]/.test(n.server)
      && Number.isInteger(n.port) && n.port > 0 && n.port <= 65535
      && !n['dialer-proxy'] && !n['interface-name'] && !n['routing-mark'], '节点必须名称唯一、传输独立、类型及地址端口有效');
    names.add(n.name);
    return {name: n.name, digest: policy.digest(n)};
  });
}
function render({settings, home, pins}) {
  requireThat(settings && typeof settings === 'object' && !Array.isArray(settings)
    && Object.keys(settings).every(k => ['platform', 'extraAiExecutables'].includes(k)), '设置字段不支持');
  requireThat(settings.platform === 'macos', '此适配层仅验证macOS；其他平台需另外适配');
  requireThat(Array.isArray(settings.extraAiExecutables), 'extraAiExecutables必须显式为数组');
  const p = validatePins(pins), s = scopes(home);
  s.ai.push(...settings.extraAiExecutables.map(exactExecutableExpression));
  let text = fs.readFileSync(templatePath, 'utf8');
  for (const [marker, value] of [['/* PINNED_NODES */ []', p], ['/* AI_PROCESS_PATHS */ []', [...new Set(s.ai)]], ['/* BROWSER_UDP_PATHS */ []', s.browser]]) {
    requireThat(text.split(marker).length === 2, '模板注入位置缺失或重复');
    text = text.replace(marker, () => JSON.stringify(value));
  }
  return text;
}
function externalPath(filename) {
  requireThat(typeof filename === 'string' && path.isAbsolute(filename), '输入输出必须是明确的绝对路径');
  // Resolve the real existing parent to reject symlinks pointing into the repository.
  const parent = fs.realpathSync(path.dirname(filename));
  const target = path.join(parent, path.basename(filename));
  const relative = path.relative(repoRoot, target);
  requireThat(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), '本地凭据/指纹/候选文件必须放在仓库外');
  return target;
}
function readLocalJson(filename) {
  const target = externalPath(filename);
  requireThat(!fs.lstatSync(target).isSymbolicLink(), '本地输入不接受符号链接');
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}
function writeNewFile(filename, text) {
  const target = externalPath(filename);
  const fd = fs.openSync(target, 'wx', 0o600);
  try { fs.writeFileSync(fd, text, 'utf8'); } finally { fs.closeSync(fd); }
}
function main(argv) {
  if (argv.length === 0 || argv.includes('--help')) {
    console.log('离线生成器，不安装、不重载、不访问网络或Keychain。\n'
      + '生成候选：node prepare.js --pins /外部/ai-pins.json --output /外部/overlay.js [--settings /外部/settings.json]\n'
      + '仅在核实新节点后建立信任：node prepare.js --trust-source /外部/verified-nodes.json --output /外部/ai-pins.json\n'
      + 'trust-source只接受JSON节点数组；不会自动刷新或覆盖既有指纹。所有输入输出须在仓库外。');
    return;
  }
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    requireThat(['--pins', '--output', '--settings', '--trust-source'].includes(k) && argv[i + 1] && !args[k], '参数缺失、重复或不支持');
    args[k] = argv[i + 1];
  }
  requireThat(args['--output'], '缺少--output');
  if (args['--trust-source']) {
    requireThat(!args['--pins'] && !args['--settings'], '建立信任与生成候选是两个独立步骤');
    const pins = fingerprint(readLocalJson(args['--trust-source']));
    writeNewFile(args['--output'], JSON.stringify(pins, null, 2) + '\n');
    console.log('已从明确选择的节点建立本地指纹；未验证节点可用性，未部署。');
  } else {
    requireThat(args['--pins'], '缺少--pins；无可信节点时不要凭名称放行');
    const settings = args['--settings'] ? readLocalJson(args['--settings']) : require('./settings.example.json');
    writeNewFile(args['--output'], render({settings, home: os.homedir(), pins: readLocalJson(args['--pins'])}));
    console.log('候选已生成，未安装或重载。应用前检查实际组名、IPv6策略、节点、DNS及离线恢复。');
  }
}
module.exports = {render, fingerprint, writeNewFile};
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) {
    // Do not echo parsed subscription values or credential-bearing source text.
    console.error(e instanceof SyntaxError ? 'JSON或正则格式无效；输入内容未输出。' : e.message);
    process.exitCode = 1;
  }
}
