/**
 * NeXaVerSe Master Regression Test Runner
 * Executes all automated test suites sequentially.
 */

const { spawn } = require('child_process');
const path = require('path');

const testSuites = [
  'smoke-test.js',
  'e2e-scenario-test.js',
  'concurrency-stress-test.js',
  'phase8-regression-test.js',
  'phase9-regression-test.js',
  'phase10-final-hardening-validation.js',
  'international-expansion-test.js',
  'chaos-fault-injection.js',
  'phase11-evidence-reconciliation.js',
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
      cwd: __dirname
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

async function runAll() {
  console.log('======================================================');
  console.log(`STARTING NEXAVERSE REGRESSION SUITE (${testSuites.length} Suites)`);
  console.log('======================================================');

  const startTime = Date.now();

  for (const suite of testSuites) {
    const success = await runSuite(suite);
    if (!success) {
      console.error(`\nSuite ${suite} failed. Continuing with remaining suites for full diagnosis...`);
    }
  }

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

runAll();
