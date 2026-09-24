# DSH Desktop SSH Device Switcher

English | [简体中文](./README.zh-CN.md)

Patch **v1.0.0** for [anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop) **v2.0.13**. This patch adds an SSH device switcher to that desktop application. The desktop connects directly to a remote DSH instance through OpenSSH local port forwarding. No relay service or remote DSH modifications are required.

`v1.0.0` is this patch's release version; `v2.0.13` is the DSH Desktop version it targets. The patch does not include the upstream desktop application. Install the matching unpacked DSH Desktop build separately. The installer also checks the exact original file hashes, so the version number alone does not establish compatibility.

## Behavior

- A fresh installation contains only **This computer**. Add your own servers using the **＋** button beside the device list.
- The device list closes when clicking outside or switching applications. The second-level add/edit page stays open, preserving input until you save, cancel or explicitly close it.
- Each remote device keeps its own page, SSH tunnel and browser session for the lifetime of the desktop application. Switching **A → B → A** shows the original A page without reconnecting, reauthenticating or refreshing. Background pages remain active and consume resources while retained.
- Selecting an unvisited device connects once. Restarting the application closes all tunnels and pages; device configuration is retained, and the next visit connects again.
- SSH failures and remote DSH health-check failures are reported per device, including the failing stage and details. Failed devices remain selected until you choose another device. Reconnection is explicit and affects only that device. No application requests are automatically replayed.
- **Disconnect** explicitly closes a device's page and tunnel; save any unsent work first. Editing the endpoint of a cached device requires disconnecting it first.
- The terminal button is disabled for remote devices and remains available locally. Refresh, developer tools and ordinary restart follow the selected device. Remote restart names the server and service, asks for confirmation, restarts only that user service and reauthenticates. Cancelling does not affect its connection. Desktop updates, window modes and desktop recovery remain local operations.

## Requirements and supported builds

- [anywhere-labs/dsh-desktop **v2.0.13**](https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.13), unpacked installation, matching the file fingerprints in `manifest.json`. Different builds and `app.asar` installations need separate adaptation.
- The device control uses the independent titlebar in compatibility and extended modes. Windows is the primary target. The macOS code path is not verified; enhanced mode and Linux display a limitation warning.
- Node.js 22+, PowerShell 7 and OpenSSH available through PATH for installation on Windows.
- Remote DSH listening on a loopback port and running under a user systemd service, normally `dsh.service`. The SSH account must be able to read that service's current journal. Other service managers currently require an additional automatic credential adapter; there is no manual-token login form.
- SSH key or unlocked ssh-agent authentication. Host keys must already be verified through normal SSH setup. SSH configuration controls usernames, SSH ports, keys and jump hosts. No password or private key is included in this repository.

## Install

Download or clone this repository, open PowerShell 7 in its root directory, and fully exit DSH Desktop through its tray menu. Set the installation path for your machine:

```powershell
$DshInstallDir = Read-Host 'DSH Desktop installation directory'
node ./install.mjs check $DshInstallDir
pwsh -NoProfile -File ./Install.ps1 -InstallDir $DshInstallDir
```

The installer checks the application version, exact original file hashes and patch anchors. It refuses to modify a running desktop. It modifies two original files and installs its own files under `resources/app/lib/device-switch/`. Original files and the installation receipt are saved in `resources/app/ssh-device-patch-backup/`; retain this directory for uninstalling.

To update a previously installed patch, exit the desktop, uninstall using its recorded receipt, then install the new patch. A modified original or payload file causes uninstall to stop rather than overwrite subsequent changes.

## Add a device

Open the titlebar device list and click **＋**. Enter a display name, an SSH alias such as `dev-server` (or `user@server.example`), and the remote DSH port. The advanced section contains the user service name if different from `dsh.service`.

Credentials are obtained automatically over SSH from the current systemd invocation, exchanged through the tunnel for a browser session, and kept out of configuration files and console output. Each device/endpoint has an isolated Electron browser session. The remote page does not receive the local desktop's privileged file-path bridge or authentication header.

## Uninstall

After exiting the desktop:

```powershell
pwsh -NoProfile -File ./Uninstall.ps1 -InstallDir $DshInstallDir
```

The installer verifies both installed files and original backups before restoring the original bytes. If the application has been updated or manually edited, it refuses to overwrite those changes. Uninstall before upgrading DSH Desktop; the patch must be reviewed against a new build before reinstalling.

## Configuration and privacy

Device configuration is stored in the local application's Electron `userData/ssh-devices.json`. Cookies and page storage remain in its per-device Electron sessions. Neither is copied into the patch directory or release archive. A public release contains source, installer, tests, manifest and documentation only, with no default server, personal paths, private keys, logs or screenshots.

## Testing

Point tests at an existing DSH Desktop installation (the original backups are used if the patch is installed):

```powershell
$env:DSH_INSTALL_DIR = $DshInstallDir
node --test ./test.mjs ./controller.test.mjs
node ./verify-ssh.mjs dev-server 3080 dsh.service
```

Automated tests cover retained A/B sessions and drafts, isolated reconnection, background disconnects, editor pinning, application restart, installation rollback protection and byte-for-byte uninstall. `verify-ssh.mjs` requires an explicitly supplied SSH destination; it creates a temporary real tunnel, authenticates, loads the page and calls a read-only DSH API. It does not edit remote services or conversations.

Native Electron end-to-end validation is separate from mocked controller tests. HTTP, SSE and WebSocket traffic use OpenSSH's TCP forwarding; the patch does not implement a separate HTTP proxy.

## Source layout

- `payload/`: runtime controller, SSH transport and titlebar UI.
- `install.mjs`, `Install.ps1`, `Uninstall.ps1`: verified installation and restoration.
- `manifest.json`: supported original build fingerprints.
- `*.test.mjs`, `test.mjs`, `verify-ssh.mjs`: automated and live-connection checks.

Electron APIs: [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [BaseWindow resource management](https://www.electronjs.org/docs/latest/api/base-window).
