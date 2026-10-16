# portable-ssh-patch

SSH device switcher patches for **DSH Desktop**. Each patch targets one concrete DSH Desktop build. They are **not interchangeable**: the builds differ in layout (an unpacked `resources/app` versus a single `resources/app.asar`), in the desktop package they ship (`dsh-plugin-desktop` versus `dsh-desktop`), and therefore in injection points, packaging and credential discovery.

| DSH Desktop build | Install layout | Patch version | Directory |
| --- | --- | --- | --- |
| `2.0.13` (`dsh-plugin-desktop`) | unpacked `resources/app` | `v1.0.1` | [`dsh-desktop-2.0.13/`](./dsh-desktop-2.0.13) |
| `0.11.1` (`dsh-desktop`) | single `resources/app.asar` | `v1.0.0` | [`dsh-desktop-0.11.1/`](./dsh-desktop-0.11.1) |

Find your DSH Desktop version, then follow the README in the matching directory:

- `dsh-desktop-2.0.13/` — [English](./dsh-desktop-2.0.13/README.md) | [简体中文](./dsh-desktop-2.0.13/README.zh-CN.md)
- `dsh-desktop-0.11.1/` — [English](./dsh-desktop-0.11.1/README.md) | [简体中文](./dsh-desktop-0.11.1/README.zh-CN.md)

## What both patches do

Both add the same user-facing feature: connect the desktop to several remote DSH instances through **OpenSSH local port forwarding** and switch between them from the titlebar. No relay service, and no modification of the remote DSH.

- A tab strip with one page per device, opened in the same window
- Switching back to an already-visited device does not reconnect or reload
- Several devices stay connected at the same time
- Devices are added, edited and deleted from the titlebar; configuration lives in Electron `userData/ssh-devices.json`
- Per-device remote service restart from the titlebar, with confirmation

Exact behaviour, requirements and known limitations are documented **per directory**, because they genuinely differ between the two builds.

## Requirements

- **Node.js 22+** for the installer — `install.mjs` needs `node` only, plus PowerShell on Windows
- **OpenSSH** on `PATH`, with keys or an unlocked `ssh-agent`, and host keys already verified through normal SSH setup
- Remote DSH running under a **user systemd unit**, normally `dsh.service`
- Windows is the primary target; the macOS code path is not verified

Neither patch includes the upstream desktop application, and neither ships a password or private key.

## Common usage

Entry points have the same shape in both directories. Run them **from inside the matching subdirectory**:

```powershell
node ./install.mjs check   "<DSH Desktop installation directory>"
node ./install.mjs install "<DSH Desktop installation directory>"
node ./install.mjs uninstall "<DSH Desktop installation directory>"
```

Each installer verifies the exact original file hashes recorded in that directory's `manifest.json`, refuses to modify a running desktop, and keeps a backup plus an installation receipt so that uninstall is a clean restore. A version number alone never establishes compatibility — the file fingerprints do.

## Repository layout

```
.
├── dsh-desktop-2.0.13/   patch v1.0.1 — unpacked resources/app build
└── dsh-desktop-0.11.1/   patch v1.0.0 — resources/app.asar build
```
