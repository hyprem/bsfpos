// phase3-kiosk-probes.js
// ---------------------------------------------------------------------------
// Bee Strong POS — Phase 3 Plan 03-09 Kiosk Hardware Probes
//
// Runs the two hardware-dependent probes that Plan 03-09 requires and writes
// the results into phase3-kiosk-probes-results.txt next to this script.
//
// Probe C: crypto.scryptSync median runtime at N=16384 (5 samples)
//          → decides whether src/main/adminPin.js SCRYPT_PARAMS.N stays at
//            16384 or gets retuned to 8192 or 32768.
//
// Probe A: locate TabTip.exe + attempt a manual launch
//          → confirms the manual fallback path the credentials overlay
//            "Tastatur" buttons depend on. The auto-invoke half is a
//            human visual check — see on-screen instructions at the end.
//
// Usage:
//   1. Install Node.js LTS on the kiosk (https://nodejs.org, default options).
//   2. From a cmd.exe window:  node phase3-kiosk-probes.js
//      Or double-click run-probes.cmd in this folder.
//   3. Copy phase3-kiosk-probes-results.txt back to the dev machine.
// ---------------------------------------------------------------------------

'use strict';

const crypto = require('crypto');
const { execSync, exec } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const BAR = '='.repeat(64);

function banner(title) {
  console.log('');
  console.log(BAR);
  console.log('  ' + title);
  console.log(BAR);
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// System info
// ---------------------------------------------------------------------------

banner('Bee Strong POS — Phase 3 Kiosk Probes');
console.log('  Date: ' + new Date().toISOString());
console.log('  Hostname: ' + os.hostname());
console.log('  OS: ' + os.type() + ' ' + os.release() + ' ' + os.arch());
console.log('  Node: ' + process.version);

let cpuModel = 'unknown';
const wmicOut = safeExec('wmic cpu get name /format:value');
if (wmicOut) {
  const match = wmicOut.match(/Name=(.+)/);
  if (match) cpuModel = match[1].trim();
}
if (cpuModel === 'unknown' && os.cpus().length > 0) {
  cpuModel = os.cpus()[0].model;
}
console.log('  CPU: ' + cpuModel);
console.log('  Total RAM: ' + (os.totalmem() / 1024 / 1024 / 1024).toFixed(1) + ' GB');

// ---------------------------------------------------------------------------
// Current Windows user (useful for Assigned Access vs. regular account check)
// ---------------------------------------------------------------------------

const currentUser = safeExec('whoami') || '(unknown)';
console.log('  Current user: ' + currentUser);

// ---------------------------------------------------------------------------
// Probe C — scrypt benchmark
// ---------------------------------------------------------------------------

banner('PROBE C — scrypt CPU benchmark');
console.log('  crypto.scryptSync median runtime at N=16384 (5 samples)');
console.log('  Target window: 50-250 ms');
console.log('');

const scryptSamples = [];
for (let i = 0; i < 5; i++) {
  const salt = crypto.randomBytes(16);
  const t0 = process.hrtime.bigint();
  crypto.scryptSync('test-pin-1234', salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  scryptSamples.push(ms);
  console.log('  sample ' + (i + 1) + ': ' + ms.toFixed(1) + ' ms');
}

const sorted = scryptSamples.slice().sort((a, b) => a - b);
const scryptMedian = sorted[2];
console.log('');
console.log('  median: ' + scryptMedian.toFixed(1) + ' ms');

let chosenN;
let nRationale;
if (scryptMedian < 50) {
  chosenN = 32768;
  nRationale = 'median < 50 ms — CPU faster than expected; crank up N';
} else if (scryptMedian > 250) {
  chosenN = 8192;
  nRationale = 'median > 250 ms — CPU slower than expected; back off N';
} else {
  chosenN = 16384;
  nRationale = 'median inside 50-250 ms target window — keep default';
}

console.log('');
console.log('  VERDICT: chosen N = ' + chosenN);
console.log('  Rationale: ' + nRationale);

// ---------------------------------------------------------------------------
// Probe A — TabTip locate + manual launch
// ---------------------------------------------------------------------------

banner('PROBE A — TabTip touch keyboard');

const candidatePaths = [
  'C:\\Program Files\\Common Files\\microsoft shared\\ink\\TabTip.exe',
  'C:\\Program Files (x86)\\Common Files\\microsoft shared\\ink\\TabTip.exe',
];
let tabtipPath = null;
for (const p of candidatePaths) {
  if (fs.existsSync(p)) {
    tabtipPath = p;
    break;
  }
}
if (!tabtipPath) {
  console.log('  TabTip.exe not at the default ink\\ paths.');
  console.log('  Searching "where /r C:\\Program Files TabTip.exe" ...');
  const whereOut = safeExec('where /r "C:\\Program Files" TabTip.exe');
  if (whereOut) {
    const firstLine = whereOut.split(/\r?\n/)[0].trim();
    if (firstLine && fs.existsSync(firstLine)) {
      tabtipPath = firstLine;
    }
  }
}

if (tabtipPath) {
  console.log('  TabTip.exe found at:');
  console.log('    ' + tabtipPath);
  console.log('');
  console.log('  Launching TabTip.exe now via child_process.exec ...');
  try {
    exec('"' + tabtipPath + '"');
    console.log('  → Launch command issued.');
    console.log('  → Look at the screen: did the Windows touch keyboard appear?');
  } catch (e) {
    console.log('  Launch failed: ' + (e && e.message));
  }
} else {
  console.log('  TabTip.exe NOT FOUND on this machine.');
  console.log('  Both the touch-keyboard auto-invoke and manual-launch paths are unusable.');
  console.log('  This is a blocking finding — report it and Plan 03-09 will halt.');
}

// ---------------------------------------------------------------------------
// Write results file
// ---------------------------------------------------------------------------

const results = {
  phase: '03',
  plan: '03-09',
  date: new Date().toISOString(),
  system: {
    hostname: os.hostname(),
    os: os.type() + ' ' + os.release() + ' ' + os.arch(),
    node: process.version,
    cpu: cpuModel,
    ram_gb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
    current_user: currentUser,
  },
  probe_c_scrypt: {
    samples_ms: scryptSamples.map((s) => Number(s.toFixed(1))),
    sorted_ms: sorted.map((s) => Number(s.toFixed(1))),
    median_ms: Number(scryptMedian.toFixed(1)),
    chosen_N: chosenN,
    rationale: nRationale,
  },
  probe_a_tabtip: {
    found_path: tabtipPath,
    manual_launch_attempted: !!tabtipPath,
    manual_launch_observed: '(human observation required — see instructions)',
    auto_invoke_observed: '(human observation required — see instructions)',
    tested_under_user_kind: '(one of: assigned-access / regular / other — fill in manually)',
  },
};

const outPath = path.join(__dirname, 'phase3-kiosk-probes-results.txt');
try {
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
  console.log('');
  console.log('  Results written to:');
  console.log('    ' + outPath);
} catch (e) {
  console.log('  Failed to write results: ' + (e && e.message));
}

// ---------------------------------------------------------------------------
// Human-required follow-up instructions
// ---------------------------------------------------------------------------

banner('WHAT YOU STILL NEED TO DO MANUALLY');

console.log('');
console.log('1. Confirm the Probe A manual launch verdict:');
console.log('   When the script ran "Launching TabTip.exe now" above, did the');
console.log('   Windows on-screen touch keyboard actually appear? YES / NO');
console.log('');
console.log('2. Run the Probe A auto-invoke check:');
console.log('   a. Dismiss the touch keyboard if it is currently showing (tap X).');
console.log('   b. Open any app with a text input — Notepad is simplest:');
console.log('        Win+R → notepad → Enter');
console.log('   c. Tap inside the Notepad document area with your FINGER');
console.log('      (not a mouse — the auto-invoke trigger only fires on touch).');
console.log('   d. Did the touch keyboard pop up automatically? YES / NO');
console.log('');
console.log('3. Note which Windows user you are testing under:');
console.log('   - Assigned Access kiosk user (ideal)');
console.log('   - Regular interactive user (acceptable first-pass proxy)');
console.log('');
console.log('4. Copy phase3-kiosk-probes-results.txt back to the dev machine and');
console.log('   paste the contents into the chat, along with:');
console.log('     - Probe A manual launch observation (step 1 above)');
console.log('     - Probe A auto-invoke observation (step 2 above)');
console.log('     - Which user kind you tested under (step 3 above)');
console.log('');
banner('DONE');
console.log('');
