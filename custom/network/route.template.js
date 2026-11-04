// SPDX-License-Identifier: GPL-3.0-only
// Portable downstream variant; local trust and paths are supplied by prepare.js.
// AgentRoute v2: complete, idempotent Clash Verge main; not a post-processing patch.
// Build injects SHA-256 transport identities from the separately trusted IPEqual cache.
// Digests cover credentials and protocol options without embedding either in the script.
var AR_PINNED_NODES = /* PINNED_NODES */ [];
var AR_AI_GROUP = 'AI-Claude-Codex-IPEqual';
// Dedicated egress is limited to Claude, Codex/OpenAI, Gemini and Antigravity.
// OpenAI endpoints are shared with ChatGPT; Vertex endpoints may serve non-Gemini
// models. TLS service/path sharing cannot be distinguished by these domain rules.
var AR_AI_DOMAINS = [
  'openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com',
  'chat.openai.com.auth0.com', 'anthropic.com', 'claude.ai', 'claude.com', 'claudeusercontent.com',
  'gemini.google.com', 'aistudio.google.com', 'ai.google.dev', 'makersuite.google.com',
  'generativelanguage.googleapis.com', 'aiplatform.googleapis.com',
  'us-central1-aiplatform.googleapis.com', 'alkalimakersuite-pa.clients6.google.com',
  'geminiweb-pa.clients.google.com', 'geminiweb-pa.clients6.google.com',
  // Chrome Gemini also uses browser eligibility/Variations and optimization services.
  // These specific shared service hosts include non-Gemini Chrome requests; never widen to googleapis.com.
  'clientservices.googleapis.com', 'chromegw-pa.googleapis.com', 'optimizationguide-pa.googleapis.com',
  'antigravity.google', 'antigravity-pa.googleapis.com', 'antigravity.googleapis.com',
  'cloudcode-pa.googleapis.com', 'daily-cloudcode-pa.googleapis.com',
  'daily-cloudcode-pa.sandbox.googleapis.com'
];
// Explicit domestic services plus the previously direct-listed Qwen/Z.ai hosts.
// International API variants not listed here follow ordinary AgentRoute rules.
var AR_DOMESTIC_AI_DOMAINS = [
  'deepseek.com', 'kimi.com', 'kimi.ai', 'moonshot.cn', 'qwen.ai', 'chat.qwenlm.ai',
  'qianwen.com', 'tongyi.com', 'tongyi.aliyun.com', 'qianwen.aliyun.com',
  'dashscope.aliyuncs.com', 'doubao.com', 'ark.cn-beijing.volces.com',
  'bigmodel.cn', 'z.ai', 'chatglm.cn', 'minimaxi.com', 'api.minimax.chat'
];
var AR_APPLE_DOMAINS = [
  'apple.com', 'apple.com.cn', 'icloud.com', 'icloud.com.cn', 'cdn-apple.com',
  'aaplimg.com', 'mzstatic.com', 'apple-cloudkit.com', 'apple-mapkit.com', 'me.com',
  'icloud-content.com', 'applemusic.com', 'itunes.com', 'apple.news', 'apple-dns.net', 'appsto.re'
];
var AR_DIRECT_DOMAINS = AR_DOMESTIC_AI_DOMAINS.concat(AR_APPLE_DOMAINS);
// Only dedicated application scopes; never all of Proma/ChatGPT/Codenotch,
// a generic Gemini-named app, node/bun, terminals or browsers.
// Bundle scopes are parameterized by prepare.js and require per-device validation.
var AR_AI_PROCESS_PATHS = /* AI_PROCESS_PATHS */ [];

// Browser UDP override withdrawn on 2026-11-03; prepare.js must keep this empty.
// Ordinary business/private/direct routing remains unchanged; no WebRTC protection claim.
var AR_BROWSER_UDP_PATHS = /* BROWSER_UDP_PATHS */ [];

