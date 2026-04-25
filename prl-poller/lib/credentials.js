// Loads ./config.json once at startup and provides credential lookup by
// credential_ref. The DB stores only the ref (e.g., 'pilot_trib_bidirectional');
// this module resolves it to actual password / private key material.
//
// Supports:
//   - password auth: { password: "..." }
//   - inline private key: { privateKey: "-----BEGIN ...", passphrase: "..." }
//   - private key from file: { privateKeyPath: "/path/to/key", passphrase: "..." }
//
// If a credential_ref is requested but missing from config.json, throws so the
// caller can mark the run as Failed instead of silently proceeding.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');

let credentials = null;

function load() {
  if (credentials !== null) return credentials;
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      'config.json not found at ' + CONFIG_PATH +
      '. Copy config.example.json -> config.json and fill in real credentials. ' +
      'Then chmod 600 config.json.'
    );
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('config.json is not valid JSON: ' + e.message);
  }
  // Strip _README and other underscore-prefixed metadata keys
  credentials = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k.startsWith('_') || k.startsWith('EXAMPLE_')) continue;
    credentials[k] = v;
  }
  return credentials;
}

// Returns an ssh2-sftp-client connect-options object for the given ref.
// Throws if the ref is not registered.
function lookup(credentialRef) {
  const all = load();
  const entry = all[credentialRef];
  if (!entry) {
    throw new Error(
      'Unknown credential_ref \'' + credentialRef +
      '\'. Add it to config.json. Known refs: [' +
      Object.keys(all).join(', ') + ']'
    );
  }

  const opts = {};

  // Private key trumps password if both are provided
  if (entry.privateKey) {
    opts.privateKey = entry.privateKey;
    if (entry.passphrase) opts.passphrase = entry.passphrase;
  } else if (entry.privateKeyPath) {
    if (!fs.existsSync(entry.privateKeyPath)) {
      throw new Error('privateKeyPath does not exist: ' + entry.privateKeyPath);
    }
    opts.privateKey = fs.readFileSync(entry.privateKeyPath);
    if (entry.passphrase) opts.passphrase = entry.passphrase;
  } else if (entry.password) {
    opts.password = entry.password;
  } else {
    throw new Error(
      'credential_ref \'' + credentialRef +
      '\' must define one of: password, privateKey, privateKeyPath'
    );
  }

  return opts;
}

// List all registered credential_ref values (for /status endpoint diagnostics)
function listRefs() {
  return Object.keys(load());
}

module.exports = { lookup, listRefs };
