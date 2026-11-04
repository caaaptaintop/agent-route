# 网络环境适配与恢复入口

这是 AgentRoute Fork 的下游定制层，不是上游官方功能，也不是节点服务或“一键零泄露”安装器。

- 上游：<https://github.com/ryuu-restart/agent-route>。
- 本 Fork：<https://github.com/caaaptaintop/agent-route>。
- 定制分支：`custom/network-environment`；`master` 保留上游源码，不混入本机定制。
- 本层按根目录 GPL-3.0 许可发布，保留根目录 `LICENSE`、`NOTICE.md`、`licenses/` 与来源登记；不宣称上游代码为原创。

## 这里保存什么

| 文件 | 用途 |
| --- | --- |
| `route.template.js` | 完整的Clash Verge局部Script候选；基础AgentRoute分流、AI可信节点绑定、DNS分层；浏览器UDP覆盖已撤销 |
| `prepare.js` | 离线参数化工具；使用本机home生成路径，从显式核实的节点建立本地指纹，生成候选但不安装 |
| `settings.example.json` | 无凭据的macOS设置示例 |
| [显式可信源入口轮换](subscription/README.md) | 原HTTPS源重新验证、固定策略基线/私有授权PIN账本、受控发布的通用模块/API与合成测试；非默认自动任务 |
| [历史：macOS DHCP 换网候选](macos-dhcp/README.md) | 保留独立PF层的离线工具与合成测试；已撤防设备不得按历史教程重新布防 |
| `test.js`、`test_prepare.js`、`test_scope.js`、`test_groups.js`、`test_dns_exception.js`、`test_browser_udp.js` | 合成节点、参数化路径、AI范围、政府DNS与浏览器UDP撤销回归 |
| [恢复与验收](恢复与验收.md) | 换电脑、重装系统或Clash后的恢复顺序、真实验证边界 |
| [同步上游](同步上游.md) | 源码同步、规则数据更新与生产部署的区别 |
| [版本变更与官方升级](版本变更与官方升级.md) | 撤防、Chrome Gemini、政府DNS及官方2.5.10升级的配置保留与恢复边界 |
| `AGENTS.md` | 维护此目录的范围、验证命令与发布约束 |

**不保存**订阅地址、节点服务器/密码、API Key、真实节点摘要、账号Cookie、真实连接日志、个人绝对路径或敏感备份。换机后需要重新取得自己的订阅并在本机导入；仓库不能恢复遗失的凭据。候选脚本虽然不含密码，仍包含本机路径和节点指纹，必须留在仓库外。

## 策略结构

1. 节点引导、本地/私网、private、reject优先；四类AI的域名/专用进程其次；国内AI与Apple明确直连例外、普通proxy/direct/国内IP/最终代理在后。没有浏览器专用UDP覆盖。
2. 默认专线范围仅为**Claude、Codex/OpenAI、Gemini、Antigravity**。`AI-Claude-Codex-IPEqual`为兼容选择保留旧名，仅允许完整传输摘要匹配的独立节点；无匹配时仅`REJECT`，不加入普通节点或DIRECT。Proma、ChatGPT主程序、Grok Bot、Magpie、Codenotch不再按整个进程强制专线。
3. 国内AI的明确域名及Apple服务，包括iCloud内容、App Store/音乐等，设为DIRECT，并同步DIRECT DNS。未列出的国际API变体和其他AI回到普通AgentRoute；需要代理时跟随`主代理`，仍允许手选其他出口，不锁死某个供应商。
4. 专线域名DNS绑专线组；普通默认解析跟主代理；内网及节点引导保留本地/直连例外。仅进程识别的未知目的不保证专线DNS，不把DoH加密等同出口正确。
5. Claude桌面/Code原生版本/链接/bootstrap、ChatGPT包内的Codex Service与CLI、Antigravity官方bundle有精确范围；不捕获通用node/bun、终端、浏览器或仅凭名称为Gemini的其他程序。预备路径不代表设备已安装或真实验收。
6. 2026-11-03撤销Chrome/Brave/Tabbit专用UDP路由；公开模板与离线生成器的浏览器路径列表均为空，刷新不应恢复旧规则。浏览器UDP回到普通业务分流，本层不安装Guard/PF、SGID身份、浏览器策略或扩展，也不声称WebRTC已受保护。根目录普通接入流程中的固定WebRTC限制不应覆盖此完整方案的撤防选择。
7. Chrome内置Gemini需要的`clientservices.googleapis.com`、`chromegw-pa.googleapis.com`、`optimizationguide-pa.googleapis.com`纳入现有AI组及对应DNS，沿用具体服务主机的后缀策略，不扩展为`googleapis.com`或`google.com`总后缀。它们是共享Chrome服务，可能连带非Gemini请求。Google Drive及其他普通Google业务仍跟随主代理。部分OpenAI/ChatGPT、Vertex及cloudcode端点同样跨产品共享，不能按加密URL区分所有使用者；未列地区API需核验补齐。
8. 默认应用路径在`/Applications`，原生CLI按home参数化。其他目录、安装方式、OS或新增子进程需再适配。无生效规则/有效依赖的旧业务组与包装组会自动删除；按主代理、AI组和全部节点dialer引用递归保留有用组，不按品牌名盲删地区组，也不删除节点。

政府域名DNS类别：`+.gov.cn`使用境内加密DNS，同时保留`+.mohurd.gov.cn`旧例外。这里只调整解析路径，**不是整类政府业务流量DIRECT**；不添加政府流量规则、不硬编码CDN地址，也不扩大到所有`.cn`、共享CDN或其他Google API。实际出站仍由既有规则决定。

