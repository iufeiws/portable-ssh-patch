import { app, WebContentsView, dialog, shell } from 'electron';
import { restartService } from './remote-controls.mjs';
import { startTunnel, readToken } from './ssh.mjs';
import { DeviceController as Controller } from './controller-core.mjs';

export class DeviceController extends Controller {
  constructor(owner) {
    super(owner, { app, WebContentsView, startTunnel, readToken, restartService,
      openExternal: url => shell.openExternal(url),
      showLinkError: message => dialog.showErrorBox('无法打开外部链接', message),
      confirmRestart: async device => (await dialog.showMessageBox(owner.window, {
        type: 'warning', title: `重启远端 DSH — ${device.name}`,
        message: `重启 ${device.name} 的 DSH 服务？`,
        detail: `SSH：${device.ssh}\n服务：${device.unit}\n这会中断该服务器正在执行的任务。重启后自动重新建立登录会话。`,
        buttons: ['取消', '重启远端 DSH'], defaultId: 0, cancelId: 0, noLink: true
      })).response === 1
    });
  }
}