function main(config) {
  try { return arApply(config, AR_PINNED_NODES); }
  catch (e) {
    // Clash Verge keeps its INPUT when a script throws. Return a valid closed
    // configuration instead, so script-validation errors cannot revive source rules.
    if (typeof console !== 'undefined') console.log('AgentRoute validation failed; fail-closed configuration returned');
    var c = JSON.parse(JSON.stringify(config || {}));
    c.mode = 'rule'; c.ipv6 = false; c.proxies = [];
    c['proxy-groups'] = [{name: '主代理', type: 'select', proxies: ['REJECT']}, {name: AR_AI_GROUP, type: 'select', proxies: ['REJECT']}];
    c['rule-providers'] = {}; c['proxy-providers'] = {}; c['sub-rules'] = {};
    delete c.listeners; delete c.tunnels; delete c.hosts;
    c.dns = {enable: true, listen: '127.0.0.1:1053', ipv6: false, 'use-hosts': false, 'use-system-hosts': false, nameserver: ['rcode://refused']};
    c.rules = ['DOMAIN,localhost,DIRECT', 'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve', 'IP-CIDR6,::1/128,DIRECT,no-resolve', 'MATCH,REJECT'];
    return c;
  }
}

function arCanonical(value) {
  if (Array.isArray(value)) return '[' + value.map(arCanonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function(k) { return JSON.stringify(k) + ':' + arCanonical(value[k]); }).join(',') + '}';
  return JSON.stringify(value);
}
// SHA-256, unsigned 32-bit arithmetic; portable to Clash Verge's QuickJS runtime.
function arSha256(text) {
  var bytes = encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, function(_, h) { return String.fromCharCode(parseInt(h, 16)); });
  var data = [], i, j;
  for (i = 0; i < bytes.length; i++) data.push(bytes.charCodeAt(i));
  var length = data.length; data.push(128);
  while (data.length % 64 !== 56) data.push(0);
  for (i = 7; i >= 0; i--) data.push(i >= 4 ? 0 : ((length * 8) >>> (i * 8)) & 255);
  var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function rotr(x,n) { return (x >>> n) | (x << (32-n)); }
  for (i = 0; i < data.length; i += 64) {
    var w = [], a=h[0], b=h[1], c=h[2], d=h[3], e=h[4], f=h[5], g=h[6], z=h[7];
    for (j=0;j<16;j++) w[j]=(data[i+j*4]<<24)|(data[i+j*4+1]<<16)|(data[i+j*4+2]<<8)|data[i+j*4+3];
    for (j=16;j<64;j++) { var x=w[j-15], y=w[j-2]; w[j]=((rotr(x,7)^rotr(x,18)^(x>>>3))+w[j-16]+(rotr(y,17)^rotr(y,19)^(y>>>10))+w[j-7])|0; }
    for (j=0;j<64;j++) {
      var t1=(z+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[j]+w[j])|0;
      var t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))|0;
      z=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
    }
    var state=[a,b,c,d,e,f,g,z]; for (j=0;j<8;j++) h[j]=(h[j]+state[j])|0;
  }
  return h.map(function(n) { return ('00000000'+(n>>>0).toString(16)).slice(-8); }).join('');
}
function arNodeDigest(n) {
  var transport = {};
  Object.keys(n).forEach(function(k) { if (k !== 'name') transport[k] = n[k]; });
  return arSha256(arCanonical(transport));
}

