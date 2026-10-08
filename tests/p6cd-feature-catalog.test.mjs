import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './helpers/import-ts.mjs';

const { PlatformService } = await load('apps/api/src/platform/platform.service.ts', {
  platform: 'node', external: ['@prisma/client', '@nestjs/common', '@nestjs/config', '@nestjs/microservices', '@nestjs/websockets'],
});
const { FEATURE_KEYS } = await load('packages/config/src/index.ts');
const keys = [FEATURE_KEYS.RETAIL_EXCHANGE, FEATURE_KEYS.CUSTOMER_DEPOSIT, FEATURE_KEYS.CUSTOMER_CAMPAIGN, FEATURE_KEYS.POS_SHIP_LATER, FEATURE_KEYS.TAX_EXPORT];
const user = { sub: 'test-user', companyId: 'test-company', branchId: 'test-branch' };
function runtime(flags = []) {
  const reads = [];
  const prisma = {
    branch: { findFirst: async () => ({ id: user.branchId, companyId: user.companyId, company: { id: user.companyId } }) },
    featureFlag: { findMany: async query => { reads.push(query); return structuredClone(flags); } },
    systemSetting: { findMany: async () => [] }, moduleDefinition: { findMany: async () => [] }, uiSchemaDefinition: { findMany: async () => [] },
  };
  return { service: new PlatformService(prisma, { list: () => [] }, {}), reads };
}

test('retail manifest without persisted flags is complete, limited and default OFF without database writes', async () => {
  const { service, reads } = runtime();
  const manifest = await service.manifest(user);
  for (const key of keys) {
    const feature = manifest.features[key];
    assert.equal(feature.enabled, false); assert.equal(feature.configuredEnabled, false);
    assert(['LIMITED', 'ADAPTER_REQUIRED'].includes(feature.config.maturityClass));
    for (const name of ['maturity', 'ownership', 'helpText', 'operatorVisibility']) assert(feature.config[name]);
  }
  assert.equal(manifest.features.customer_campaign.config.maturityClass, 'ADAPTER_REQUIRED');
  assert.equal(manifest.features.customer_campaign.config.operatorVisibility, 'CONFIGURATION_ONLY');
  assert(reads[0].where.OR.some(row => row.companyId === user.companyId && row.branchId === user.branchId));
  manifest.features.tax_export.config.helpText = 'mutated consumer copy';
  assert.notEqual((await service.manifest(user)).features.tax_export.config.helpText, 'mutated consumer copy');
});

test('retail scoped overrides preserve account config and rollout while server-owned maturity cannot claim certification', async () => {
  const flags = [
    { key: 'customer_deposit', companyId: user.companyId, branchId: null, enabled: true, config: { accountCode: '2302', retained: true } },
    { key: 'customer_deposit', companyId: user.companyId, branchId: user.branchId, enabled: true, config: { accountCode: '2303', rolloutPercentage: 0, maturityClass: 'OPERATIONAL', helpText: 'fully certified' } },
    { key: 'tax_export', companyId: user.companyId, branchId: user.branchId, enabled: true, config: { rolloutPercentage: 100, retained: 'legal' } },
    { key: 'existing_feature', companyId: user.companyId, branchId: null, enabled: false, config: { retained: 'legacy' } },
  ];
  const { service } = runtime(flags);
  const { features } = await service.manifest(user);
  assert.equal(features.customer_deposit.configuredEnabled, true); assert.equal(features.customer_deposit.enabled, false);
  assert.equal(features.customer_deposit.config.accountCode, '2303'); assert.equal(features.customer_deposit.config.retained, true);
  assert.equal(features.customer_deposit.config.maturityClass, 'LIMITED'); assert.notEqual(features.customer_deposit.config.helpText, 'fully certified');
  assert.equal(features.tax_export.enabled, true); assert.equal(features.tax_export.config.retained, 'legal');
  assert.deepEqual(features.existing_feature, { enabled: false, configuredEnabled: false, config: { retained: 'legacy' } });
});
