# 显式启用：原HTTPS可信源的入口轮换

这是可复用的Python模块与合成测试，不是默认订阅刷新任务或一键部署器。默认`../prepare.js`保持离线、不联网、不改客户端；只有目标设备明确启用本模块并完成私有状态初始化后，私有集成程序才可调用网络发布API。本目录不包含实物state、订阅URL、节点、摘要、生产输出或安装器。

## 信任与允许变更

1. 人工核实原HTTPS订阅URL及完整节点后，在仓库外的0600私有v2 state保存原URL的SHA-256、节点除`server`外的稳定传输摘要、明确登记的`policy_base`、已验证profile和发布状态。URL通过明确的配置文件/源UID定位，不能用缓存或重定向提供的新地址替换；v1不能自动升级信任，须另行明确登记基线。
2. 缓存只是触发信号。节点名称、认证、TLS、端口、协议或集合变化仍拒绝；缓存中的新`server`绝不是发布依据。缓存变化时重新通过系统curl验证原HTTPS源，只接受HTTPS、无重定向、证书验证成功且HTTP 200的响应，不读取curlrc，带令牌URL通过标准输入而非argv传入。
3. 服务端验证响应仍必须具有相同的稳定传输身份；只取其节点`server`更新已登记的`policy_base`，不采用远端TUN、controller、端口、hosts、分组或运行策略。普通主代理来源变化而专线缓存未变时复用已验证专线，不为每次普通更新重复访问网络。
4. **完整节点PIN仍包含`server`。**稳定摘要不替代部署脚本的完整摘要；私有授权账本先持久化已认证完整PIN，再暴露候选。脚本合并账本、当前和上一已发布身份，失败/中断后也不自动裁剪已暴露的认证代，避免下一轮使仍在途的旧配置变成REJECT。旧授权的有序清退需另行审阅，不能自行把账本清空或只保留一代。
5. 账本持久化后，按脚本、部署脚本、统一缓存、服务输出、私有state顺序发布。失败对已写数据作受控回退；已认证账本和可能已暴露的脚本PIN扩展保留，未知外来修改不得盲覆盖。写入器替换后报错也检查补偿，一个数据回退失败不应阻止其他补偿；回退不完整明确报错。同一文件原子替换不等于跨文件掉电原子性。

## 文件与运行条件

- `trusted_source.py`：身份、HTTPS重新验证、固定策略基线及受控发布等通用实现。
- `adapter.py`：路径门禁、显式私有模板、锁与发布编排；由私有集成程序调用，不提供默认执行的CLI。
- `test_trusted_source.py`、`test_adapter.py`：合成节点、模拟HTTPS/文件失败与外置路径反例；不会访问真实订阅或现网。
- Python 3.9+、POSIX `fcntl`、PyYAML；安装开发依赖沿用仓库`requirements-dev.txt`。网络默认使用`/usr/bin/curl`，必须在目标系统独立核实官方系统curl能力。

在仓库根目录运行：

```bash
python3 -B -m unittest discover -s custom/network/subscription -p 'test_*.py'
python3 -O -B -m unittest discover -s custom/network/subscription -p 'test_*.py'
```

## 私有初始化和模板契约

本公开模块不自动建立或重建信任。私有集成程序必须由操作者明确核实来源后创建state；不能因刷新失败就从当前缓存重算摘要。state、输入缓存、配置元数据、模板、输出、锁和backup都必须使用**仓库外绝对路径**，符号链接不能绕过此边界；真实内容不得贴入Issue或提交Git。

state字段如下。这里只列字段语义，不给出可被误用的实物文件：

| 字段 | 内容 |
| --- | --- |
| `version` | 当前为2；旧版需明确重新登记策略基线 |
| `profiles_file`、`source_uid` | 私有源元数据文件及唯一注册源UID |
| `url_sha256` | 人工确认的原HTTPS URL摘要 |
| `stable_identity` | 对已核实节点调用`stable_identity(profile)`所得摘要 |
| `policy_base` | 人工登记的受控profile基线，远端响应只可替换其中节点的server |
| `source_cache` | 仅触发重新验证的专线缓存文件 |
| `template` | 已准备平台应用路径、保留空PIN注入位的私有JS模板，必须显式指定 |
| `pinned_script`、`deployed_script`、`unified_cache` | 三个独立私有发布目标 |
| `verified_profile`、`cache_sha256`、`verified_at` | 已验证源及缓存复用状态；均为私密数据 |
| `published_nodes` | 上一轮已发布节点，与授权账本一起保持在途配置兼容 |

另在state同目录派生`<state文件名>.accepted-pins.json`的0600私有授权账本及`.lock`控制锁；二者同样拒绝仓库内路径/符号链接，账本必须绑定相同URL与稳定传输摘要。账本含真实完整PIN，不能提交Git、公开或从未经认证的任意YAML重建。

**不得直接把仓库原始`route.template.js`当作动态发布模板。**先用`prepare.js`和空PIN在仓库外生成平台候选，再调用`adapter.restore_empty_pin_marker(text)`恢复唯一的`/* PINNED_NODES */ []`占位；该函数只接受原本为空的PIN，不清除既有可信摘要。`adapter.validate_template`要求AI进程路径已显式填好且非空、浏览器UDP列表为空，避免静默丢失Claude/Codex等进程覆盖。额外应用路径继续遵守上层授权和精确范围要求。

## 集成API契约

`adapter.build_trusted(args, route, validate)`由仓库外私有runner显式调用；不会自行发现设备、profile或账号。

- `args`必须提供`trust_state`、`flower`、`ipequal`、`output`、`backup_dir`这五个绝对路径。`ipequal`必须与state的`source_cache`一致，全部发布目标必须互不重叠，且不得覆盖输入或模板。
- `route.AI_GROUP`为现有专线组名；不得改变主代理、当前手选或扩大AI范围。
- `route.compile_script(template, profile)`返回`(script, pins)`，须以完整节点传输摘要替换唯一PIN占位；不得排除`server`。
- `route.merge_profiles(flower, ip)`只合并两个明确输入，必须按`Flower::`/`IPEqual::`命名空间解析全部引用、拒绝动态/悬空/循环引用，并保留节点、有效组依赖与手选名称。不得扫描其他缓存。
- `route.apply_overlay(script, config)`返回完整配置；须拒绝宿主fail-closed配置和执行错误，不能原样退回未受控订阅。编排还会核对全部原可信节点都进入专线组及幂等性。
- `route.private_write(path, text)`必须以0600同目录临时文件、fsync、原子替换实现受限写入，不跟随目标符号链接，不把内容或真实路径写到公共日志。
- `validate(out, counts)`由私有runner明确提供，验证目标机器已获准的规则/DNS/TUN/IPv6基线、节点/组引用和数量；发布API不能替用户决定这些策略。
- 成功返回`(counts, yaml_text, refetched, backup_path)`。其中完整配置和备份路径都属于私密数据，报告应只输出必要的脱敏计数/状态。失败保持或补偿当前有效数据，已认证账本及已暴露脚本扩展有意保留；回退不完整必须人工检查私有恢复材料，不能宣称全量回滚。不得自动放宽认证、普通节点兜底或重新初始化state。

公开模块与合成测试的通过只证明对应逻辑；生产watcher/服务接线、真实HTTPS源、客户端实际加载、手选持久性及联网由目标设备集成方独立验证。本次本机集成与独立审查由主维护会话负责，不把公开测试写成生产验收完成。
