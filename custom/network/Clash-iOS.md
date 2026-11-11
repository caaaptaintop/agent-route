# iPhone / iPad：Clash Client兼容与私有导入

本页针对[ProjectClash/Clash-Client](https://github.com/ProjectClash/Clash-Client)的iOS应用 **Clash**，不是Clash Mi、Shadowrocket或Stash。源码、文件生成、手机导入及真实联网是不同阶段；本仓库不提供节点、完整私有YAML、公网订阅地址或一键部署。

## 同源配置，不复制桌面入口

从已经核实的私有统一mihomo YAML生成独立的手机文件，保持节点的完整认证/传输字段、静态分组引用、原规则来源、DNS及最终MATCH。不在公开转换站提交配置，不从未经核实的缓存重新建立信任。

- 四产品组分别手选IPEqual/主代理；严格IPEqual只含可信直接节点，失败不自动换普通节点或DIRECT。X账号和媒体分离策略保持。
- iOS不支持macOS进程路径匹配，应删除桌面配置中的全部进程路径规则，不新增手机App捕获。源桌面方案现有六条默认进程规则；其他设备若有额外规则，也须逐项识别，不能只按固定数量删除。
- Apple Network Extension管理隧道；不携带桌面`tun`、监听端口、`allow-lan`、桌面DNS监听或外部控制器/secret。不同版本按官方[兼容性](https://clash.md/guide/compatibility)、[入站](https://clash.md/guide/config/inbound)和[DNS](https://clash.md/guide/config/dns)文档复核，不能把Mac控制口令搬上手机。
- 保留五个同源上游HTTPS规则集，不随意改owner或假称本Fork已发布release数据。节点及分组是导出时的静态快照；在线规则集仍按原URL和周期刷新。这既不是所有内容永久冻结，也不是完整订阅自动更新。
- 可把源端明确选择的组成员排首作为新导入初始顺序；手机同名组缓存可能优先，最终以手机显示为准。Mac和手机后续选择不自动同步。

生成器应另行校验节点/组成员唯一、引用闭合、无循环、规则目标存在、严格组无普通供应商/DIRECT，以及输入不被修改。进行YAML回读和实际Mihomo离线解析；不把私有源或输出放入本仓库。

## 私有文件导入

1. 保留手机原配置。用AirDrop或其他可信私密渠道传输文件；完整YAML包含实际凭据，不公开分享、不作为Git附件。
2. 在Clash中点击当前配置名，进入Profile Center → Add Profile，选择从配置文件导入。界面随版本变化时先查看当前页面，不凭旧截图盲点。
3. 切换为规则模式，核对四AI组及两类出口、严格IPEqual成员、X媒体规则优先级、五规则集加载状态和DNS。
4. 确认后由用户允许启用手机VPN，逐项检查下面的真实验收。

`127.0.0.1`属于手机自己，不是Mac；Mac的回环订阅服务不能直接作为手机URL。文件交付不授权开放LAN、启动公网服务、上传完整配置、重导出SR/SSR或替换Mac客户端。

## 验收边界

每项分别记录通过/失败/未验证：文件成功导入；VPN接管；规则集实际下载；四AI两分支及X账号/媒体/国内DIRECT命中；Reality/Vision；UDP；DNS；必要的真实账号功能。匿名TLS/HTTP、Mac解析和合成测试不能证明上述手机层均已通过，也不能保证账号资格或公网出口IP永不改变。

回退只回切手机原有效配置或撤销本次独立授权范围，不恢复旧节点快照、Guard/PF、浏览器UDP限制或桌面特殊身份。没有真实iPhone/iPad证据时，应明确写“手机未验收”。
