import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));

test('local pre-push gate is dependency-free and leaves heavy runtime work to GitHub', () => {
  assert.equal(pkg.scripts['test:dependency-free'], 'node --test tests/*.test.mjs');
  assert.match(pkg.scripts['ci:preflight:local'], /workflow:validate/);
  assert.match(pkg.scripts['ci:preflight:local'], /validate:repo/);
  assert.match(pkg.scripts['ci:preflight:local'], /test:dependency-free/);
  assert.doesNotMatch(pkg.scripts['ci:preflight:local'], /npm ci|build:gate|uat:browser|postgres/);
});

test('Windows one-click GitHub preflight launcher fails closed', () => {
  const cmd = fs.readFileSync('RUN-GITHUB-PREFLIGHT.cmd','utf8');
  assert.match(cmd, /npm run ci:preflight:local/);
  assert.match(cmd, /if errorlevel 1/);
  assert.match(cmd, /Do not push/);
  assert.match(cmd, /PREFLIGHT PASS/);
});
