# DSH Desktop SSH 设备切换器

[English](./README.md) | 简体中文

本补丁 **v1.0.0** 适配 [anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop) **v2.0.13**，为该桌面应用添加 SSH 设备切换器。桌面端通过 OpenSSH 本地端口转发直接连接远程 DSH 实例，无需中继服务，也无需修改远程 DSH。

`v1.0.0` 是本补丁的发布版本；`v2.0.13` 是它适配的 DSH Desktop 版本。补丁不包含上游桌面应用，需要单独安装匹配的解包版本。安装程序还会核对原始文件的精确哈希，因此仅版本号相同并不代表一定兼容。

## 使用行为

- 全新安装时只有 **此电脑**。点击设备列表旁的 **＋** 添加自己的服务器。
- 点击列表外或切换应用时，设备列表会关闭。添加或编辑设备的二级页面会保持打开，并保留输入内容，直到保存、取消或明确关闭。
- 在桌面应用运行期间，每台远程设备保留各自的页面、SSH 隧道和浏览器会话。从 **A → B → A** 切换时会显示 A 原有的页面，无需重新连接、认证或刷新。保留的后台页面仍会运行并占用资源。
- 首次选择某台设备时会连接一次。重启应用会关闭所有隧道和页面，但设备配置会保留；下次访问时会重新连接。
- SSH 连接失败和远程 DSH 健康检查失败会按设备显示，并给出失败阶段和详情。失败的设备仍保持选中，直到你选择其他设备。重新连接需要明确操作，且只影响该设备。应用请求不会自动重放。
- **断开连接** 会明确关闭该设备的页面和隧道；请先保存尚未提交的工作。修改已有缓存设备的连接地址前，必须先断开连接。
- 远程设备的终端按钮不可用，本机终端仍可使用。刷新、开发者工具和普通重启针对当前选中的设备。远程重启会显示服务器和服务名称、请求确认、仅重启对应的用户服务，然后重新认证。取消不会影响连接。桌面端更新、窗口模式和桌面端恢复仍在本机执行。

## 要求与支持的版本

- [anywhere-labs/dsh-desktop **v2.0.13**](https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.13) 的解包安装，且文件指纹与 `manifest.json` 一致。其他构建版本及 `app.asar` 安装需要单独适配。
- 设备控件使用兼容模式和扩展模式中的独立标题栏。主要支持 Windows。macOS 代码路径尚未验证；增强模式和 Linux 会显示限制提示。
- 在 Windows 上安装时，需要通过 PATH 找到 Node.js 22+、PowerShell 7 和 OpenSSH。
- 远程 DSH 监听回环地址端口，并作为 systemd 用户服务运行，通常为 `dsh.service`。SSH 账号需要能够读取该服务当前的 journal。其他服务管理器目前需要额外的自动凭据适配；没有手动输入令牌的登录表单。
- 使用 SSH 密钥或已解锁的 ssh-agent 认证。主机密钥应已通过常规 SSH 设置完成验证。用户名、SSH 端口、密钥和跳板机由 SSH 配置管理。本仓库不包含密码或私钥。

## 安装

下载或克隆本仓库，在仓库根目录打开 PowerShell 7，并通过托盘菜单完全退出 DSH Desktop。设置本机安装目录：

```powershell
$DshInstallDir = Read-Host 'DSH Desktop installation directory'
node ./install.mjs check $DshInstallDir
pwsh -NoProfile -File ./Install.ps1 -InstallDir $DshInstallDir
```

安装程序会检查应用版本、原始文件的精确哈希和补丁锚点；桌面端仍在运行时会拒绝修改。它会修改两个原始文件，并将补丁文件安装到 `resources/app/lib/device-switch/`。原始文件和安装记录保存在 `resources/app/ssh-device-patch-backup/`；请保留这个目录，以便卸载。

更新已安装的补丁时，先退出桌面端，按照安装记录卸载旧补丁，再安装新补丁。如果原始文件或补丁文件后来被改动，卸载程序会停止，避免覆盖这些改动。

## 添加设备

打开标题栏中的设备列表，点击 **＋**。输入显示名称、SSH 别名（如 `dev-server`，也可使用 `user@server.example`）和远程 DSH 端口。如果用户服务名称不是 `dsh.service`，可在高级选项中修改。

凭据通过 SSH 从当前 systemd 服务实例自动获取，经隧道交换为浏览器会话，不会写入配置文件或控制台输出。每个设备及连接地址使用独立的 Electron 浏览器会话。远程页面无法使用本地桌面端具有特权的文件路径桥接，也不会收到本地认证请求头。

## 卸载

退出桌面端后运行：

```powershell
pwsh -NoProfile -File ./Uninstall.ps1 -InstallDir $DshInstallDir
```

卸载程序会先验证已安装文件和原始备份，再逐字节恢复原始文件。如果应用已经更新或文件被手动修改，它会拒绝覆盖这些改动。升级 DSH Desktop 前应先卸载补丁；在新版本上重新安装前，必须重新检查补丁兼容性。

## 配置与隐私

设备配置保存在本地应用 Electron 的 `userData/ssh-devices.json`。Cookie 和页面存储保留在各设备独立的 Electron 会话中。这些数据不会复制到补丁目录或发布压缩包。公开发布内容仅包含源码、安装程序、测试、清单和文档，不包含默认服务器、个人路径、私钥、日志或截图。

## 测试

让测试指向已有的 DSH Desktop 安装目录；若补丁已安装，测试会使用原始备份：

```powershell
$env:DSH_INSTALL_DIR = $DshInstallDir
node --test ./test.mjs ./controller.test.mjs
node ./verify-ssh.mjs dev-server 3080 dsh.service
```

自动化测试覆盖 A/B 会话及草稿保留、独立重连、后台断开、编辑页面固定、应用重启、安装回滚保护和逐字节卸载。`verify-ssh.mjs` 需要明确指定 SSH 目标；它会建立临时真实隧道，完成认证、加载页面并调用只读的 DSH API，不会修改远程服务或会话。

原生 Electron 端到端验证与模拟控制器测试分开进行。HTTP、SSE 和 WebSocket 流量经由 OpenSSH 的 TCP 转发；补丁不实现额外的 HTTP 代理。

## 源码结构

- `payload/`：运行时控制器、SSH 传输和标题栏界面。
- `install.mjs`、`Install.ps1`、`Uninstall.ps1`：经过校验的安装与恢复流程。
- `manifest.json`：受支持原始版本的文件指纹。
- `*.test.mjs`、`test.mjs`、`verify-ssh.mjs`：自动化及真实连接检查。

Electron API：[WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)、[BaseWindow 资源管理](https://www.electronjs.org/docs/latest/api/base-window)。