规则provider仍指向**上游**的`release/mihomo/`，设为每86400秒刷新。此Fork尚不作为规则数据发布源；复制Fork仓库不等于Fork已有可用的release数据，也不等于本机自动使用此分支。

## 本机离线准备

需要支持本代码的Node.js；当前采用Node.js内置模块，无npm依赖。先运行：

```bash
node custom/network/test_prepare.js
node custom/network/test.js
node custom/network/test_scope.js
node custom/network/test_groups.js
node custom/network/test_dns_exception.js
node custom/network/test_browser_udp.js
```

下列命令只说明接口，不应将占位路径直接当作本机路径。可让Agent根据实际设备准备仓库外目录，不要求用户记住命令。

1. 在代理客户端重新导入订阅，核实拟供AI使用的每个节点。将**已核实**的节点数组暂存为仓库外本地JSON；不能把整份机场订阅、未知URL下载结果或普通节点直接当作可信来源。不要把JSON贴进会话。
2. 显式建立本地指纹：

```bash
node custom/network/prepare.js --trust-source /绝对路径/仓库外/verified-nodes.json --output /绝对路径/仓库外/ai-pins.json
```

输入为JSON节点数组，输出只有名称和完整传输参数SHA256。**这一步是明确建立信任，不是网络测试，也不证明供应商身份。** 不接受已有输出覆盖；以后节点参数变化应先核实再生成新的文件，不能定时重算来绕过身份校验。节点数组可由本机Agent在不回显密码的情况下从已确认来源提取；不要额外做长期敏感备份。

3. 从本机home生成候选：

```bash
node custom/network/prepare.js --pins /绝对路径/仓库外/ai-pins.json --output /绝对路径/仓库外/overlay.js
```

额外专用应用路径会扩展“仅四类AI”的默认范围，必须单独明确认可；可在仓库外复制设置示例后，通过`--settings /绝对路径/仓库外/settings.json`的`extraAiExecutables`明确提供。只接受精确可执行文件绝对路径，内部转义后生成锚定规则；不接受用户正则，避免顶层分支逃逸和RE2兼容问题。通用node/bun、Shell、下载器及浏览器执行文件会被拒绝。

默认`prepare.js`只接受仓库外输入输出，只创建新文件且权限0600，不覆盖已有文件；不读Keychain、不扫订阅、不访问网络，不写Clash、不改PF/代理开关、不启动应用。另行显式启用的[可信源模块](subscription/README.md)可以在人工初始化后重新验证原HTTPS源并受控发布；它不是默认离线流程的隐式扩展，也不自动重建节点信任。

4. **先停在候选阶段。**脚本会完整重建规则/DNS并设置`ipv6:false`，不是适合任意机器的无损追加补丁。需要用户明确认可这套分流及IPv6基线、核对本地例外、组名、可信节点、脚本执行顺序、原生解析和可用回退后才可应用。不得用关闭IPv6掩盖接管问题。

5. 按[恢复与验收](恢复与验收.md)完成真实检查。未完成的项目明确写未验证，不能用本仓库单元测试代替新电脑实际验收。

## 动态入口变更：单独显式启用

`subscription/`提供原HTTPS可信源的可复用代码与合成测试：缓存只触发验证，`server`仅可从原HTTPS认证响应确认轮换；认证/TLS/端口/节点集合变化仍拒绝，完整PIN继续包含`server`。普通来源变化可复用已验证的专线源。v2私有状态固定`policy_base`，远端只提供新server、不改变本机运行策略；私有授权账本在暴露候选前持久化完整PIN，并兼容当前、上一已发布及失败后仍可能在途的认证代。失败回退数据，但保留已认证账本和已暴露脚本扩展；不保证跨文件掉电原子性。

这不是开箱自动刷新CLI。接线前必须按其API契约建立仓库外0600私有state、显式指定已填好平台进程路径的私有模板及全部外部目标，并提供已审阅的路由适配器和验证函数。不得直接把原始模板交给发布器而丢失进程覆盖，不复制真实源数据进Git。公开模块测试不替代目标设备的watcher、服务、真实HTTPS与客户端验收。

## 必须保留的边界

- 撤防后浏览器公网UDP可能按普通规则直连；HTTP/UDP也可能使用不同公网出口。不能声称同IP、同地区、WebRTC防护或防风控保证。
- 不为修WebRTC自动套用“禁用非代理UDP”、浏览器企业策略或扩展；如另需限制，必须先明确新的范围与授权，并独立验证音视频兼容性。
- 定位默认询问不隐藏IP地区；浏览器DoH关闭不证明全机DNS无绕过。不要清空Cookie、账号授权或无关权限。
- 语法损坏、宿主不执行脚本、错误的导入层次、其他中继/子进程、IPv6、冷启动/休眠、核心退出与PF改写都不是单元测试可以包办的保证。
- 宿主会吞脚本异常时，仅抛错可能恢复源订阅规则，所以`main`校验失败返回拒绝配置；但这不能替代实际检查脚本执行和最终运行时。
- 本层**不安装Guard、PF、防直连服务、launchd任务、SGID身份、浏览器策略或扩展，也不自动部署**；撤防不是关闭通用系统安全的授权，不提供旧机器系统文件供直接搬迁。
- `macos-dhcp/`保留为历史独立模块，只对仍明确采用对应旧PF策略且另有授权的设备提供离线候选。已撤防设备不得运行历史安装/恢复入口，不应恢复旧Guard或核心特殊身份；不能把两规则模板加载为完整PF策略。源码发布不等于设备部署或所有网络验收。
