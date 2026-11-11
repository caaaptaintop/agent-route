// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const assert = require('assert/strict');
const {apply, group} = require('./fixture-policy.js');
const input = {proxies:[{name:'ordinary',type:'http',server:'node.invalid',port:1080}], 'proxy-groups':[{name:'主代理',type:'select',proxies:['ordinary']}]};
const before = structuredClone(input);
const c=apply(input,[]), p=c.dns['nameserver-policy'];
const domestic=['https://223.5.5.5/dns-query#DIRECT','https://223.6.6.6/dns-query#DIRECT'];
assert.deepEqual(p['+.gov.cn'], domestic, '经用户授权，政府根域与子域应使用境内DNS');
assert.deepEqual(p['+.mohurd.gov.cn'], domestic, '保留既有住建部DNS修复');
for(const k of ['+.cn','+.gov','+.com','+.bsgslb.cn','+.bsclink.cn','+.googleapis.com','+.gov.cn.example.com']) {
  assert(!Object.hasOwn(p,k),'不扩大到非政府、共享CDN或共享API后缀：'+k);
}
// Check the declared suffix policy's hostname boundary; real core DNS is verified separately.
function suffixPolicy(host) {
  const keys=Object.keys(p).filter(k=>k.startsWith('+.')).sort((a,b)=>b.length-a.length);
  const key=keys.find(k=>host===k.slice(2)||host.endsWith('.'+k.slice(2)));
  return key ? p[key] : undefined;
}
for(const h of ['gov.cn','www.gov.cn','www.mee.gov.cn','www.samr.gov.cn','x.city.gov.cn','mohurd.gov.cn','www.mohurd.gov.cn']) {
  assert.deepEqual(suffixPolicy(h),domestic,'政府域名的声明后缀匹配：'+h);
}
for(const h of ['evilgov.cn','gov.cn.example.com','www.cn','www.bsgslb.cn','www.bsclink.cn']) {
  assert.equal(suffixPolicy(h),undefined,'非政府后缀不应命中显式政府策略：'+h);
}
assert(p['+.claude.ai'].every(v=>v.endsWith('#AI-Claude')), '专线DNS必须保持');
assert(c.dns.nameserver.every(v=>v.endsWith('#主代理')), '普通DNS不变');
assert.equal(c.rules.filter(r=>r.includes('gov.cn')||r.includes('58.221.77.')||r.includes('156.225.111.')).length,0,'只修DNS，不新增政府流量规则或硬编码CDN地址');
assert(c.rules.includes('RULE-SET,sr-cn-ip,DIRECT'));
assert.deepEqual(apply(c,[]),c,'重复执行幂等');
assert.deepEqual(input,before,'不修改输入对象');
assert.deepEqual(c.proxies,input.proxies);
assert.deepEqual(c['proxy-groups'].find(g=>g.name==='主代理'),input['proxy-groups'][0]);
console.log('PASS 政府DNS类别及住建部保持、声明后缀边界、AI/普通DNS保持、无流量规则/IP变更、幂等及节点/主组保持');
