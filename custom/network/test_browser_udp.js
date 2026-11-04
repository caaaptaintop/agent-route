// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const {render} = require('./prepare');
const settings = require('./settings.example.json');
const raw = require('./route.template');
assert.deepEqual(raw.browserPaths, [], '公开模板不得内置浏览器UDP进程范围');
for (const home of ['/__test_home__/first', '/__test_home__/second']) {
  const prepared = new Module(__filename + '.candidate');
  prepared._compile(render({settings, home, pins: []}), __filename + '.candidate');
  const {browserPaths, paths, domains, directDomains, apply, group} = prepared.exports;
  assert.deepEqual(browserPaths, [], '离线生成器不得重新添加已撤销的浏览器UDP范围');
  const input = {
    proxies: [{name: 'ordinary', type: 'socks5', server: 'node.invalid', port: 1080, udp: true}],
    'proxy-groups': [{name: '主代理', type: 'select', proxies: ['ordinary']}],
    // A stale source rule must not survive the complete rule rebuild.
    rules: ['AND,((NETWORK,UDP),(PROCESS-NAME,Google Chrome)),主代理', 'MATCH,DIRECT']
  };
  const before = structuredClone(input), out = apply(input, []), rules = out.rules;
  assert.equal(rules.filter(r => r.startsWith('AND,')).length, 0, '不能复活浏览器UDP覆盖');
  for (const name of ['Google Chrome', 'Brave Browser', 'Tabbit']) {
    assert(!rules.some(r => r.includes(name) && r.includes('NETWORK,UDP')));
    assert(!paths.some(p => new RegExp(p).test('/Applications/' + name + '.app/Contents/MacOS/' + name)), '不能以AI进程范围重建浏览器覆盖');
  }
  for (const d of domains) assert(rules.includes('DOMAIN-SUFFIX,' + d + ',' + group), '保留AI业务分流');
  for (const p of paths) assert(rules.includes('PROCESS-PATH-REGEX,' + p + ',' + group), '保留专用AI进程分流');
  for (const d of directDomains) assert(rules.includes('DOMAIN-SUFFIX,' + d + ',DIRECT'), '保留国内AI/Apple直连');
  assert(rules.indexOf('RULE-SET,sr-private,DIRECT') < rules.indexOf('RULE-SET,sr-proxy,主代理'));
  assert(rules.includes('RULE-SET,sr-reject,REJECT'), '基础拒绝规则不是此次撤销的附加防护');
  assert.equal(rules.at(-1), 'MATCH,主代理');
  assert.deepEqual(apply(out, []), out, '重复生成不得复活旧规则');
  assert.deepEqual(input, before, '不改写调用者输入');
  assert.deepEqual(out.proxies, input.proxies);
  assert.deepEqual(out['proxy-groups'].find(g => g.name === '主代理'), input['proxy-groups'][0]);
  assert.equal(out['find-process-mode'], 'always', '保留AI业务正常进程识别');
}
console.log('PASS 浏览器UDP撤销：原模板/跨home候选均为空、旧覆盖不复活、AI与DIRECT业务及节点/主组保持、幂等');
