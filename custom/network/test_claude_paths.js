// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const assert = require('assert/strict');
const {paths, pathGroups, apply, group} = require('./fixture-policy.js');
const patterns = paths.map(p => new RegExp(p));
const positives = [
  '/Applications/Claude.app/Contents/MacOS/Claude',
  '/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper',
  '/Applications/Claude.app/Contents/Resources/claude',
  '/__test_home__/.local/bin/claude',
  '/__test_home__/.local/share/claude/versions/2.1.316',
  '/__test_home__/.local/share/claude/versions/2.2.0-beta.1',
  '/__test_home__/.claude/downloads/claude-2.1.316-darwin-arm64'
];
const negatives = [
  '/opt/homebrew/bin/node', '/opt/homebrew/bin/bun', '/usr/bin/curl',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/NotClaude.app/Contents/MacOS/Claude',
  '/Applications/Claude.app.bak/Contents/MacOS/Claude',
  '/Users/other/.local/share/claude/versions/2.1.316',
  '/__test_home__/.local/share/claude/versions/not-a-version',
  '/__test_home__/.local/share/claude/versions/2.1.316/another',
  '/__test_home__/.local/bin/claude-other',
  '/__test_home__/.claude/downloads/unrelated',
  '/__test_home__/.claude/downloads/claude-2.1.316-darwin-arm64/another'
];
for (const p of positives) assert(patterns.some(r => r.test(p)), '缺少覆盖：' + p);
for (const p of negatives) assert(!patterns.some(r => r.test(p)), '范围过宽：' + p);
const c = apply({proxies:[{name:'普通节点',type:'http',server:'node.invalid',port:443}], 'proxy-groups':[{name:'主代理',type:'select',proxies:['普通节点']}]}, []);
const first = c.rules.indexOf('RULE-SET,sr-proxy,主代理');
const reject = c.rules.indexOf('RULE-SET,sr-reject,REJECT');
for (const p of paths) {
  const i = c.rules.indexOf('PROCESS-PATH-REGEX,' + p + ',' + pathGroups[p]);
  assert(i > reject && i < first, '进程规则优先级错误');
}
console.log('PASS Claude 路径：' + positives.length + '正例，' + negatives.length + '反例，规则优先级');
