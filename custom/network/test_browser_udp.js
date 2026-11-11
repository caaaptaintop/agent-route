// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const assert = require('assert/strict');
const {browserPaths, paths, domains, directDomains, domainGroups, pathGroups, apply, group} = require('./fixture-policy.js');
// 2026-11-03: the user explicitly withdrew browser-wide UDP protection.
assert.deepEqual(browserPaths, [], '不得重新添加已撤销的浏览器UDP进程范围');
const input = {
  proxies: [{name: '普通节点', type: 'socks5', server: 'node.invalid', port: 1080, udp: true}],
  'proxy-groups': [{name: '主代理', type: 'select', proxies: ['普通节点']}]
};
const out = apply(input, []);
const rules = out.rules;
assert.equal(rules.filter(r => r.startsWith('AND,')).length, 0, '不得通过AND规则强制浏览器UDP走代理');
for (const name of ['Google Chrome', 'Brave Browser', 'Tabbit']) {
  assert(!rules.some(r => r.includes('/Applications/' + name) && r.includes('NETWORK,UDP')),
    '已撤销的浏览器UDP规则不能复活：' + name);
}
for (const domain of domains) {
  assert(rules.includes('DOMAIN-SUFFIX,' + domain + ',' + domainGroups[domain]), '保留既有AI业务分流');
}
for (const path of paths) {
  assert(rules.includes('PROCESS-PATH-REGEX,' + path + ',' + pathGroups[path]), '保留专用AI进程分流');
}
for (const domain of directDomains) {
  assert(rules.includes('DOMAIN-SUFFIX,' + domain + ',DIRECT'), '保留国内AI/Apple直连');
}
assert(rules.indexOf('RULE-SET,sr-private,DIRECT') < rules.indexOf('RULE-SET,sr-proxy,主代理'));
assert(rules.includes('RULE-SET,sr-reject,REJECT'), '普通AgentRoute拒绝规则不是此次WebRTC防护');
assert.deepEqual(apply(out, []), out, '重复刷新必须幂等');
assert.deepEqual(out.proxies, input.proxies, '不能改变节点');
assert.deepEqual(out['proxy-groups'].find(g => g.name === '主代理'), input['proxy-groups'][0]);
assert.equal(out['find-process-mode'], 'always', 'AI业务仍使用正常进程识别');
console.log('PASS 浏览器UDP撤销：无专用规则，AI/国内/Apple分流、节点与主组保持，重复生成不复活');
