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

test('Ubuntu-first preflight is exposed directly through npm with no root launcher', () => {
  assert.equal(fs.existsSync('RUN-GITHUB-PREFLIGHT.cmd'), false);
  assert.ok(pkg.scripts['ci:preflight:local']);
});
