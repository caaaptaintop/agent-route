'use strict';
const assert = require('assert/strict');
const Module = require('node:module');
const {render} = require('./prepare');
const prepared = new Module(__filename + '.candidate');
prepared._compile(render({settings: require('./settings.example.json'), home: '/__test_home__', pins: []}), __filename + '.candidate');
const {apply, group} = prepared.exports;
function fixture() {
 return {proxies:[{name:'ordinary',type:'http',server:'normal.invalid',port:1080},{name:'chained',type:'http',server:'chain.invalid',port:1081,'dialer-proxy':'dialer-root'}], 'proxy-groups':[
  {name:'主代理',type:'select',proxies:['region','manual-ip']},
  {name:'region',type:'select',proxies:['ordinary']},
  {name:'manual-ip',type:'select',proxies:['ordinary']},
  {name:'old-business',type:'select',proxies:['DIRECT','region']},
  {name:'unused-wrapper',type:'select',proxies:['old-business']},
  {name:'unused-reject',type:'select',proxies:['REJECT']},
  {name:'dialer-root',type:'select',proxies:['dialer-child']},
  {name:'dialer-child',type:'select',proxies:['ordinary']}
 ]};
}
const input=fixture(), before=JSON.parse(JSON.stringify(input)), out=apply(input,[]);
assert(!out['proxy-groups'].some(g=>g.name==='old-business'), '旧业务组仍未删除');
assert.deepEqual(out['proxy-groups'].map(g=>g.name), ['主代理','region','manual-ip','dialer-root','dialer-child',group]);
assert.deepEqual(input,before,'不能修改调用者输入');
assert.deepEqual(out.proxies,input.proxies,'不能删除或改写节点');
for(const g of input['proxy-groups'].filter(g=>out['proxy-groups'].some(x=>x.name===g.name))) assert.deepEqual(out['proxy-groups'].find(x=>x.name===g.name),g,'有效组成员/选项不能改变');
assert.deepEqual(apply(out,[]),out,'重复刷新必须保持清理结果');
// Deleting orphan groups must not be a way to bypass validation.
const bad=fixture();bad['proxy-groups'].push({name:'invalid-unused',type:'select',proxies:['missing']});assert.throws(()=>apply(bad,[]),/unresolved/);
const normal=apply({proxies:input.proxies.slice(0,1),'proxy-groups':input['proxy-groups'].slice(0,3)},[]);
assert.deepEqual(out.rules.filter(r=>!r.includes('chain.invalid')), normal.rules,'删除无用组不能改变分流规则');
assert.deepEqual(out.dns,normal.dns,'DNS不能因清理变化');
const absent=apply({proxies:input.proxies.slice(0,1),'proxy-groups':[{name:'主代理',type:'select',proxies:['ordinary']}]},[]);
assert(absent['proxy-groups'].some(g=>g.name===group),'专线无节点时仍保留REJECT组');
console.log('PASS 分组清理：递归无用包装/业务组删除、有效手选及节点dialer依赖保留、专线REJECT、原输入不变、幂等、无效输入拒绝及规则/DNS保持');
