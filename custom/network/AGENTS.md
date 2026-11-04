# 定制网络环境维护规则

本目录是公开Fork的下游适配层。先阅读README、恢复与验收、同步上游；根上游接入流程继续适用于实际客户端部署，本目录不是绕过其风险检查的授权。

## 边界

- `master`保留上游；定制目标分支为`custom/network-environment`。
- 常规增量放本目录，根README/AGENTS仅保留最小入口。根LICENSE、NOTICE和来源登记不得删改归属。
- 禁止提交实际订阅、节点配置、真实摘要、API Key、Cookie、个人绝对路径、控制器认证和生产日志；不仅检查工作树，也检查本次提交和新增文件。
- pins和候选输出必须在仓库外，默认`prepare.js`不联网、不默认重新信任节点、不扫描或刷新源。仅显式核实后使用`--trust-source`建立初始本地信任；不做额外长期敏感备份。
- `subscription/`是另行显式启用的原HTTPS可信源入口轮换模块，维护前读其README/API契约。所有私有state、模板、输入、输出、锁和backup拒绝仓库内路径；不得提交任何实物源数据。仅`server`允许原URL认证响应确认变更，其他稳定传输/节点集合变化仍拒绝；完整PIN不移除`server`，v2固定policy_base、远端仅替换server；持久私有授权账本不自动裁剪已暴露的认证代。缓存永远不能指定可信新server。
- 可信源发布必须显式提供私有模板，先通过`prepare.js`填好平台AI路径再恢复空PIN占位；不得丢失进程覆盖或复活浏览器UDP。失败回退数据但保留授权账本/已暴露脚本扩展，回退不完整须明确报错；不保证跨文件掉电原子性。公开模块/合成测试与目标设备真实集成须分别记录。
- 本层是完整规则/DNS候选，不是任意配置的追加补丁；现有例外、IPv6策略或客户端顺序冲突需先解决。发布到GitHub不授予部署到设备的权限。
- 不擅自改PF、系统服务、TUN开关、节点选择、浏览器权限或账号；不用关闭代理建立直连基线，不在没有离线恢复时做断网演练。
- `macos-dhcp/`保留为历史离线PF模块，维护前读取其README；已撤防设备不得按它重新布防、恢复Guard/SGID或执行旧安装/恢复入口。不得复制旧机器安装器/账本/摘要、自动提权或加载两规则模板；在仍获授权使用旧策略的设备上也须保留出站root socket限制，不以删除UID条件掩盖原生DHCP/BPF路径差异。

- 默认专线仅Claude、Codex/OpenAI、Gemini、Antigravity；其他AI按普通规则，国内AI/Apple有明确直连与DNS例外。Chrome三个服务主机按模板精确列举并同步AI DNS，不扩大为整个Google API或全部浏览器进程。
- 本完整方案已撤销Chrome/Brave/Tabbit专用UDP路由；模板和生成器浏览器列表必须为空，不能在刷新、升级或恢复时复活。根普通WebRTC步骤不能替代此撤防选择；不默认安装Guard/PF、SGID或浏览器策略/扩展，不据此声称无泄露。撤防不代表允许关闭通用系统安全。
- `+.gov.cn`与保留的住建部例外仅指境内DNS类别，不新增整类政府业务DIRECT规则、不硬编码CDN地址。
- 官方客户端升级与源码发布、规则/DNS部署、节点信任更新是不同事务。保留升级前最新有效配置与手选，不用旧快照覆盖撤防和Chrome修复，不引入评分版源码或安装器。

- 用户选择完整方案并清理无用组时，以实际引用闭包判断：主代理/AI组及全部节点的dialer依赖必须保留；删除不可达业务/包装组，不改变规则/DNS、节点或保留组成员。刷新后不得重新引入无用组。

## 验证

```bash
node custom/network/test_prepare.js
node custom/network/test.js
node custom/network/test_scope.js
node custom/network/test_groups.js
node custom/network/test_dns_exception.js
node custom/network/test_browser_udp.js
python3 -B -m unittest discover -s custom/network/macos-dhcp -p 'test_*.py'
python3 -O -B -m unittest discover -s custom/network/macos-dhcp -p 'test_*.py'
python3 -B -m unittest discover -s custom/network/subscription -p 'test_*.py'
python3 -O -B -m unittest discover -s custom/network/subscription -p 'test_*.py'
```

测试使用合成节点与虚构home，禁止引入生产缓存；新增功能先写反例。上游源码变更另运行根维护说明要求的测试/契约与原生验证。文件检查、生成成功、规则加载、真实网络、真实App、跨设备恢复是不同验收层次。

## 维护记录

公开README只记录适用范围、可执行命令与实际验证边界；设备私有状态留在用户授权的本机记录，不能靠历史结果宣称新设备通过。没有授权时不启用自动同步、GitHub发布或生产部署，更新上游数据不能附带重信任节点。
