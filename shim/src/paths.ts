// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.

import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Returns the platform-specific directory that UEMCP instances write their
 * discovery files into. Must match the UE plugin's FUEMCPDiscoveryFile.
 */
export function getDiscoveryDir(): string {
  const p = process.platform;
  if (p === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error('LOCALAPPDATA environment variable is not set');
    }
    return join(localAppData, 'UnrealMcp', 'instances');
  }
  if (p === 'darwin') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'UnrealMcp',
      'instances',
    );
  }
  const xdgState = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(xdgState, 'UnrealMcp', 'instances');
}
