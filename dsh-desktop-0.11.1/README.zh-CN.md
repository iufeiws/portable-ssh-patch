# DSH Desktop SSH 设备切换器（`app.asar` 构建）

English | [简体中文](./README.zh-CN.md)

> 本目录属于 [portable-ssh-patch](../README.md)。**解包 `resources/app` 构建**请见同级的 [`dsh-desktop-2.0.13/`](../dsh-desktop-2.0.13) 目录。

为 **DSH Desktop `0.11.1`（`app.asar` 打包构建）** 增加 SSH 设备切换功能的补丁。

> 这不是 [anywhere-labs/dsh-desktop v2.0.13](https://github.com/anywhere-labs/dsh-desktop) 那个补丁的改写：那一版面向**未打包**的 `resources/app/lib/...`（`WebContentsView` 标题栏 + `compatibility-chrome.html`），本补丁面向**完全不同的构建**——`resources/app.asar` 单包，主进程为 `out/main/index.js`，preload 为 `out/preload/index.cjs`，标题栏由 preload 注入。因此注入点、打包方式和取令牌方式都不同。

## 行为

- 标题栏中间是 **标签栏 + `设备 ▾`**：`[本机] [h100-02] [h100-01] …`
- 每个设备在**同一个窗口内**打开（原生 `WebContentsView`，位于标题栏下方），**不是新开窗口**；标签页点一下即切换
- **可以同时连多台**：连接之间互不阻塞，可并行建立；连接完成后**不会强行抢占当前画面**，而是出现标签 + 状态提示
- 切回已连接过的设备**不重连、不重载**（页面与隧道保留）
- 标签上的 **✕**：断开该设备（关闭页面与隧道）
- 每个设备行有 **⟳**：**重启远端** `systemd --user` 服务（带确认框），完成后自动等待并重连
- **端口自动检测**：不写死端口；从远端 `~/.dsh/dsh-web-$(hostname).log` 读取 `dsh web: http://127.0.0.1:<端口>/?token=…`（`journalctl --user` 仅作兜底）
- **自动读取 `~/.ssh/config`**：列出已有主机，可点选填入，或按当前端口/服务「导入全部」
- 设备可**新增、编辑、删除**；配置保存在 Electron `userData/ssh-devices.json`
- 跟随明暗主题（暗色下不再是白底白字）

## 为什么不用 `journalctl --user` 取令牌

原补丁依赖 `journalctl --user "_SYSTEMD_INVOCATION_ID=…"`。在目标机器上实测该命令返回：

```
No journal files were opened due to insufficient permissions
```

（该账号读不到 user journal。）因此本补丁改为读取 DSH 自己的启动日志文件——`run-dsh-web.sh` 会 `tee` 到 `~/.dsh/dsh-web-$(hostname).log`；`journalctl` 保留为兜底。并且因为该日志可能包含多次重启的旧令牌，本补丁会**收集候选令牌并逐个用 303 校验**，取真正有效的那个。

## 依赖与适用构建

- DSH Desktop **0.11.1**，`app.asar` 打包构建，`resources/app.asar` 的 SHA-256 必须与 `manifest.json` 完全一致（安装器会校验；不一致会拒绝安装）
- Node.js 22+（安装/卸载只需 `node`）
- 远端：DSH 运行在用户级 systemd 服务（默认 `dsh.service`），SSH 密钥或已解锁的 ssh-agent，主机指纹已确认

## 安装

先**完全退出 DSH Desktop**（托盘 → 退出），然后：

```powershell
$DshInstallDir = 'C:\Users\<你>\AppData\Local\Programs\Deepseek H Desktop\DSH Desktop'
node ./install.mjs check     "$DshInstallDir"     # 只读校验
node ./install.mjs install   "$DshInstallDir"
```

或使用 `Install.ps1`（需要 `pwsh`/PowerShell）：

```powershell
pwsh -NoProfile -File ./Install.ps1 -InstallDir "$DshInstallDir"
```

安装器会：校验 `resources/app.asar` 指纹与全部注入锚点 → 备份原包到 `resources/ssh-device-patch-backup/app.asar` → 生成并写入打过补丁的 `app.asar` → 写 `receipt.json`。

**`resources/app.asar.unpacked` 全程不会被改动。**（这一点很关键：该目录下是原生模块，误删会导致程序无法启动。）

> Windows OpenSSH 8.1 不支持 `ControlMaster` 连接复用（实测会报 `getsockname failed`），因此这里不做复用，而是把「读取端点」与「建立转发」两条 SSH **并行发起**，首次连接耗时约为串行的一半。

## 卸载

退出程序后：

```powershell
node ./install.mjs uninstall "$DshInstallDir"
```

卸载会校验「当前 `app.asar` 必须等于安装时记录的 `patched` 哈希」「备份必须等于原始哈希」，两者都通过才恢复原文件；否则拒绝覆盖并保留备份。设备配置保留在 `userData/ssh-devices.json`。

## 使用

1. 完全重启 DSH Desktop
2. 标题栏点 **`设备 ▾`**
3. 「＋ 添加设备」→ 填 **显示名称 / SSH 别名（或 `user@host`）/ 端口（留空 = 自动）/ 服务名**，或直接点下方 `~/.ssh/config` 里的主机、或用「导入全部」
4. 点设备行 → 连接（状态栏显示「正在连接…」）→ 完成后标题栏出现该设备标签
5. 点标签进入；点 `本机` 回本地；多台可点「全部连接（并行）」

## 测试

```powershell
node ./test-chain.mjs h100-02 19989        # 真实的一次端到端验证
```

`test-chain.mjs` 会真实地：SSH 读取远端端点 → 建立 OpenSSH 本地转发 → 用令牌做 303 交换 → 拉取已认证页面。它只在内存中使用令牌，**不打印也不保存**。

## 实现方式

`lib/asar-patch.mjs` **不依赖任何第三方模块**，按字节处理 `app.asar`：

1. 解析头部（本构建的布局：`[u32 4][u32 headerSize][u32 headerSize-4][u32 headerSize-10][JSON][2 字节填充]`，JSON 从 16 开始，数据区从 `8 + headerSize` 开始）
2. 把两处注入写进 `out/main/index.js` 与 `out/preload/index.cjs`
3. 只改写这两个条目的 `size`/`offset`/`integrity`，**整段原始数据区原样搬运**，两个新文件追加在末尾
4. 因为偏移量是相对数据区起点，且原始数据区被逐字节整体搬运，**其它文件偏移与字节完全不变**（原生模块、第三方包都不受影响）

主进程侧的设备逻辑内联在 `out/main/index.js` 中，**不新增任何 import**（复用该 bundle 已有的 `spawn`/`execFile`/`promisify`/`net` 的 `createServer`/timers 的 `setTimeout`/`createRequire`/`ipcMain`/`app`/`BrowserWindow`/`dialog`），以最大限度降低破坏风险。

## 已知限制

- 远端服务若**反复崩溃重启**（例如每 8 秒一次），其令牌会不断变化，任何时刻都可能已失效——请先修好那台机器
- 首次连接受 SSH 建连速度影响（本环境约 10–15 秒/次），已并行化但仍需等待；界面不冻结
- 面板是画在「本机页面」里的 DOM，而设备是原生视图；因此**打开面板时会临时移走当前设备视图**，关闭后放回（不重连）

## 目录

- `payload/`：两段注入代码与远端探测脚本
- `lib/asar-patch.mjs`：按字节打包 + 注入（零依赖）
- `install.mjs`、`Install.ps1`、`Uninstall.ps1`：校验式安装/恢复
- `manifest.json`：受支持的构建指纹
- `test-chain.mjs`：真实链路验证