function arApply(input, pins) {
  if (!input || typeof input !== 'object') throw new Error('AgentRoute: configuration must be a mapping');
  // Never leave a partially rewritten input if validation fails.
  var c = JSON.parse(JSON.stringify(input));
  var nodes = Array.isArray(c.proxies) ? c.proxies : [];
  var groups = Array.isArray(c['proxy-groups']) ? c['proxy-groups'] : [];
  var map = Object.create(null);
  var nodeMap = Object.create(null);
  var builtin = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL'];
  var allowedTypes = ['vless', 'vmess', 'trojan', 'ss', 'ssr', 'socks5', 'http', 'hysteria', 'hysteria2', 'tuic', 'anytls', 'wireguard', 'snell', 'ssh'];
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function assert(ok, message) { if (!ok) throw new Error('AgentRoute: ' + message); }
  function safeName(n) { return typeof n === 'string' && n.length && !/[\r\n,#]/.test(n); }
  function dynamic(g) {
    return ['include-all', 'include-all-proxies', 'include-all-providers'].some(function(k) { return !!g[k]; }) ||
      (g.use != null && (!Array.isArray(g.use) || g.use.length > 0));
  }
  function matchesAI(host) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    return AR_AI_DOMAINS.some(function(d) { return host === d || host.slice(-(d.length + 1)) === '.' + d; });
  }
  nodes.forEach(function(n) {
    assert(n && safeName(n.name) && builtin.indexOf(n.name) < 0 && [AR_AI_GROUP, 'All-Subscriptions'].indexOf(n.name) < 0 && !own(map, n.name), 'duplicate/invalid node name');
    assert(allowedTypes.indexOf(n.type) >= 0, 'unsupported/non-network proxy type');
    assert(typeof n.server === 'string' && n.server.length > 0 && !/[\r\n,#]/.test(n.server), 'invalid node endpoint');
    assert(!matchesAI(n.server), 'node endpoint collides with AI domain policy; manual review required');
    map[n.name] = n; nodeMap[n.name] = n;
  });
  groups.forEach(function(g) {
    assert(g && safeName(g.name) && builtin.indexOf(g.name) < 0 && !own(map, g.name), 'duplicate/invalid group name');
    map[g.name] = g;
  });
  assert(!c['proxy-providers'] || Object.keys(c['proxy-providers']).length === 0, 'dynamic proxy providers require explicit support');
  assert(!c['sub-rules'] || Object.keys(c['sub-rules']).length === 0, 'subscription sub-rules are not supported');

  assert(!c.listeners || c.listeners.length === 0, 'custom listeners require explicit route validation');
  assert(!c.tunnels || c.tunnels.length === 0, 'fixed tunnels require explicit route validation');
  delete c.listeners; delete c.tunnels; delete c.hosts;
  // Full transport digests bind the AI group to the trusted source, not just a display name.
  var aiNodes = [];
  (pins || []).forEach(function(p) {
    var matches = nodes.filter(function(n) {
      return (n.name === p.name || n.name === 'IPEqual::' + p.name) &&
        arNodeDigest(n) === p.digest &&
        !n['dialer-proxy'] && !n['interface-name'] && !n['routing-mark'];
    });
    if (matches.length === 1 && aiNodes.indexOf(matches[0].name) < 0) aiNodes.push(matches[0].name);
  });
  // Preserve the stable group name (and thus eligible saved selections), but reconstruct
  // members/options so include-all/use/fallback cannot insert other outbound providers.
  var ai = {name: AR_AI_GROUP, type: 'select', proxies: aiNodes.length ? aiNodes.sort() : ['REJECT']};
  groups = groups.filter(function(g) { return g.name !== AR_AI_GROUP && g.name !== 'All-Subscriptions'; });
  delete map['All-Subscriptions']; map[AR_AI_GROUP] = ai; groups.push(ai);
  groups.forEach(function(g) {
    if (Array.isArray(g.proxies)) g.proxies = g.proxies.map(function(ref) { return ref === 'All-Subscriptions' ? '主代理' : ref; });
    if (g.name === 'IpEqual' || g.name === 'IPEqual::IpEqual') {
      assert(Array.isArray(g.proxies), 'invalid IPEqual group');
      g.proxies = g.proxies.filter(function(n) { return n !== 'DIRECT' && n !== 'REJECT'; });
      if (!g.proxies.length) g.proxies = ['REJECT'];
    }
  });
  c['proxy-groups'] = groups;
  // All references, including nested dialers, must be resolvable and acyclic.
  function walk(name, path, closedOnly) {
    if (name === 'REJECT' || name === 'REJECT-DROP') return 0;
    if (name === 'DIRECT') { assert(!closedOnly, 'direct fallback in primary group'); return 0; }
    assert(own(map, name), 'unresolved proxy reference');
    assert(path.indexOf(name) < 0, 'cyclic proxy reference');
    var item = map[name], next = path.concat([name]);
    if (own(nodeMap, name)) {
      if (item['dialer-proxy']) walk(item['dialer-proxy'], next, closedOnly);
      return 1;
    }
    assert(!dynamic(item), 'dynamic group membership unsupported');
    assert(['select', 'url-test', 'fallback', 'load-balance'].indexOf(item.type) >= 0, 'unsupported group type');
    assert(Array.isArray(item.proxies) && item.proxies.length > 0, 'empty proxy group');
    return item.proxies.reduce(function(count, ref) { return count + walk(ref, next, closedOnly); }, 0);
  }
  groups.forEach(function(g) { walk(g.name, [], false); });
  nodes.forEach(function(n) { if (n['dialer-proxy']) walk(n.name, [], false); });
  var primary = null;
  ['主代理', 'Proxies', 'IpEqual', 'AgentRoute'].some(function(name) {
    if (!own(map, name) || own(nodeMap, name)) return false;
    try { if (walk(name, [], true) > 0) { primary = name; return true; } } catch (e) { /* try next explicit candidate */ }
    return false;
  });
  assert(primary, 'no verified non-direct primary group; refusing subscription fallback');

  c.mode = 'rule'; c.ipv6 = false; c['find-process-mode'] = 'always';
  c.profile = Object.assign({}, c.profile || {}, {'store-selected': true, 'store-fake-ip': true});
  c.sniffer = {
    enable: true, 'force-dns-mapping': false, 'parse-pure-ip': true, 'override-destination': false,
    sniff: {HTTP: {ports: [80, '8080-8880']}, TLS: {ports: [443, 8443]}},
    'skip-dst-address': ['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','224.0.0.0/4','::1/128','fc00::/7','fe80::/10','ff00::/8']
  };
  function doh(target) { return ['https://1.1.1.1/dns-query#' + target, 'https://1.0.0.1/dns-query#' + target]; }
  var directDNS = ['https://223.5.5.5/dns-query#DIRECT', 'https://223.6.6.6/dns-query#DIRECT'];
  var policy = {};
  AR_AI_DOMAINS.forEach(function(d) { policy['+.' + d] = doh(AR_AI_GROUP); });
  AR_DIRECT_DOMAINS.forEach(function(d) { policy['+.' + d] = directDNS; });
  // Cloudflare returns SERVFAIL for this zone; AliDNS resolves it. Keep the
  // exception DNS-only: existing cn-ip routing decides the actual outbound.
  policy['+.mohurd.gov.cn'] = directDNS;
  // Government-domain DNS only; preserve existing outbound routing.
  policy['+.gov.cn'] = directDNS;
  // Explicit service suffix policies take precedence over domain rule-set policies.
  policy['+.lan'] = ['system']; policy['+.local'] = ['system']; policy['+.home.arpa'] = ['system'];
  policy['rule-set:sr-private'] = ['system'];
  policy['rule-set:sr-proxy'] = doh(primary);
  policy['rule-set:sr-direct'] = directDNS;
  c.dns = {
    enable: true, listen: (c.dns && c.dns.listen) || '127.0.0.1:1053', ipv6: false,
    'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16', 'respect-rules': true,
    'default-nameserver': ['https://223.5.5.5/dns-query', 'https://223.6.6.6/dns-query'],
    'proxy-server-nameserver': directDNS, 'direct-nameserver': directDNS,
    'direct-nameserver-follow-policy': true, nameserver: doh(primary),
    'use-hosts': false, 'use-system-hosts': false,
    'nameserver-policy': policy, 'fake-ip-filter-mode': 'blacklist',
    'fake-ip-filter': ['localhost', '+.lan', '+.local', '+.home.arpa', 'rule-set:sr-private']
  };
  var providers = {}, base = 'https://raw.githubusercontent.com/ryuu-restart/agent-route/release/mihomo/';
  ['private', 'reject', 'proxy', 'direct', 'cn-ip'].forEach(function(key) {
    providers['sr-' + key] = {type: 'http', behavior: key === 'cn-ip' ? 'ipcidr' : 'domain', format: 'yaml',
      url: base + key + '.yaml', path: './rules/sr-' + key + '.yaml', interval: 86400, proxy: primary};
  });
  c['rule-providers'] = providers;
  var rules = [], seen = Object.create(null);
  function add(r) { if (!seen[r]) { seen[r] = true; rules.push(r); } }
  nodes.forEach(function(n) {
    var server = n.server;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(server)) add('IP-CIDR,' + server + '/32,DIRECT,no-resolve');
    else if (server.indexOf(':') >= 0) add('IP-CIDR6,' + server + '/128,DIRECT,no-resolve');
    else add('DOMAIN,' + server + ',DIRECT');
  });
  add('DOMAIN,localhost,DIRECT');
  ['lan','local','home.arpa'].forEach(function(d) { add('DOMAIN-SUFFIX,' + d + ',DIRECT'); });
  add('IP-CIDR,198.18.0.0/15,REJECT,no-resolve');
  ['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','224.0.0.0/4'].forEach(function(ip) { add('IP-CIDR,' + ip + ',DIRECT,no-resolve'); });
  ['::1/128','fc00::/7','fe80::/10','ff00::/8'].forEach(function(ip) { add('IP-CIDR6,' + ip + ',DIRECT,no-resolve'); });
  add('RULE-SET,sr-private,DIRECT');
  add('RULE-SET,sr-reject,REJECT');
  AR_AI_DOMAINS.forEach(function(d) { add('DOMAIN-SUFFIX,' + d + ',' + AR_AI_GROUP); });
  AR_AI_PROCESS_PATHS.forEach(function(p) { add('PROCESS-PATH-REGEX,' + p + ',' + AR_AI_GROUP); });
  // No browser-specific UDP override; ordinary business rules apply.
  // Dedicated AI process scopes above also retain priority over these exceptions.
  AR_DIRECT_DOMAINS.forEach(function(d) { add('DOMAIN-SUFFIX,' + d + ',DIRECT'); });
  // Existing AgentRoute direct DNS/bootstrap exceptions remain intentional, not a zero-leak claim.
  ['223.5.5.5','223.6.6.6'].forEach(function(ip) { add('IP-CIDR,' + ip + '/32,DIRECT,no-resolve'); });
  ['1.1.1.1','1.0.0.1'].forEach(function(ip) { add('IP-CIDR,' + ip + '/32,' + primary + ',no-resolve'); });
  add('RULE-SET,sr-proxy,' + primary); add('RULE-SET,sr-direct,DIRECT');
  add('RULE-SET,sr-cn-ip,DIRECT'); add('MATCH,' + primary);
  c.rules = rules;
  // Only retain groups reachable from effective outbound roots. A group referenced
  // solely by an unused wrapper is still unused. Keep every node and its nested
  // dialer dependencies, including nodes that are not currently selected.
  var retained = Object.create(null);
  function retain(name) {
    if (!name || builtin.indexOf(name) >= 0 || retained[name]) return;
    assert(own(map, name), 'unresolved retained outbound reference');
    retained[name] = true;
    var item = map[name];
    if (own(nodeMap, name)) {
      if (item['dialer-proxy']) retain(item['dialer-proxy']);
    } else item.proxies.forEach(retain);
  }
  // Rules, owned DNS policies and provider downloads use these same two roots.
  retain(primary); retain(AR_AI_GROUP);
  nodes.forEach(function(n) { if (n['dialer-proxy']) retain(n['dialer-proxy']); });
  c['proxy-groups'] = groups.filter(function(g) { return !!retained[g.name]; });
  return c;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {apply: arApply, main: main, domains: AR_AI_DOMAINS, directDomains: AR_DIRECT_DOMAINS, domesticDomains: AR_DOMESTIC_AI_DOMAINS, appleDomains: AR_APPLE_DOMAINS, paths: AR_AI_PROCESS_PATHS, browserPaths: AR_BROWSER_UDP_PATHS, group: AR_AI_GROUP, digest: arNodeDigest, sha256: arSha256};
}
