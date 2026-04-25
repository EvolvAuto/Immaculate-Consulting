// SFTP wrapper around ssh2-sftp-client.
//
// Connection lifecycle is short-lived: open per-operation, close on completion
// or error. This sacrifices some throughput for reliability - connection state
// in serverless-ish environments is more failure-prone than fresh connects.
//
// Always wraps operations in try/finally to guarantee end() runs even on error.

const SftpClient = require('ssh2-sftp-client');

const DEFAULT_TIMEOUT_MS = 60000; // 60s per operation

// Connect using endpoint metadata + a credential options object from credentials.lookup().
// Returns a connected SftpClient instance - caller must invoke .end().
async function connect(endpoint, credOpts) {
  const sftp = new SftpClient();
  await sftp.connect({
    host: endpoint.host,
    port: endpoint.port || 22,
    username: endpoint.username,
    readyTimeout: DEFAULT_TIMEOUT_MS,
    ...credOpts,
  });
  return sftp;
}

// List files in remoteDir matching a regex (or all files if regex is null).
// Returns array of { name, size, modifyTime, fullPath }.
async function listMatchingFiles(sftp, remoteDir, filenameRegex) {
  const entries = await sftp.list(remoteDir);
  const re = filenameRegex ? new RegExp(filenameRegex) : null;
  return entries
    .filter(e => e.type === '-') // regular files only
    .filter(e => !re || re.test(e.name))
    .map(e => ({
      name: e.name,
      size: e.size,
      modifyTime: e.modifyTime,
      fullPath: remoteDir.replace(/\/+$/, '') + '/' + e.name,
    }));
}

// Download a file by path. Returns Buffer.
async function downloadFile(sftp, remotePath) {
  // ssh2-sftp-client get() with no destination returns the contents as Buffer
  // when called with { encoding: null } - using its second-arg shortcut here.
  const buffer = await sftp.get(remotePath);
  if (!Buffer.isBuffer(buffer)) {
    // Older versions return Stream; coerce
    throw new Error('Unexpected non-Buffer return from sftp.get(); upgrade ssh2-sftp-client to >=11');
  }
  return buffer;
}

// Upload a Buffer to remotePath, overwriting if it exists.
async function uploadFile(sftp, remotePath, buffer) {
  // sftp.put accepts Buffer | string | Stream
  await sftp.put(buffer, remotePath);
}

// Move a file from one remote path to another (used to archive processed inbound files).
async function moveFile(sftp, fromPath, toPath) {
  await sftp.rename(fromPath, toPath);
}

// Always wrap operations in this helper to guarantee cleanup.
async function withConnection(endpoint, credOpts, fn) {
  let sftp = null;
  try {
    sftp = await connect(endpoint, credOpts);
    return await fn(sftp);
  } finally {
    if (sftp) {
      try { await sftp.end(); } catch (e) { /* swallow cleanup errors */ }
    }
  }
}

module.exports = {
  connect,
  listMatchingFiles,
  downloadFile,
  uploadFile,
  moveFile,
  withConnection,
};
