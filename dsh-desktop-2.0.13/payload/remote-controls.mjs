import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateDevice, sshOptions } from './ssh.mjs';
const exec = promisify(execFile);

export async function restartService(device) {
  validateDevice(device);
  try {
    await exec('ssh', [...sshOptions(), device.ssh, `systemctl --user restart ${device.unit}`], { windowsHide: true, timeout: 60000 });
  } catch (error) {
    throw new Error(`重启 ${device.name} / ${device.unit} 失败：${error.stderr?.trim() || error.code || error.message}`);
  }
}
