// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const assert = require('assert/strict');
const {apply, group, paths, pathGroups, serviceDirectSuffixes, serviceDirectHosts} = require('./fixture-policy.js').create({extraServiceDirectHosts: ['nas.private.example','news.private.example']});
const suffixes = ['wps.cn','feishu.cn','workbuddy.cn','codebuddy.cn','kdocs.cn'];
const hosts = ['dl.google.com','registry.npmjs.org','global.synologydownload.com','download-mem.nowledge.co','nas.private.example','news.private.example'];
const domestic = ['https://223.5.5.5/dns-query#DIRECT','https://223.6.6.6/dns-query#DIRECT'];
assert.deepEqual(serviceDirectSuffixes, suffixes, '新增业务后缀必须限定为已验证清单');
assert.deepEqual(serviceDirectHosts, hosts, '公共下载主机和显式私有示例只添加精确主机');
const input = {proxies:[{name:'ordinary',type:'http',server:'node.invalid',port:1080}],
  'proxy-groups':[{name:'主代理',type:'select',proxies:['ordinary']}],
  tun:{enable:true,stack:'gvisor','auto-route':true,'strict-route':true}, 'mixed-port':7897};
const before=structuredClone(input), c=apply(input,[]), r=c.rules, p=c.dns['nameserver-policy'];
const added=[...suffixes.map(d=>'DOMAIN-SUFFIX,'+d+',DIRECT'),...hosts.map(d=>'DOMAIN,'+d+',DIRECT')];
const regular=r.indexOf('RULE-SET,sr-proxy,主代理'), reject=r.indexOf('RULE-SET,sr-reject,REJECT');
const dedicated=paths.map(s=>'PROCESS-PATH-REGEX,'+s+','+pathGroups[s]).map(s=>r.indexOf(s));
for(const rule of added) {
  assert.equal(r.filter(x=>x===rule).length,1,'每条新增规则只出现一次：'+rule);
  assert(r.indexOf(rule)>reject && r.indexOf(rule)>Math.max(...dedicated) && r.indexOf(rule)<regular,'不得绕过REJECT/AI专用进程：'+rule);
}
for(const d of suffixes) assert.deepEqual(p['+.'+d],domestic,'业务后缀同步境内DNS：'+d);
for(const d of hosts) {
  assert.deepEqual(p[d],domestic,'精确主机同步精确DNS：'+d);
  assert(!Object.hasOwn(p,'+.'+d),'不得扩大精确主机DNS后缀：'+d);
  assert(!r.includes('DOMAIN-SUFFIX,'+d+',DIRECT'),'不得扩大精确主机流量后缀：'+d);
}
for(const d of ['synology.me','synology.com','synologydownload.com','google.com','googleapis.com','npmjs.org','private.example','nowledge.co','cn','qpic.cn','officecli.ai','tabbit.com']) {
  assert(!r.includes('DOMAIN-SUFFIX,'+d+',DIRECT'),'不得扩大到共享或未验证后缀：'+d);
  assert(!Object.hasOwn(p,'+.'+d),'不得扩大DNS：'+d);
}
const matches=(h,d)=>h===d||h.endsWith('.'+d);
function simulatedRoute(host,process='') {
  for(const rule of r) {
    const a=rule.split(',');
    if(a[0]==='RULE-SET' && a[1]==='sr-reject' && host==='blocked.workbuddy.cn')return a[2];
    if(a[0]==='DOMAIN' && host===a[1])return a[2];
    if(a[0]==='DOMAIN-SUFFIX' && matches(host,a[1]))return a[2];
    if(a[0]==='PROCESS-PATH-REGEX' && new RegExp(a[1]).test(process))return a[2];
    if(a[0]==='RULE-SET' && a[1]==='sr-proxy')return a[2];
  }
}
for(const d of suffixes)for(const h of [d,'www.'+d,'api.'+d])assert.equal(simulatedRoute(h),'DIRECT');
for(const d of hosts)assert.equal(simulatedRoute(d),'DIRECT');
for(const h of ['child.download-mem.nowledge.co','download-mem.nowledge.co.evil.test','api.nowledge.co','other.nowledge.co','child.global.synologydownload.com','global.synologydownload.com.evil.test','other.synologydownload.com','other.synology.me','evilnas.private.example','child.nas.private.example','dl.google.com.evil.test','child.dl.google.com','www.google.com','accounts.google.com','child.registry.npmjs.org','registry.npmjs.org.evil.test','news.private.example.evil.test'])assert.notEqual(simulatedRoute(h),'DIRECT','不能误匹配：'+h);
assert.equal(simulatedRoute('blocked.workbuddy.cn'),'REJECT');
const codex='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
for(const d of [...suffixes,...hosts])assert.equal(simulatedRoute(d,codex),'AI-Codex','保留Codex进程兜底优先：'+d);
for(const h of ['api.openai.com','api.anthropic.com','gemini.google.com','clientservices.googleapis.com','chromegw-pa.googleapis.com','optimizationguide-pa.googleapis.com'])assert.equal(simulatedRoute(h),h==='api.openai.com'?'AI-Codex':h==='api.anthropic.com'?'AI-Claude':'AI-Gemini');
assert.equal(simulatedRoute('drive.google.com'),'主代理');
assert(c.dns.nameserver.every(x=>x.endsWith('#主代理')));
assert.deepEqual(p['+.gov.cn'],domestic); assert.deepEqual(p['+.mohurd.gov.cn'],domestic);
assert.deepEqual(c.proxies,input.proxies);assert.deepEqual(c.tun,input.tun);assert.equal(c['mixed-port'],7897);
assert.deepEqual(c['proxy-groups'].find(g=>g.name==='主代理'),input['proxy-groups'][0]);
assert(!r.some(x=>x.startsWith('AND,((NETWORK,UDP)')),'不得恢复已撤浏览器UDP覆盖');
assert.deepEqual(input,before,'不得修改输入');assert.deepEqual(apply(c,[]),c,'重复生成幂等');
console.log('PASS 11条服务DIRECT与精确/后缀DNS、边界正反例、REJECT/AI进程优先、AI/Drive/政府DNS保持、节点/TUN/选择结构保持、幂等');
