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

function runScript(scriptName) {
  return new Promise((resolve) => {
    console.log(`\n==============================================`);
    console.log(`RUNNING: ${scriptName}`);
    console.log(`==============================================\n`);
    const proc = spawn('node', [path.join(__dirname, scriptName)], {
      stdio: 'inherit',
      env: process.env
    });
    proc.on('close', (code) => {
      console.log(`\n[${scriptName}] Exited with code: ${code}`);
      resolve(code === 0);
    });
  });
}

async function main() {
  console.log('Starting Mock Server for Regression Suite...');
  const mockServer = spawn('node', [path.join(__dirname, 'mock-server.js')], {
    stdio: 'inherit',
    env: { ...process.env, RATE_LIMIT_GENERAL_RPM: '5000', RATE_LIMIT_AUTH_RPM: '5000' }
  });

  // Wait for health
  let ready = false;
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    if (await probeHealth()) {
      ready = true;
      break;
    }
  }

  if (!ready) {
    console.error('Failed to start mock-server within 5s');
    mockServer.kill();
    process.exit(1);
  }

  const results = {};
  results['admin-test.js'] = await runScript('admin-test.js');
  results['rewards-test.js'] = await runScript('rewards-test.js');
  results['e2e-test.js'] = await runScript('e2e-test.js');
  results['phase6-alpha-validation.js'] = await runScript('phase6-alpha-validation.js');
  results['phase7-alpha-ops.js'] = await runScript('phase7-alpha-ops.js');
  results['phase8-global-mvp-validation.js'] = await runScript('phase8-global-mvp-validation.js');
  results['phase9-release-candidate-validation.js'] = await runScript('phase9-release-candidate-validation.js');
  results['phase10-final-hardening-validation.js'] = await runScript('phase10-final-hardening-validation.js');
  results['phase11-global-beta-validation.js'] = await runScript('phase11-global-beta-validation.js');

  console.log('\nStopping Mock Server...');
  mockServer.kill();

  console.log('\n==============================================');
  console.log('REGRESSION SUITE RESULTS SUMMARY:');
  console.log('==============================================');
  let allOk = true;
  for (const [script, ok] of Object.entries(results)) {
    console.log(`${script}: ${ok ? 'PASSED' : 'FAILED'}`);
    if (!ok) allOk = false;
  }
  console.log('==============================================');
  process.exit(allOk ? 0 : 1);
}

main();
