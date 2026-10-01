import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BUILD_ARTIFACT_COMPONENTS, buildArtifactIdentity, buildArtifactManifest, verifyBuildArtifactManifest } from '../scripts/lib/build-artifact-identity.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't360-artifact-'));
  for (const component of BUILD_ARTIFACT_COMPONENTS) {
    const dir = path.join(root, component.path);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, component.id.includes('api') || component.id === 'worker' ? 'main.js' : 'BUILD_ID'), `${component.id}-build\n`);
    fs.mkdirSync(path.join(dir, 'server'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'server', 'runtime.js'), `runtime:${component.id}\n`);
  }
  return root;
}

test('build artifact identity is stable and covers all six runtime components', () => {
  const root = fixture();
  try {
    const a = buildArtifactIdentity(root);
    const b = buildArtifactIdentity(root);
    assert.equal(a.id, b.id);
    assert.equal(a.components.length, 6);
    assert.ok(a.fileCount >= 12);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('build artifact identity changes when runtime output changes but ignores Next cache', () => {
  const root = fixture();
  try {
    const before = buildArtifactIdentity(root);
    fs.appendFileSync(path.join(root, 'apps/api/dist/main.js'), '// changed\n');
    const changed = buildArtifactIdentity(root);
    assert.notEqual(changed.id, before.id);
    const cache = path.join(root, 'apps/admin/.next/cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'ephemeral.bin'), 'cache only');
    const afterCache = buildArtifactIdentity(root);
    assert.equal(afterCache.id, changed.id);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('manifest verification rejects a different build artifact', () => {
  const root = fixture();
  try {
    const sourceIdentity = { algorithm: 'sha256', value: 'a'.repeat(64), fileCount: 1 };
    const manifest = buildArtifactManifest({ root, sourceIdentity });
    assert.equal(verifyBuildArtifactManifest(manifest, root, sourceIdentity.value).id, manifest.artifact.id);
    fs.appendFileSync(path.join(root, 'apps/worker/dist/main.js'), '// mutation\n');
    assert.throws(() => verifyBuildArtifactManifest(manifest, root, sourceIdentity.value), /Build artifact berubah/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
