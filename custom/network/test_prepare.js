'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {render, fingerprint, writeNewFile} = require('./prepare');
const settings = require('./settings.example.json');
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }
function inspect(text) {
  const s = {module: {exports: {}}};
  vm.runInNewContext(text, s, {timeout: 2000});
  return s.module.exports;
}
const home = '/__test_home__/name.with+[syntax]';
const node = {name: 'synthetic-ai', type: 'http', server: 'ai.invalid', port: 443, password: 'fixture-only'};
test('默认不携带真实节点或指纹；无可信节点时AI仅拒绝', () => {
  const m = inspect(render({settings, home, pins: []}));
  const c = m.apply({'proxies': [node], 'proxy-groups': [{name: '主代理', type: 'select', proxies: [node.name]}]}, []);
  assert.equal(c['proxy-groups'].find(g => g.name === m.group).proxies.join(','), 'REJECT');
});
test('home按正则字面量转义，Claude/Codex命中，不捕获泛应用与通用node', () => {
  const m = inspect(render({settings, home, pins: []}));
  const hit = p => m.paths.some(x => new RegExp(x).test(p));
  for (const p of ['/Applications/Claude.app/Contents/MacOS/Claude', home + '/.local/bin/claude', home + '/.local/share/claude/versions/2.1.0', '/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Versions/156/Helpers/Codex (Service).app/Contents/MacOS/Codex (Service)']) assert(hit(p));
  for (const p of ['/usr/bin/node', '/usr/bin/bun', '/Applications/Proma.app/Contents/MacOS/Proma', '/Applications/Codenotch.app/Contents/MacOS/Codenotch', home + '/.cache/magpie/bun/1.0/magpie-bun', home + '/.local/share/claude/versions/not-version', home + '/.local/bin/claude-evil', '/__test_home__/nameXwith+[syntax]/.local/bin/claude']) assert(!hit(p));
});
test('路径不包含真实使用者或上一个设备的信息', () => {
  const m = inspect(render({settings, home: '/__test_home__/other', pins: []}));
  assert(m.paths.every(p => !p.includes(home)));
  assert.equal(m.browserPaths.length, 0, '生成器不得重新添加三浏览器UDP范围');
});
test('指纹只含名称和摘要；凭据变化产生不同摘要', () => {
  const pins = fingerprint([node]);
  assert.deepEqual(Object.keys(pins[0]).sort(), ['digest', 'name']);
  assert.match(pins[0].digest, /^[a-f0-9]{64}$/);
  assert.notEqual(pins[0].digest, fingerprint([{...node, password: 'changed-fixture'}])[0].digest);
  assert(!JSON.stringify(pins).includes('fixture-only'));
});
test('拒绝重复、非独立或非网络节点，不能靠改名重新信任', () => {
  for (const nodes of [[], [node, node], [{...node, 'dialer-proxy': 'foreign'}], [{...node, type: 'direct'}], [{...node, name: 'REJECT'}]]) assert.throws(() => fingerprint(nodes));
  assert.equal(fingerprint([{...node, name: 'other'}])[0].digest, fingerprint([node])[0].digest);
});
test('缺少参数、未支持平台、无效pin及未知设置直接拒绝生成', () => {
  for (const args of [{settings, pins: []}, {settings, home: 'relative', pins: []}, {settings: {...settings, platform: 'windows'}, home, pins: []}, {settings: {...settings, unexpected: true}, home, pins: []}, {settings: {...settings, browserUdp: true}, home, pins: []}, {settings, home, pins: [{name: 'x', digest: 'bad'}]}]) assert.throws(() => render(args));
});
test('额外应用只接受精确路径，拒绝分支绕过、通用解释器和非规范路径', () => {
  for (const p of ['.*node', '^/intended/ai-only$|.*', '^/intended/(?=ai)ai$', '/', '/x,foreign', '/x\n', '/x/../node', '/usr/bin/node', '/usr/bin/bun', '/usr/bin/zsh', '/Applications/Safari.app/Contents/MacOS/Safari']) {
    assert.throws(() => render({settings: {...settings, extraAiExecutables: [p]}, home, pins: []}));
  }
  const literal = '/custom/AI (test)+[name]|with$chars';
  const m = inspect(render({settings: {...settings, extraAiExecutables: [literal]}, home, pins: []}));
  const added = new RegExp(m.paths[m.paths.length - 1]);
  assert(added.test(literal));
  for (const p of ['/usr/bin/node', '/usr/bin/bun', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', literal + '/other']) assert(!added.test(p));
});
test('只创建外部新文件0600，拒绝仓库内输出和覆盖原文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-prepare-test-'));
  try {
    const p = path.join(dir, 'candidate.js');
    writeNewFile(p, 'one');
    assert.equal(fs.readFileSync(p, 'utf8'), 'one');
    if (process.platform !== 'win32') assert.equal(fs.statSync(p).mode & 0o777, 0o600);
    assert.throws(() => writeNewFile(p, 'two'));
    assert.equal(fs.readFileSync(p, 'utf8'), 'one');
    assert.throws(() => writeNewFile(path.join(__dirname, 'must-not-exist.js'), 'bad'));
    assert(!fs.existsSync(path.join(__dirname, 'must-not-exist.js')));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
console.log('PASS prepare cases=' + count);
