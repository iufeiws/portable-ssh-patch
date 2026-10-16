# DSH Desktop SSH device switcher (`app.asar` build)

English | [简体中文](./README.zh-CN.md)

> Part of [portable-ssh-patch](../README.md). The unpacked `resources/app` build is covered by the sibling [`dsh-desktop-2.0.13/`](../dsh-desktop-2.0.13) directory.

Adds an SSH device switcher to **DSH Desktop `0.11.1` (the `app.asar` build)**.

> This is not a port of the [anywhere-labs/dsh-desktop v2.0.13](https://github.com/anywhere-labs/dsh-desktop) patch. That one targets an **unpacked** `resources/app/lib/...` build (`WebContentsView` chrome view + `compatibility-chrome.html`). This one targets a **different build entirely**: a single `resources/app.asar`, main process bundled as `out/main/index.js`, preload as `out/preload/index.cjs`, with the Windows titlebar injected by the preload. Injection points, packaging and credential discovery all differ.

## Behaviour

- A **tab strip + `设备 ▾`** sits in the titlebar: `[this computer] [h100-02] [h100-01] …`
- Each device opens **inside the same window** (native `WebContentsView` below the titlebar) — **not a new window**; clicking a tab switches instantly
- **Several devices connect at the same time**; connects do not block each other, and a finished connect **does not steal the current view** (a tab plus a status line appears instead)
- Switching back to a device already visited **does not reconnect or reload**
- **✕** on a tab disconnects that device (page + tunnel)
- **⟳** on a device restarts the remote `systemd --user` service (with a confirmation dialog) and then automatically waits and reconnects
- **Port is auto-detected** — read from the remote `~/.dsh/dsh-web-$(hostname).log` (`dsh web: http://127.0.0.1:<port>/?token=…`), with `journalctl --user` only as a fallback
- **`~/.ssh/config` is read automatically**: hosts can be picked or bulk-imported
- Devices can be **added, edited and deleted**; configuration lives in Electron `userData/ssh-devices.json`
- Follows light/dark theme

## Why not `journalctl --user`

The upstream patch reads the login token with `journalctl --user "_SYSTEMD_INVOCATION_ID=…"`. On the target machines that command returns:

```
No journal files were opened due to insufficient permissions
```

so the token is read from the DSH startup log instead (`run-dsh-web.sh` tees to `~/.dsh/dsh-web-$(hostname).log`), keeping `journalctl` as a fallback. Because that log accumulates tokens from previous runs, candidates are **validated one by one against a 303 response** and the first valid one is used.

## Requirements

- DSH Desktop **0.11.1**, `app.asar` layout, with `resources/app.asar` matching the SHA-256 in `manifest.json` (the installer refuses anything else)
- Node.js 22+ (install/uninstall only need `node`)
- Remotely: DSH under a user systemd unit (default `dsh.service`), SSH key or unlocked ssh-agent, verified host keys

## Install

Fully exit DSH Desktop (tray → exit) first:

```powershell
$DshInstallDir = 'C:\Users\<you>\AppData\Local\Programs\Deepseek H Desktop\DSH Desktop'
node ./install.mjs check   "$DshInstallDir"
node ./install.mjs install "$DshInstallDir"
```

The installer verifies the archive fingerprint and every injection anchor, backs the original up to `resources/ssh-device-patch-backup/app.asar`, writes the patched archive and a `receipt.json`.

**`resources/app.asar.unpacked` is never touched** — it holds native modules, and damaging it prevents the app from starting.

> Windows OpenSSH 8.1 has no `ControlMaster` multiplexing (it fails with `getsockname failed`), so instead the endpoint read and the port forward are started **in parallel**, roughly halving first-connect time.

## Uninstall

Exit the app, then:

```powershell
node ./install.mjs uninstall "$DshInstallDir"
```

Uninstall verifies that the current archive equals the recorded `patched` hash and that the backup equals the original hash before restoring; otherwise it refuses and keeps the backup. Device configuration stays in `userData/ssh-devices.json`.

## Testing

```powershell
node ./test-chain.mjs h100-02 19989
```

`test-chain.mjs` really does: read the remote endpoint over SSH → open an OpenSSH local forward → exchange the token (303) → fetch the authenticated page. The token is used in memory only and is never printed or saved.

## How it works

`lib/asar-patch.mjs` uses **no third-party modules** and works on the archive byte by byte:

1. Parse the header (this build: `[u32 4][u32 headerSize][u32 headerSize-4][u32 headerSize-10][JSON][2-byte pad]`, JSON at 16, data at `8 + headerSize`)
2. Apply both injections to `out/main/index.js` and `out/preload/index.cjs`
3. Rewrite only those two entries' `size`/`offset`/`integrity`, **copy the entire original data blob verbatim**, and append the two modified files
4. Offsets are relative to the blob start and the blob is copied untouched, so **every other file keeps its bytes and offset**

The main-process device logic is inlined with **no new imports** (reusing the bundle's existing `spawn`/`execFile`/`promisify`, `net` `createServer`, timers `setTimeout`, `createRequire`, `ipcMain`/`app`/`BrowserWindow`/`dialog`) to keep breakage risk minimal.

## Known limitations

- A remote service that **crash-loops** (e.g. every 8 seconds) invalidates its token continuously; fix that host first
- First connect depends on SSH setup time (~10–15 s per connection here); it is parallelised but still needs waiting, and the UI does not freeze
- The dropdown is DOM in the local page while devices are native views, so opening it **temporarily detaches the active view** and re-attaches it on close (no reconnect)

## Layout

- `payload/` — the two injections and the remote discovery script
- `lib/asar-patch.mjs` — byte-level packing + injections (zero dependencies)
- `install.mjs`, `Install.ps1`, `Uninstall.ps1` — verified install/restore
- `manifest.json` — supported build fingerprints
- `test-chain.mjs` — live end-to-end check
