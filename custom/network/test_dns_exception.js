// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const {render} = require('./prepare');
const prepared = new Module(__filename + '.candidate');
prepared._compile(render({settings: require('./settings.example.json'), home: '/__test_home__', pins: []}), __filename + '.candidate');
const {apply, group} = prepared.exports;
const input = {proxies:[{name:'ordinary',type:'http',server:'node.invalid',port:1080}], 'proxy-groups':[{name:'主代理',type:'select',proxies:['ordinary']}]};
const before = structuredClone(input), c = apply(input, []), p = c.dns['nameserver-policy'];
const domestic = ['https://223.5.5.5/dns-query#DIRECT', 'https://223.6.6.6/dns-query#DIRECT'];
assert.deepEqual(p['+.gov.cn'], domestic, '政府根域与子域应使用境内DNS');
assert.deepEqual(p['+.mohurd.gov.cn'], domestic, '保留既有住建部DNS例外');
for (const k of ['+.cn','+.gov','+.com','+.bsgslb.cn','+.bsclink.cn','+.googleapis.com','+.gov.cn.example.com']) {
  assert(!Object.hasOwn(p, k), '不能扩大到非政府、共享CDN或共享API后缀：' + k);
}
// Declared suffix boundaries only; native DNS behavior needs separate verification.
function suffixPolicy(host) {
  const keys = Object.keys(p).filter(k => k.startsWith('+.')).sort((a, b) => b.length - a.length);
  const key = keys.find(k => host === k.slice(2) || host.endsWith('.' + k.slice(2)));
  return key ? p[key] : undefined;
}
for (const h of ['gov.cn','www.gov.cn','www.mee.gov.cn','www.samr.gov.cn','x.city.gov.cn','mohurd.gov.cn','www.mohurd.gov.cn']) {
  assert.deepEqual(suffixPolicy(h), domestic, '政府后缀应命中：' + h);
}
for (const h of ['evilgov.cn','gov.cn.example.com','www.cn','www.bsgslb.cn','www.bsclink.cn']) {
  assert.equal(suffixPolicy(h), undefined, '非政府后缀不能命中：' + h);
}
for (const h of ['clientservices.googleapis.com','chromegw-pa.googleapis.com','optimizationguide-pa.googleapis.com']) {
  assert(p['+.' + h].every(v => v.endsWith('#' + group)), 'Chrome服务DNS须绑定现有AI组：' + h);
  assert(c.rules.includes('DOMAIN-SUFFIX,' + h + ',' + group), 'Chrome服务路由与DNS须一致：' + h);
  for (const lookalike of ['evil-' + h, h + '.example.com']) assert.equal(suffixPolicy(lookalike), undefined);
}
for (const h of ['drive.google.com','drivefrontend-pa.googleapis.com','signaler-pa.googleapis.com','play.googleapis.com']) {
  assert.equal(suffixPolicy(h), undefined, '普通Google业务不应误入专线DNS：' + h);
}
assert(p['+.claude.ai'].every(v => v.endsWith('#' + group)), '保留原专线DNS');
assert(c.dns.nameserver.every(v => v.endsWith('#主代理')), '普通DNS不变');
assert.equal(c.rules.filter(r => r.includes('gov.cn')).length, 0, '政府例外仅修DNS，不新增整类DIRECT流量规则');
assert(c.rules.includes('RULE-SET,sr-cn-ip,DIRECT'));
assert.deepEqual(apply(c, []), c, '重复执行幂等');
assert.deepEqual(input, before, '不修改输入');
assert.deepEqual(c.proxies, input.proxies);
assert.deepEqual(c['proxy-groups'].find(g => g.name === '主代理'), input['proxy-groups'][0]);
console.log('PASS 政府DNS类别及住建部保持、后缀边界、Chrome三服务路由/DNS一致、普通Google不误覆盖、无政府流量规则、幂等及节点/主组保持');
