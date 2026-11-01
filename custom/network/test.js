// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const assert = require('assert/strict');
const Module = require('node:module');
const {render} = require('./prepare');
const prepared = new Module(__filename + '.candidate');
prepared._compile(render({settings: require('./settings.example.json'), home: '/__test_home__', pins: []}), __filename + '.candidate');
const {apply, main, domains, paths, group, digest, sha256, browserPaths} = prepared.exports;
const clone = x => JSON.parse(JSON.stringify(x));
const sourceNodes = [1,2,3,4].map(i => ({name:'test-'+i,type:'vless',server:'node'+i+'.invalid',port:443,uuid:'00000000-0000-4000-8000-000000000001'}));
const pins = sourceNodes.map(n => ({name:n.name,digest:digest(n)}));
function fixture() {
  const ai = sourceNodes.map(p => ({...p, name:'IPEqual::'+p.name}));
  return {mode:'global',ipv6:true,proxies:[...ai,{name:'Flower::test',type:'http',server:'flower.invalid',port:8080}],
    'proxy-groups':[
      {name:'Flower::Proxies',type:'select',proxies:['Flower::test']},
      {name:'IPEqual::IpEqual',type:'select',proxies:[...ai.map(n=>n.name),'DIRECT','REJECT']},
      {name:'主代理',type:'select',proxies:['Flower::Proxies','IPEqual::IpEqual']},
      {name:group,type:'select',proxies:ai.map(n=>n.name)},
      {name:'All-Subscriptions',type:'select',proxies:['Flower::Proxies','IPEqual::IpEqual']}],
    rules:['DOMAIN-SUFFIX,openai.com,DIRECT','MATCH,DIRECT'],
    dns:{fallback:['8.8.8.8'], 'nameserver-policy': {'+.openai.com':['system']}},
    'rule-providers':{'untrusted':{type:'http',url:'https://invalid.invalid'}}};
}
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
function ai(c){return c['proxy-groups'].find(g=>g.name===group);}
function checkClosed(c){assert(ai(c).proxies.every(n=>n==='REJECT'||n.startsWith('IPEqual::')));assert(!ai(c).use);assert(!ai(c)['include-all']);}
test('完整重建：合成节点不被改写',()=>{
 const x=fixture(), before=clone(x), c=apply(x,pins);
 assert.deepEqual(x,before);assert.deepEqual(c.proxies,x.proxies);assert.equal(c.mode,'rule');assert.equal(c.ipv6,false);
 assert.equal(c.rules.at(-1),'MATCH,主代理');assert(!c['proxy-groups'].some(g=>g.name==='All-Subscriptions'));
 assert(!c.rules.includes('MATCH,DIRECT'));assert.deepEqual(Object.keys(c['rule-providers']),['sr-private','sr-reject','sr-proxy','sr-direct','sr-cn-ip']);
});
test('reject 在 AI 之前，AI 在普通代理/直连规则之前',()=>{
 const c=apply(fixture(),pins), r=c.rules;
 const reject=r.indexOf('RULE-SET,sr-reject,REJECT'), ordinary=r.indexOf('RULE-SET,sr-proxy,主代理');
 for(const d of domains){const i=r.indexOf('DOMAIN-SUFFIX,'+d+','+group);assert(i>reject&&i<ordinary);}
 assert(r.indexOf('RULE-SET,sr-private,DIRECT')<reject);
});
test('重建AI组去掉动态成员与DIRECT，保留节点选择名称',()=>{
 const c=fixture(),g=ai(c);g.proxies.push('DIRECT','Flower::test');g.use=['foreign'];g['include-all']=true;
 const out=apply(c,pins);checkClosed(out);assert.equal(ai(out).proxies.length,4);assert.equal(ai(out).type,'select');
});
test('缺组时从已核实来源重建，不靠旧组存在性',()=>{
 const c=fixture();c['proxy-groups']=c['proxy-groups'].filter(g=>g.name!==group);
 assert.equal(ai(apply(c,pins)).proxies.length,4);
});
test('无可信IPEqual时仅AI范围REJECT，普通主代理保留',()=>{
 const c=apply(fixture(),[]);assert.deepEqual(ai(c).proxies,['REJECT']);assert.equal(c.rules.at(-1),'MATCH,主代理');
 assert(c.dns['nameserver-policy']['+.openai.com'].every(v=>v.endsWith('#'+group)));
});
test('节点端点伪装、链式节点不能进入AI组',()=>{
 const c=fixture();c.proxies[0].server='foreign.invalid';c.proxies[1]['dialer-proxy']='Flower::test';
 const out=apply(c,pins);assert.deepEqual(ai(out).proxies,['IPEqual::test-3','IPEqual::test-4']);
});
test('支持可信源节点数量变化，不硬编码四条',()=>{
 const p=pins.slice(0,2);assert.equal(ai(apply(fixture(),p)).proxies.length,2);
});
test('AI和节点引导域名碰撞时停止，不绕过拒绝或制造递归',()=>{
 const c=fixture();c.proxies[0].server='api.openai.com';assert.throws(()=>apply(c,pins),/collides/);
});
test('缺失、重复、循环、动态组和空组全部拒绝生成',()=>{
 for(const mutate of [
 c=>{c['proxy-groups'][0].proxies=['absent'];},
 c=>{c.proxies.push(clone(c.proxies[0]));},
 c=>{c['proxy-groups'][0].proxies=['主代理'];},
 c=>{c['proxy-groups'][0]['include-all-proxies']=true;},
 c=>{c['proxy-groups'][0].proxies=[];},
 c=>{c.proxies[0]['dialer-proxy']=c.proxies[0].name;},
 c=>{c['proxy-providers']={foreign:{}};},
 c=>{c['sub-rules']={foreign:[]};},
 c=>{c.proxies[0].type='direct';}
 ]) {const c=fixture();mutate(c);assert.throws(()=>apply(c,pins));}
});
test('普通主代理含DIRECT时拒绝，不静默恢复源规则',()=>{
 const c=fixture();c['proxy-groups'][0].proxies.push('DIRECT');assert.throws(()=>apply(c,pins),/primary/);
});
test('无适合主代理时抛错，不原样返回配置',()=>assert.throws(()=>apply({rules:['MATCH,DIRECT']},[]),/primary/));
test('DNS独立拥有：清除源fallback，AI域名绑定IPEqual',()=>{
 const c=apply(fixture(),pins);assert(!c.dns.fallback);assert(!c.dns['fallback-filter']);
 for(const d of domains){assert(c.dns['nameserver-policy']['+.'+d].every(v=>v.endsWith('#'+group)));}
 assert(c.dns.nameserver.every(v=>v.endsWith('#主代理')));assert(c.dns['proxy-server-nameserver'].every(v=>v.endsWith('#DIRECT')));
});
test('主代理成员与可用手选名称保留；不冒充真实持久选择验证',()=>{
 const c=fixture(),before=clone(c['proxy-groups'][2]);const out=apply(c,pins);
 assert.deepEqual(out['proxy-groups'].find(g=>g.name==='主代理'),before);assert(out.profile['store-selected']);
});
test('进程范围局限AI应用，不捕获所有浏览器/node/bun',()=>{
 const patterns=paths.map(p=>new RegExp(p));
 for(const p of ['/usr/local/bin/node','/usr/local/bin/bun','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Proma.app/Contents/MacOS/Proma','/Applications/Grok Bot.app/Contents/MacOS/Grok Bot','/__test_home__/.cache/magpie/bun/1.4.4/magpie-bun'])assert(!patterns.some(r=>r.test(p)));
 for(const p of ['/Applications/Claude.app/Contents/MacOS/Claude','/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'])assert(patterns.some(r=>r.test(p)));
});
test('完整覆写重复执行幂等',()=>{
 const a=apply(fixture(),pins),b=apply(a,pins),d=apply(b,pins);assert.deepEqual(a,b);assert.deepEqual(b,d);
});
test('传输身份包含凭据、WS Host/path及TLS选项，不仅是端点',()=>{
 for(const change of [n=>{n.uuid='different';},n=>{n['ws-opts']={headers:{Host:'foreign'},path:'/foreign'};},n=>{n.tls=true;}]) {
  const c=fixture();change(c.proxies[0]);assert(!ai(apply(c,pins)).proxies.includes(c.proxies[0].name));
 }
});
test('SHA256对照Node crypto及Unicode/边界长度',()=>{
 const crypto=require('crypto');
 for(const s of ['', 'abc', '中文节点😀', ...Array.from({length:150},(_,i)=>'x'.repeat(i))])assert.equal(sha256(s),crypto.createHash('sha256').update(s).digest('hex'));
});
test('listeners/tunnels固定出口拒绝，保留组名不能用作节点',()=>{
 for(const key of ['listeners','tunnels']){const c=fixture();c[key]=[{name:'x',proxy:'DIRECT'}];assert.throws(()=>apply(c,pins));}
 const c=fixture();c['proxy-groups']=c['proxy-groups'].filter(g=>g.name!==group);c.proxies.push({name:group,type:'http',server:'x.invalid',port:80});assert.throws(()=>apply(c,pins));
});
test('删除订阅hosts映射，避免AI域名被覆写为私网地址',()=>{
 const c=fixture();c.hosts={'api.openai.com':'127.0.0.1'};const out=apply(c,pins);assert(!out.hosts);assert.equal(out.dns['use-hosts'],false);assert.equal(out.dns['use-system-hosts'],false);
});
test('宿主入口错误时返回拒绝配置，不抛错令Clash恢复输入',()=>{
 const c=main({rules:['MATCH,DIRECT'],listeners:[{proxy:'DIRECT'}]});assert.equal(c.rules.at(-1),'MATCH,REJECT');assert(!c.listeners);assert.deepEqual(c.proxies,[]);assert.deepEqual(c.dns.nameserver,['rcode://refused']);
});

test('浏览器UDP规则在AI/private/reject后、普通直连前，不拦截Safari和微信',()=>{
 const c=apply(fixture(),pins),rules=c.rules;
 assert.equal(browserPaths.length,3);
 for(const p of browserPaths){
  const i=rules.indexOf('AND,((NETWORK,UDP),(PROCESS-PATH-REGEX,'+p+')),'+'主代理');
  assert(i>rules.indexOf('DOMAIN-SUFFIX,claude.ai,'+group));
  assert(i>rules.indexOf('RULE-SET,sr-reject,REJECT'));
  assert(i<rules.indexOf('RULE-SET,sr-direct,DIRECT'));
 }
 for(const p of ['/Applications/Safari.app/Contents/MacOS/Safari','/Applications/WeChat.app/Contents/MacOS/WeChat','/System/Library/Frameworks/WebKit.framework/com.apple.WebKit.Networking'])assert(!browserPaths.some(x=>new RegExp(x).test(p)));
});
console.log('PASS test cases='+count+'; domain suffixes='+domains.length+'; process scopes='+paths.length);
