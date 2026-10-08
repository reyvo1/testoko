import fs from 'node:fs';
import { analysis } from '../tests/helpers/mutation-payload-parity.mjs';

// Presentation metadata only. Runtime guards and domain ownership remain authoritative.
export const apiAccessPolicy = {
  version: 1,
  routes: analysis.routes.map(route => ({ method: route.method, path: route.rawPath,
    roles: route.roles, permissions: route.perms }))
    .sort((a, b) => {
      const specificity = path => path.split('/').filter(segment => segment && !segment.startsWith(':')).length;
      return specificity(b.path) - specificity(a.path) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
    }),
};
if (apiAccessPolicy.routes.length < 500) throw new Error('Controller access inventory is incomplete.');
const file = 'packages/contracts/api-access-policy.json';
const body = JSON.stringify(apiAccessPolicy, null, 2) + '\n';
if (process.argv.includes('--write')) fs.writeFileSync(file, body);
else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) {
  throw new Error('API presentation access policy differs from actual controllers. Run node scripts/generate-api-access-policy.mjs --write and review.');
}
console.log(`Controller presentation access policy verified: ${apiAccessPolicy.routes.length} operations.`);
