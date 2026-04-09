// test/plaintextAudit.js
// ---------------------------------------------------------------------------
// AUTH-01 enforcement script. Reads the userData config.json and main.log
// after a manual first-run cycle and asserts the known-fake test credentials
// never appear in plaintext.
//
// Usage:
//   1. Delete %AppData%/Bee Strong POS/config.json and logs/main.log
//   2. Start the app (`npm start`), submit the first-run credentials overlay
//      with these EXACT values:
//        username: bsk-audit-USER-9f3c2a1d@example.invalid
//        password: bsk-audit-PASS-9f3c2a1d-aB%cD!eF
//        PIN:      1234
//   3. Wait until the state log shows creds-saved (or abort if login attempt)
//   4. Close the app.
//   5. Run `node test/plaintextAudit.js`
//   6. Exit code 0 = pass; non-zero = plaintext leak detected.
//
// The script also scans the environment for MAGICLINE_* / BSF_CREDENTIALS
// variables to catch the other classic plaintext leak path.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_NAME = 'Bee Strong POS';

function userDataDir() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      APP_NAME
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  }
  return path.join(os.homedir(), '.config', APP_NAME);
}

const FAKE_USER_FRAGMENT = 'bsk-audit-USER';
const FAKE_PASS_FRAGMENT = 'bsk-audit-PASS';

function scanFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error('SKIP ' + label + ': file does not exist at ' + filePath);
    return { exists: false, leaks: 0 };
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const leaks = [];
  if (content.includes(FAKE_USER_FRAGMENT)) {
    leaks.push('username fragment "' + FAKE_USER_FRAGMENT + '"');
  }
  if (content.includes(FAKE_PASS_FRAGMENT)) {
    leaks.push('password fragment "' + FAKE_PASS_FRAGMENT + '"');
  }
  if (leaks.length > 0) {
    console.error('FAIL ' + label + ' (' + filePath + '): ' + leaks.join(', '));
  } else {
    console.log('PASS ' + label + ' (' + filePath + ')');
  }
  return { exists: true, leaks: leaks.length };
}

function scanEnv() {
  const bad = [];
  for (const k of Object.keys(process.env)) {
    if (/^MAGICLINE_/i.test(k)) bad.push(k);
    if (k === 'BSF_CREDENTIALS') bad.push(k);
  }
  if (bad.length > 0) {
    console.error('FAIL env: credentials-shaped vars present: ' + bad.join(', '));
    return bad.length;
  }
  console.log('PASS env: no MAGICLINE_* or BSF_CREDENTIALS vars');
  return 0;
}

function main() {
  const base = userDataDir();
  console.log('Scanning userData: ' + base);

  const configPath = path.join(base, 'config.json');
  const logPath = path.join(base, 'logs', 'main.log');

  let totalLeaks = 0;
  totalLeaks += scanFile(configPath, 'config.json').leaks;
  totalLeaks += scanFile(logPath, 'main.log').leaks;
  totalLeaks += scanEnv();

  // Scan any rotated log files too (main.old.log, main.log.old, etc.)
  const logsDir = path.join(base, 'logs');
  if (fs.existsSync(logsDir)) {
    const entries = fs.readdirSync(logsDir);
    for (const e of entries) {
      if (e === 'main.log') continue;
      if (e.endsWith('.log') || e.includes('.log.')) {
        totalLeaks += scanFile(path.join(logsDir, e), 'rotated log ' + e).leaks;
      }
    }
  }

  if (totalLeaks === 0) {
    console.log('');
    console.log('OK — zero plaintext leaks detected. AUTH-01 assertion passes.');
    process.exit(0);
  } else {
    console.error('');
    console.error(
      'FAIL — ' + totalLeaks + ' plaintext leak(s) detected. AUTH-01 assertion FAILS.'
    );
    process.exit(1);
  }
}

main();
