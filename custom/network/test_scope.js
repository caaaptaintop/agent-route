'use strict';
const assert = require('assert/strict');
const Module = require('node:module');
const {render} = require('./prepare');
const prepared = new Module(__filename + '.candidate');
prepared._compile(render({settings: require('./settings.example.json'), home: '/__test_home__', pins: []}), __filename + '.candidate');
const {apply, domains, paths, browserPaths, directDomains, group} = prepared.exports;
const shouldBeOrdinary = ['grok.com','x.ai','perplexity.ai','pplx.ai','githubcopilot.com','copilot.microsoft.com','cursor.com','cursor.sh','codeium.com','windsurf.com','openrouter.ai','poe.com','notebooklm.google','labs.google','huggingface.co','midjourney.com','sora.com','dashscope-intl.aliyuncs.com','moonshot.ai','minimax.io'];
const domestic = ['deepseek.com','kimi.com','kimi.ai','moonshot.cn','qwen.ai','chat.qwenlm.ai','qianwen.com','tongyi.com','tongyi.aliyun.com','qianwen.aliyun.com','dashscope.aliyuncs.com','doubao.com','ark.cn-beijing.volces.com','bigmodel.cn','z.ai','chatglm.cn','minimaxi.com','api.minimax.chat'];
const apple = ['apple.com','apple.com.cn','icloud.com','icloud.com.cn','cdn-apple.com','aaplimg.com','mzstatic.com','apple-cloudkit.com','apple-mapkit.com','me.com','icloud-content.com','applemusic.com','itunes.com','apple.news','apple-dns.net','appsto.re'];
const suffix = (host, d) => host === d || host.endsWith('.' + d);
for (const h of [...shouldBeOrdinary, ...domestic, ...apple, 'drive.google.com','signaler-pa.googleapis.com','drivefrontend-pa.googleapis.com','accounts.google.com','play.googleapis.com'])
 assert(!domains.some(d=>suffix(h,d)), '专线误覆盖：' + h);
for (const h of ['api.openai.com','codex-cloud-backend.chatgpt.com','ws.chatgpt.com','api.anthropic.com','claude.ai','claude.com','claudeusercontent.com','gemini.google.com','aistudio.google.com','generativelanguage.googleapis.com','aiplatform.googleapis.com','antigravity.google','cloudcode-pa.googleapis.com','daily-cloudcode-pa.googleapis.com','geminiweb-pa.clients.google.com','geminiweb-pa.clients6.google.com','clientservices.googleapis.com','chromegw-pa.googleapis.com','optimizationguide-pa.googleapis.com','antigravity-pa.googleapis.com','antigravity.googleapis.com','us-central1-aiplatform.googleapis.com'])
 assert(domains.some(d=>suffix(h,d)), '缺少四类AI服务：' + h);
assert(!domains.includes('googleapis.com') && !domains.includes('google.com'));
assert.deepEqual(new Set(directDomains), new Set([...domestic,...apple]));
for (const d of directDomains) for (const a of domains) assert(!suffix(d,a) && !suffix(a,d), '专线/直连范围碰撞');
const patterns = paths.map(p=>new RegExp(p));
for (const p of ['/Applications/Claude.app/Contents/MacOS/Claude','/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex','/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Versions/156.0.8078.79/Helpers/Codex (Service).app/Contents/MacOS/Codex (Service)','/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper'])
 assert(patterns.some(r=>r.test(p)), '专用进程缺少覆盖：' + p);
for (const p of ['/Applications/Proma.app/Contents/MacOS/Proma','/Applications/ChatGPT.app/Contents/MacOS/ChatGPT','/Applications/Grok Bot.app/Contents/MacOS/Grok Bot','/Applications/Codenotch.app/Contents/MacOS/Codenotch','/Applications/Google Drive.app/Contents/MacOS/Google Drive','/__test_home__/.cache/magpie/bun/1.4.4/magpie-bun','/Applications/Gemini.app/Contents/MacOS/Gemini','/usr/bin/node','/usr/bin/bun','/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Versions/1/Helpers/NotCodex.app/Contents/MacOS/Codex'])
 assert(!patterns.some(r=>r.test(p)), '非专用进程误覆盖：' + p);
const input = {proxies:[{name:'普通节点',type:'http',server:'node.invalid',port:1080}], 'proxy-groups':[{name:'主代理',type:'select',proxies:['普通节点']},{name:'旧业务组',type:'select',proxies:['DIRECT','普通节点']}]};
const out = apply(input, []);
assert.deepEqual(out.proxies, input.proxies);
assert.deepEqual(out['proxy-groups'].filter(g=>g.name!==group), input['proxy-groups'].filter(g=>g.name==='主代理'));
assert(!out['proxy-groups'].some(g=>g.name==='旧业务组'), '无规则/有效引用的旧组应被清理');
assert.equal(out.rules.at(-1),'MATCH,主代理');
const r = out.rules, reject = r.indexOf('RULE-SET,sr-reject,REJECT'), regular = r.indexOf('RULE-SET,sr-proxy,主代理');
assert.deepEqual(browserPaths, [], '已撤销的浏览器UDP范围必须为空');
assert(!r.some(rule=>rule.startsWith('AND,')), '不得复活浏览器UDP覆盖');
for (const d of directDomains) {
 const i = r.indexOf('DOMAIN-SUFFIX,'+d+',DIRECT');
 assert(i>reject && i<regular, '直连例外保持在基础拒绝之后、普通规则之前：'+d);
 assert(out.dns['nameserver-policy']['+.'+d].every(x=>x.endsWith('#DIRECT')), 'DNS没有同步直连：'+d);
}
for (const d of domains) {
 const i = r.indexOf('DOMAIN-SUFFIX,'+d+','+group);
 assert(i>reject && i<regular);
 assert(out.dns['nameserver-policy']['+.'+d].every(x=>x.endsWith('#'+group)));
}
for (const d of shouldBeOrdinary) assert(!Object.hasOwn(out.dns['nameserver-policy'],'+.'+d), '移除专线却留下旧DNS覆盖：'+d);
assert.deepEqual(apply(out, []), out);
console.log('PASS 四类AI/普通AI/国内AI/Apple/Drive域名，专用进程正反例，DIRECT DNS一致性、无浏览器UDP覆盖、节点与分组保持、幂等');
