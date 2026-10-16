import fs from 'node:fs';
import path from 'node:path';

// Refuse a second writer. Never automatically steal a lock based on a PID check:
// PIDs can be reused, and the directory may be shared with another host.
export function acquireProcessLock(directory) {
  const filename = path.join(directory, 'server.lock');
  let fd;
  try { fd = fs.openSync(filename, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Data directory is locked. Stop the other server first. After a crash, verify no server uses this folder before removing server.lock.');
    throw error;
  }
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
  catch (error) { fs.unlinkSync(filename); throw error; }
  finally { fs.closeSync(fd); }
  let released = false;
  return () => {
    if (!released) {
      released = true;
      try { fs.unlinkSync(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  };
}
