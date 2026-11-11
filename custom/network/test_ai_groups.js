// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const assert=require('assert/strict');
const m=require('./fixture-policy.js');
const names=['AI-Claude','AI-Codex','AI-Gemini','AI-Antigravity'];
const normal={name:'ordinary',type:'http',server:'ordinary.invalid',port:1080};
const ip={name:'IPEqual::line',type:'vless',server:'entry.invalid',port:443,uuid:'synthetic',tls:true};
const pins=[{name:ip.name,digest:m.digest(ip)}];
function input(){return {proxies:[normal,ip],'proxy-groups':[{name:'主代理',type:'select',proxies:['ordinary']},{name:'AI-Claude-Codex-IPEqual',type:'select',proxies:[ip.name]}]};}
function policy(c,host,path=''){
 for(const r of c.rules){const [type,match,target]=r.split(',');if(type==='DOMAIN'&&host===match||type==='DOMAIN-SUFFIX'&&(host===match||host.endsWith('.'+match))||type==='PROCESS-PATH-REGEX'&&new RegExp(match).test(path))return target;}
 return '主代理';
}
assert.equal(m.group,'IPEqual','strict hub must have a clear IPEqual name');
const a=input(),before=structuredClone(a),c=m.apply(a,pins);
assert.deepEqual(a,before);
for(const name of names){const g=c['proxy-groups'].find(x=>x.name===name);assert(g,'missing '+name);assert.equal(g.type,'select');assert.deepEqual(g.proxies,['IPEqual','主代理']);}
assert(!c['proxy-groups'].some(g=>g.name==='AI-Claude-Codex-IPEqual'));
assert.deepEqual(c['proxy-groups'].find(g=>g.name==='IPEqual').proxies,[ip.name]);
const cases=[['api.anthropic.com','AI-Claude'],['claude.ai','AI-Claude'],['api.openai.com','AI-Codex'],['chatgpt.com','AI-Codex'],['gemini.google.com','AI-Gemini'],['generativelanguage.googleapis.com','AI-Gemini'],['clientservices.googleapis.com','AI-Gemini'],['us-central1-aiplatform.googleapis.com','AI-Gemini'],['antigravity.google','AI-Antigravity'],['cloudcode-pa.googleapis.com','AI-Antigravity'],['x.com','IPEqual'],['grok.com','IPEqual'],['other.twimg.com','IPEqual'],['video.twimg.com','主代理'],['nested.pbs.twimg.com','主代理'],['deepseek.com','DIRECT'],['apple.com','DIRECT']];
for(const [host,target] of cases){assert.equal(policy(c,host),target,host);const key='+.'+host;if(c.dns['nameserver-policy'][key])assert(c.dns['nameserver-policy'][key].every(x=>x.endsWith('#'+target)),host+' DNS target');}
for(const [path,target] of [['/Applications/Claude.app/Contents/MacOS/Claude','AI-Claude'],['/__test_home__/.local/bin/claude','AI-Claude'],['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex','AI-Codex'],['/Applications/Antigravity.app/Contents/MacOS/Antigravity','AI-Antigravity']])assert.equal(policy(c,'unknown-ai.invalid',path),target);
assert.equal(policy(c,'deepseek.com','/Applications/Claude.app/Contents/MacOS/Claude'),'AI-Claude','process still precedes DIRECT');
assert.deepEqual(m.apply(c,pins),c,'idempotence');
const noPins=m.apply(input(),[]);assert.deepEqual(noPins['proxy-groups'].find(g=>g.name==='IPEqual').proxies,['REJECT']);
// Deliberately selecting 主代理 is allowed; it must never be an automatic fallback.
for(const name of names){assert.equal(c['proxy-groups'].find(g=>g.name===name).proxies[0],'IPEqual');}
const injected=input();injected['proxy-groups'].push({name:'AI-Claude',type:'fallback',proxies:['DIRECT','ordinary'],'include-all':true});
assert.deepEqual(m.apply(injected,pins)['proxy-groups'].find(g=>g.name==='AI-Claude').proxies,['IPEqual','主代理']);
const collide=input();collide.proxies.push({name:'AI-Claude',type:'http',server:'duplicate.invalid',port:80});assert.throws(()=>m.apply(collide,pins),/name/);
const cycle=input();cycle['proxy-groups'][0].proxies=['AI-Claude'];assert.throws(()=>m.apply(cycle,pins),/primary|unresolved|cyclic/);
const invalid=input();invalid['proxy-groups'].push({name:'orphan',type:'select',proxies:['missing']});assert.throws(()=>m.apply(invalid,pins),/unresolved/);
assert.equal(m.domains.length,34);assert.equal(m.paths.length,6);assert.equal(m.browserPaths.length,0);
// Renaming owned groups must also migrate node dialers, without mutating input
// or admitting a chained node to the strict full-transport PIN selector.
for(const old of ['AI-Claude-Codex-IPEqual','All-Subscriptions']) {
 const src=input();
 if(old==='All-Subscriptions')src['proxy-groups'].push({name:old,type:'select',proxies:['ordinary']});
 src.proxies.push({name:'legacy-relay',type:'http',server:'relay.invalid',port:8080,'dialer-proxy':old});
 const before=structuredClone(src), out=m.apply(src,pins);
 assert.deepEqual(src,before,'input changed during alias migration');
 assert.equal(out.proxies.find(n=>n.name==='legacy-relay')['dialer-proxy'],old==='All-Subscriptions'?'主代理':'IPEqual');
 assert.deepEqual(out['proxy-groups'].find(g=>g.name==='IPEqual').proxies,[ip.name]);
 assert.deepEqual(m.apply(out,pins),out,'dialer alias migration is not idempotent');
}
// Validate only after product selectors are reconstructed; both direct and
// wrapper-mediated dependencies must survive even for unselected nodes.
for(const wrapped of [false,true]) {
 const src=input();src['proxy-groups'].push({name:'AI-Claude',type:'select',proxies:[ip.name]});
 if(wrapped)src['proxy-groups'].push({name:'relay-wrapper',type:'select',proxies:['AI-Claude']});
 const relay={name:'product-relay',type:'http',server:'relay.invalid',port:8080,'dialer-proxy':wrapped?'relay-wrapper':'AI-Claude'};
 src.proxies.push(relay);const before=structuredClone(src),out=m.apply(src,pins);
 assert.deepEqual(src,before);assert.deepEqual(out.proxies,src.proxies);
 assert.deepEqual(out['proxy-groups'].find(g=>g.name==='AI-Claude').proxies,['IPEqual','主代理']);
 if(wrapped)assert.deepEqual(out['proxy-groups'].find(g=>g.name==='relay-wrapper').proxies,['AI-Claude']);
 assert.deepEqual(m.apply(out,pins),out);
 src['proxy-groups'][0].proxies=[relay.name];
 assert.throws(()=>m.apply(src,pins),/primary|unresolved|cyclic/,'a product/primary dialer cycle must still fail');
}
console.log('PASS four independent manual AI groups, explicit pinned/default vs primary, domain/process/DNS split, X/media/DIRECT unchanged, owned dialer migration/product dependency closure/injection/cycle/identity/idempotence');
