import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = process.env.API_URL || 'http://localhost:2877/api/v1';

const TENANT_A = {
  id: '324f7541-7bd2-420b-a006-b520e332235c',
  admin: 'killsheet-admin-a@integration.test',
  companyAlpha: 'bbb5c0a8-b08e-4af5-b063-4cf263b9aa73',
  farmAlpha: '2fecfce8-2edf-4271-b647-1f650f9ee60d',
  batchAlpha: 'ba000000-0000-0000-0000-000000000102', // 3647102
  batchAlpha2: 'ba000000-0000-0000-0000-000000000001', // KS-ALPHA-001
  companyBeta: 'c1be7420-b1b4-4c3d-8d2a-000000000001',
  farmBeta: 'f2ab9531-c2c5-4d4e-9e3b-000000000002',
  batchBeta: 'bb000000-0000-0000-0000-000000000106', // 3647106
};

const TENANT_B = {
  id: '3d2cec94-cc2c-492c-906b-09fb8b09129e',
  admin: 'killsheet-admin-b@integration.test',
  company: 'de2e81ff-774d-4207-acd7-22e86fa32919',
  farm: 'dac01dfc-4d2a-4c73-abdf-ce9dc86065cb',
  batch: 'bc000000-0000-0000-0000-000000000001',
};

const rootCandidate1 = resolve(__dirname, '../../../../.local-test-data/kill-sheets');
const rootCandidate2 = resolve(process.cwd(), '.local-test-data/kill-sheets');
const FIXTURES_DIR = existsSync(rootCandidate1) ? rootCandidate1 : rootCandidate2;

