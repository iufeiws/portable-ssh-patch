# portable-ssh-patch

给 **DSH Desktop** 用的 SSH 设备切换补丁。每个补丁只对应一个具体的 DSH Desktop 构建，**两者不通用**：布局不同（解包后的 `resources/app` 与单个 `resources/app.asar`）、桌面包名不同（`dsh-plugin-desktop` 与 `dsh-desktop`），因此注入点、打包方式和凭证获取方式都不一样。

| DSH Desktop 构建 | 安装布局 | 补丁版本 | 目录 |
| --- | --- | --- | --- |
| `2.0.13`（`dsh-plugin-desktop`） | 解包 `resources/app` | `v1.0.1` | [`dsh-desktop-2.0.13/`](./dsh-desktop-2.0.13) |
| `0.11.1`（`dsh-desktop`） | 单个 `resources/app.asar` | `v1.0.0` | [`dsh-desktop-0.11.1/`](./dsh-desktop-0.11.1) |

先确认你的 DSH Desktop 版本，再按对应目录里的 README 操作：

- `dsh-desktop-2.0.13/` — [English](./dsh-desktop-2.0.13/README.md) | [简体中文](./dsh-desktop-2.0.13/README.zh-CN.md)
- `dsh-desktop-0.11.1/` — [English](./dsh-desktop-0.11.1/README.md) | [简体中文](./dsh-desktop-0.11.1/README.zh-CN.md)

## 两个补丁共同做的事

两者加的是同一个面向用户的功能：让桌面端通过 **OpenSSH 本地端口转发**连到多台远端 DSH，并在标题栏上切换。不需要中转服务，也不改动远端 DSH。

- 标题栏上一条标签栏，每台设备一个页面，都在同一个窗口里打开
- 切回已经访问过的设备不会重连、不会刷新
- 多台设备可以同时保持连接
- 设备的增、改、删都在标题栏里完成，配置存在 Electron 的 `userData/ssh-devices.json`
- 每台设备可单独重启远端服务，重启前有确认弹窗

具体行为、依赖和已知限制**按目录分别记录**，因为两个构建之间确实存在差异。

## 依赖

- 安装器需要 **Node.js 22+**——`install.mjs` 只依赖 `node`，Windows 上还需要 PowerShell
- **OpenSSH** 在 `PATH` 里，已配置密钥或已解锁的 `ssh-agent`，主机密钥已通过常规 SSH 流程校验
- 远端 DSH 以**用户级 systemd 服务**运行，通常名为 `dsh.service`
- 主要目标是 Windows；macOS 分支未经验证

两个补丁都不包含上游桌面程序本体，也都不含密码或私钥。

## 通用用法

两个目录的命令形式一致，**请在对应子目录里执行**：

```powershell
node ./install.mjs check   "<DSH Desktop 安装目录>"
node ./install.mjs install "<DSH Desktop 安装目录>"
node ./install.mjs uninstall "<DSH Desktop 安装目录>"
```

安装器会校验该目录 `manifest.json` 里记录的原始文件哈希，拒绝修改正在运行的桌面程序，并保留备份与安装回执，卸载时是干净还原。只对版本号不足以判定兼容性，必须以文件指纹为准。

## 仓库结构

```
.
├── dsh-desktop-2.0.13/   补丁 v1.0.1 —— 解包 resources/app 构建
└── dsh-desktop-0.11.1/   补丁 v1.0.0 —— resources/app.asar 构建
```
