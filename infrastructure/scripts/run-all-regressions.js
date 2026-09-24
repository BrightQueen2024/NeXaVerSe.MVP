/**
 * NeXaVerSe Master Regression Test Runner
 * Executes all 10 automated test suites sequentially against the mock server environment.
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function probeHealth() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8080/health', (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

const testSuites = [
  'admin-test.js',
  'rewards-test.js',
  'e2e-test.js',
  'phase6-alpha-validation.js',
  'phase7-alpha-ops.js',
  'phase8-global-mvp-validation.js',
  'phase9-release-candidate-validation.js',
  'phase10-final-hardening-validation.js',
  'phase11-global-beta-validation.js',
  'phase12-master-validation.js'
];

let totalPassed = 0;
let totalFailed = 0;

function runSuite(suiteName) {
  return new Promise((resolve) => {
    console.log(`\n======================================================`);
    console.log(`RUNNING SUITE: ${suiteName}`);
    console.log(`======================================================`);
    
    const child = spawn('node', [path.join(__dirname, suiteName)], {
      stdio: 'inherit',
      cwd: __dirname,
      env: process.env
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`--> SUITE PASSED: ${suiteName}`);
        totalPassed++;
        resolve(true);
      } else {
        console.error(`--> SUITE FAILED with exit code ${code}: ${suiteName}`);
        totalFailed++;
        resolve(false);
      }
    });

    child.on('error', (err) => {
      console.error(`--> ERROR launching ${suiteName}:`, err.message);
      totalFailed++;
      resolve(false);
    });
  });
}

async function main() {
  console.log('======================================================');
  console.log(`STARTING NEXAVERSE REGRESSION SUITE (${testSuites.length} Suites)`);
  console.log('======================================================');

  console.log('Starting Mock Server for Regression Suite...');
  const mockServer = spawn('node', [path.join(__dirname, 'mock-server.js')], {
    stdio: 'inherit',
    cwd: __dirname,
    env: { ...process.env, RATE_LIMIT_GENERAL_RPM: '5000', RATE_LIMIT_AUTH_RPM: '5000' }
  });

  // Wait for health
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await probeHealth()) {
      ready = true;
      break;
    }
  }

  if (!ready) {
    console.error('Failed to start mock-server within 10s');
    mockServer.kill();
    process.exit(1);
  }

  const startTime = Date.now();

  for (const suite of testSuites) {
    const success = await runSuite(suite);
    if (!success) {
      console.error(`\nSuite ${suite} failed. Continuing with remaining suites for full diagnosis...`);
    }
  }

  console.log('\nStopping Mock Server...');
  mockServer.kill();

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n======================================================`);
  console.log(`ALL SUITES COMPLETED in ${durationSec}s`);
  console.log(`Passed Suites: ${totalPassed} / ${testSuites.length}`);
  console.log(`Failed Suites: ${totalFailed} / ${testSuites.length}`);
  console.log('======================================================');

  if (totalFailed > 0) {
    console.error('REGRESSION RUN FAILED: One or more test suites reported errors.');
    process.exit(1);
  } else {
    console.log('REGRESSION RUN SUCCEEDED: All test suites passed cleanly!');
    process.exit(0);
  }
}

main();