async function login(email: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'KillSheetFixture!2026' }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status} ${await res.text()}`);
  const json: any = await res.json();
  return { token: json.access_token, user: json.user };
}

async function run() {
  console.log('=== Step 1: Authentication & Tenant Identity ===');
  const userA = await login(TENANT_A.admin);
  const userB = await login(TENANT_B.admin);
  if (userA.user.tenantId !== TENANT_A.id) throw new Error('Tenant A ID mismatch');
  if (userB.user.tenantId !== TENANT_B.id) throw new Error('Tenant B ID mismatch');
  console.log('  ✓ Tenant A authenticated:', userA.user.email, 'tenantId:', userA.user.tenantId);
  console.log('  ✓ Tenant B authenticated:', userB.user.email, 'tenantId:', userB.user.tenantId);

  console.log('\n=== Step 2: Company/Farm/Batch Scoping Checks ===');
  // Upload with invalid farm/batch combo should fail (403)
  const fakeFormData = new FormData();
  fakeFormData.append('farm_id', TENANT_A.farmAlpha);
  fakeFormData.append('batch_id', TENANT_B.batch); // Tenant B's batch inside Tenant A request!
  const dummyFile = new Blob([readFileSync(join(FIXTURES_DIR, 'Porta Farm Batch 3647102.xls'))], { type: 'application/vnd.ms-excel' });
  fakeFormData.append('individual', dummyFile, 'Porta Farm Batch 3647102.xls');

  const crossBatchRes = await fetch(`${API}/kill-sheets/preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userA.token}`,
      'x-tenant-id': TENANT_A.id,
      'x-active-company-id': TENANT_A.companyAlpha,
    },
    body: fakeFormData,
  });
  if (crossBatchRes.status !== 403) throw new Error(`Expected 403 on cross-workspace batch, got ${crossBatchRes.status}`);
  console.log('  ✓ Cross-workspace batch correctly rejected with 403 Forbidden');

  console.log('\n=== Step 3 & 4: Upload, Preview & Reconciliation (Porta Farm) ===');
  // First, verify list before or with existing imports
  const listAlphaBefore = await fetch(`${API}/kill-sheets`, {
    headers: {
      Authorization: `Bearer ${userA.token}`,
      'x-tenant-id': TENANT_A.id,
      'x-active-company-id': TENANT_A.companyAlpha,
    },
  }).then((r) => r.json() as Promise<any>);
  console.log('  Current Alpha imports:', listAlphaBefore.total);

  // Upload Porta Farm Batch 3647102 if not already uploaded or check existing
  let portaImport = listAlphaBefore.data.find((d: any) => d.batch_id === TENANT_A.batchAlpha);
  if (!portaImport) {
    const formData = new FormData();
    formData.append('farm_id', TENANT_A.farmAlpha);
    formData.append('batch_id', TENANT_A.batchAlpha);
    const indFile = new Blob([readFileSync(join(FIXTURES_DIR, 'Porta Farm Batch 3647102.xls'))], { type: 'application/vnd.ms-excel' });
    const sumFile = new Blob([readFileSync(join(FIXTURES_DIR, 'Porta Farm Summary Batch 3647102.xls'))], { type: 'application/vnd.ms-excel' });
    formData.append('individual', indFile, 'Porta Farm Batch 3647102.xls');
    formData.append('summary', sumFile, 'Porta Farm Summary Batch 3647102.xls');

    const previewRes = await fetch(`${API}/kill-sheets/preview`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userA.token}`,
        'x-tenant-id': TENANT_A.id,
        'x-active-company-id': TENANT_A.companyAlpha,
      },
      body: formData,
    });
    if (!previewRes.ok) throw new Error(`Preview failed: ${previewRes.status} ${await previewRes.text()}`);
    portaImport = await previewRes.json();
  }

  console.log('  ✓ Porta preview reconciliation:', portaImport.reconciliation_status);
  console.log('  ✓ Porta animals count:', portaImport.actual_animal_count, '(expected 187)');
  console.log('  ✓ Porta warm mass:', portaImport.actual_warm_mass_kg, 'kg (expected 16753.29)');
  console.log('  ✓ Porta cold mass:', portaImport.actual_cold_mass_kg, 'kg (expected 16250.40)');
  console.log('  ✓ Porta product value:', portaImport.reported_product_value, '(expected 42404.444)');
  if (portaImport.actual_animal_count !== 187) throw new Error('Porta animal count mismatch');
  if (Math.abs(Number(portaImport.actual_warm_mass_kg) - 16753.29) > 0.01) throw new Error('Porta warm mass mismatch');
  if (Math.abs(Number(portaImport.actual_cold_mass_kg) - 16250.40) > 0.01) throw new Error('Porta cold mass mismatch');
  if (Math.abs(Number(portaImport.reported_product_value) - 42404.444) > 0.01) throw new Error('Porta product value mismatch');

  console.log('\n=== Step 5: Confirmation & Transactional Persistence ===');
  if (portaImport.status !== 'IMPORTED') {
    const confirmRes = await fetch(`${API}/kill-sheets/${portaImport.import_id}/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userA.token}`,
        'Content-Type': 'application/json',
        'x-tenant-id': TENANT_A.id,
        'x-active-company-id': TENANT_A.companyAlpha,
      },
      body: JSON.stringify({}),
    });
    if (!confirmRes.ok) throw new Error(`Confirm failed: ${confirmRes.status} ${await confirmRes.text()}`);
    portaImport = await confirmRes.json();
  } else {
    const detailRes = await fetch(`${API}/kill-sheets/${portaImport.import_id}`, {
      headers: {
        Authorization: `Bearer ${userA.token}`,
        'x-tenant-id': TENANT_A.id,
        'x-active-company-id': TENANT_A.companyAlpha,
      },
    });
    if (!detailRes.ok) throw new Error(`Detail failed: ${detailRes.status} ${await detailRes.text()}`);
    portaImport = await detailRes.json();
  }
  console.log('  ✓ Porta confirmed status:', portaImport.status);
  console.log('  ✓ Carcasses persisted count:', portaImport.carcass_count, '(expected 187)');
  console.log('  ✓ Products persisted count:', portaImport.product_count, '(expected 5)');
  if (portaImport.carcass_count !== 187 || portaImport.product_count !== 5) throw new Error('Persisted counts mismatch');

  console.log('\n=== Step 6: SHA-512 Duplicate Protection ===');
  const dupForm = new FormData();
  dupForm.append('farm_id', TENANT_A.farmAlpha);
  dupForm.append('batch_id', TENANT_A.batchAlpha);
  const indFileDup = new Blob([readFileSync(join(FIXTURES_DIR, 'Porta Farm Batch 3647102.xls'))], { type: 'application/vnd.ms-excel' });
  dupForm.append('individual', indFileDup, 'Porta Farm Batch 3647102.xls');

  const dupRes = await fetch(`${API}/kill-sheets/preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userA.token}`,
      'x-tenant-id': TENANT_A.id,
      'x-active-company-id': TENANT_A.companyAlpha,
    },
    body: dupForm,
  });
  if (dupRes.status !== 409) throw new Error(`Expected 409 Conflict on duplicate upload, got ${dupRes.status}`);
  console.log('  ✓ Duplicate upload correctly rejected with 409 Conflict');

  console.log('\n=== Step 7: Product Summary Attachment Workflow ===');
  // Upload on BatchAlpha2 individual only first
  const step7Batch = TENANT_A.batchAlpha2;
  // Check if step7 import already exists
  const existingList = await fetch(`${API}/kill-sheets`, {
    headers: {
      Authorization: `Bearer ${userA.token}`,
      'x-tenant-id': TENANT_A.id,
      'x-active-company-id': TENANT_A.companyAlpha,
    },
  }).then((r) => r.json() as Promise<any>);
  let step7Import = existingList.data.find((d: any) => d.batch_id === step7Batch);
  if (!step7Import) {
    const singleForm = new FormData();
    singleForm.append('farm_id', TENANT_A.farmAlpha);
    singleForm.append('batch_id', step7Batch);
    const indOnly = new Blob([readFileSync(join(FIXTURES_DIR, 'Porta Farm Batch 3647102.xls'))], { type: 'application/vnd.ms-excel' });
    singleForm.append('individual', indOnly, 'Porta Farm Batch 3647102.xls');
    const singleRes = await fetch(`${API}/kill-sheets/preview`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userA.token}`,
        'x-tenant-id': TENANT_A.id,
        'x-active-company-id': TENANT_A.companyAlpha,
      },
      body: singleForm,
    });
    if (!singleRes.ok) throw new Error(`Single preview failed: ${singleRes.status} ${await singleRes.text()}`);
    step7Import = await singleRes.json();
    console.log('  ✓ Individual-only import created, id:', step7Import.import_id);
    if (step7Import.summary_file_name) throw new Error('Expected no summary initially');

    // Now attach summary
    const sumAttachForm = new FormData();
    const sumOnly = new Blob([readFileSync(join(FIXTURES_DIR, 'Porta Farm Summary Batch 3647102.xls'))], { type: 'application/vnd.ms-excel' });
    sumAttachForm.append('summary', sumOnly, 'Porta Farm Summary Batch 3647102.xls');
    const attachRes = await fetch(`${API}/kill-sheets/${step7Import.import_id}/summary`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userA.token}`,
        'x-tenant-id': TENANT_A.id,
        'x-active-company-id': TENANT_A.companyAlpha,
      },
      body: sumAttachForm,
    });
    if (!attachRes.ok) throw new Error(`Attach summary failed: ${attachRes.status} ${await attachRes.text()}`);
    step7Import = await attachRes.json();
    console.log('  ✓ Product summary successfully attached:', step7Import.summary_file_name);
    console.log('  ✓ Reconciliation updated to:', step7Import.reconciliation_status);
  } else {
    console.log('  ✓ Step 7 batch already exists with summary:', step7Import.summary_file_name);
  }

  console.log('\n=== Step 8: Authenticated File Download ===');
  const indDownload = await fetch(`${API}/kill-sheets/${portaImport.import_id}/file/individual`, {
    headers: {
      Authorization: `Bearer ${userA.token}`,
      'x-tenant-id': TENANT_A.id,
      'x-active-company-id': TENANT_A.companyAlpha,
    },
  });
  if (!indDownload.ok) throw new Error(`Individual download failed: ${indDownload.status}`);
  const indBytes = await indDownload.arrayBuffer();
  console.log('  ✓ Downloaded individual file bytes:', indBytes.byteLength, '(expected 76800)');
  if (indBytes.byteLength !== 76800) throw new Error('Individual byte length mismatch');

  const sumDownload = await fetch(`${API}/kill-sheets/${portaImport.import_id}/file/summary`, {
    headers: {
      Authorization: `Bearer ${userA.token}`,
      'x-tenant-id': TENANT_A.id,
      'x-active-company-id': TENANT_A.companyAlpha,
    },
  });
  if (!sumDownload.ok) throw new Error(`Summary download failed: ${sumDownload.status}`);
  const sumBytes = await sumDownload.arrayBuffer();
  console.log('  ✓ Downloaded summary file bytes:', sumBytes.byteLength, '(expected 42496)');
  if (sumBytes.byteLength !== 42496) throw new Error('Summary byte length mismatch');

  console.log('\n=== Step 9: Cross-Tenant Isolation (Tenant B cannot access Tenant A) ===');
  const crossDetail = await fetch(`${API}/kill-sheets/${portaImport.import_id}`, {
    headers: {
      Authorization: `Bearer ${userB.token}`,
      'x-tenant-id': TENANT_B.id,
      'x-active-company-id': TENANT_B.company,
    },
  });
  if (crossDetail.status !== 404) throw new Error(`Expected 404 for Tenant B viewing Tenant A, got ${crossDetail.status}`);
  console.log('  ✓ Tenant B detail request refused with 404 Not Found');

  const crossFile = await fetch(`${API}/kill-sheets/${portaImport.import_id}/file/individual`, {
    headers: {
      Authorization: `Bearer ${userB.token}`,
      'x-tenant-id': TENANT_B.id,
      'x-active-company-id': TENANT_B.company,
    },
  });
  if (crossFile.status !== 404) throw new Error(`Expected 404 for Tenant B downloading Tenant A file, got ${crossFile.status}`);
  console.log('  ✓ Tenant B file download refused with 404 Not Found');

  const listB = await fetch(`${API}/kill-sheets`, {
    headers: {
      Authorization: `Bearer ${userB.token}`,
      'x-tenant-id': TENANT_B.id,
      'x-active-company-id': TENANT_B.company,
    },
  }).then((r) => r.json() as Promise<any>);
  console.log('  ✓ Tenant B kill sheets count:', listB.total, '(expected 0)');
  if (listB.total !== 0) throw new Error('Tenant B list should be 0');

  console.log('\n=== Step 10: Multi-Company Independence within Tenant A ===');
  const listAlpha = await fetch(`${API}/kill-sheets`, {
    headers: {
      Authorization: `Bearer ${userA.token}`,
      'x-tenant-id': TENANT_A.id,
      'x-active-company-id': TENANT_A.companyAlpha,
    },
  }).then((r) => r.json() as Promise<any>);

  const listBeta = await fetch(`${API}/kill-sheets`, {
    headers: {
      Authorization: `Bearer ${userA.token}`,
      'x-tenant-id': TENANT_A.id,
      'x-active-company-id': TENANT_A.companyBeta,
    },
  }).then((r) => r.json() as Promise<any>);

  console.log('  ✓ Company Alpha kill sheets count:', listAlpha.total);
  console.log('  ✓ Company Beta kill sheets count:', listBeta.total);
  if (listAlpha.total === 0) throw new Error('Company Alpha should have imports');
  if (listBeta.total === 0) throw new Error('Company Beta should have imports');

  // Verify none of Beta's imports are in Alpha's list and vice versa
  const alphaImportIds = new Set(listAlpha.data.map((d: any) => d.import_id));
  const betaImportIds = new Set(listBeta.data.map((d: any) => d.import_id));
  for (const id of alphaImportIds) {
    if (betaImportIds.has(id)) throw new Error(`Import ${id} appears in both companies!`);
  }
  console.log('  ✓ Zero cross-company contamination within Tenant A');
  console.log('\n========================================');
  console.log('ALL 10 ESSENTIAL INTEGRATION TESTS PASSED!');
  console.log('========================================');
}

run().catch((err) => {
  console.error('\n❌ INTEGRATION TEST FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
