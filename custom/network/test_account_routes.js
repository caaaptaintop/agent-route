// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const assert = require('assert/strict');
const {apply, domains, mediaDomains, digest, group} = require('./fixture-policy.js');
const accounts = ['x.com','twitter.com','t.co','x.ai','grok.com','twimg.com'];
const media = ['video.twimg.com','abs.twimg.com','pbs.twimg.com'];
const node = {name:'fixed',type:'vless',server:'fixed.invalid',port:443,uuid:'00000000-0000-4000-8000-000000000001'};
const config = {proxies:[{...node,name:'IPEqual::fixed'},{name:'Flower::ordinary',type:'trojan',server:'ordinary.invalid',port:443,password:'synthetic'}], 'proxy-groups':[{name:'主代理',type:'select',proxies:['Flower::ordinary']}]};
const pins = [{name:node.name,digest:digest(node)}];
const out = apply(config,pins), rules = out.rules;
assert.deepEqual(mediaDomains, media);
for (const d of accounts) {
 assert(domains.includes(d), 'missing account '+d);
 assert(rules.includes('DOMAIN-SUFFIX,'+d+','+group));
 assert(out.dns['nameserver-policy']['+.'+d].every(x=>x.endsWith('#'+group)));
}
for (const d of media) {
 const i=rules.indexOf('DOMAIN-SUFFIX,'+d+',主代理');
 assert(i>rules.indexOf('RULE-SET,sr-reject,REJECT'));
 assert(i<rules.indexOf('DOMAIN-SUFFIX,twimg.com,'+group));
 assert(out.dns['nameserver-policy']['+.'+d].every(x=>x.endsWith('#主代理')));
}
function match(host) {
 for(const r of rules){const p=r.split(','); if(p[0]==='DOMAIN-SUFFIX'&&(host===p[1]||host.endsWith('.'+p[1]))) return p[2];}
 return 'ordinary';
}
for(const h of ['x.com','api.x.com','api.twitter.com','t.co','grok.com','api.x.ai','api.twimg.com'])assert.equal(match(h),group);
for(const h of media)assert.equal(match(h),'主代理');
for(const h of ['x.com.evil.invalid','nottwitter.com','cloudflare.com','challenges.cloudflare.com','github.com','drive.google.com'])assert.equal(match(h),'ordinary');
assert(!rules.some(r=>r.includes('DOMAIN-KEYWORD,claude')||r.includes('DOMAIN-SUFFIX,cloudflare.com')));
assert.deepEqual(out.proxies,config.proxies);
assert.deepEqual(out['proxy-groups'].find(g=>g.name===group).proxies,['IPEqual::fixed']);
assert.deepEqual(apply(config,[])['proxy-groups'].find(g=>g.name===group).proxies,['REJECT']);
assert.deepEqual(apply(out,pins),out);
for(const h of ['apple.com','deepseek.com','wps.cn'])assert.equal(match(h),'DIRECT');
for(const h of ['global.synologydownload.com','download-mem.nowledge.co'])assert(rules.includes('DOMAIN,'+h+',DIRECT'));
console.log('PASS 账号专线六域、X媒体三域及DNS、边界、拒绝回退、原直连保持、幂等');
