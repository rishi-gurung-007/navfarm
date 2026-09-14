import { expect, test } from '@playwright/test';
import { CONTENT, gotoConsole } from './support/shell';

for (const [key, codeLabel] of [
  ['uom', 'UOM Code'], ['stage', 'Stage Code'], ['breed', 'Breed Code'],
  ['species', 'Species Code'], ['item-type', 'Type Code'], ['item-category', 'Category Code'],
  ['item-attribute', 'Attribute Code'], ['location-type', 'Type Code'],
  ['supplier', 'Supplier Code'], ['customer', 'Customer Code'], ['resource', 'Resource Code'],
  ['disease', 'Disease Code'], ['feed-formula', 'Formula Code'], ['cost-center', 'Cost Center Code'],
  ['animal', 'Animal Code'], ['reason', 'Reason Code'],
]) {
  test(`${key} supports both code-entry modes before saving`, async ({ page }) => {
    await gotoConsole(page, { path: `/master-data/${key}`, routes: [
      ['**/api/v1/number-series/preview?*', (r) => r.fulfill({ json: { generated: true, allowManual: true, preview: 'QA-001' } })],
    ] });
    await page.locator(CONTENT).getByRole('button', { name: /^Add / }).first().click();
    const dialog = page.getByRole('dialog').first();
    const code = dialog.getByLabel(codeLabel, { exact: true });
    // Supporting lookup cards have their own independent numbering controls.
    const codeMode = dialog.getByLabel('Code Entry', { exact: true }).first();
    await expect(code).toBeDisabled();
    await expect(code).toHaveValue('QA-001');
    await codeMode.selectOption('manual');
    await code.fill('QA-MANUAL');
    await codeMode.selectOption('serial');
    await expect(code).toHaveValue('QA-001');
    await codeMode.selectOption('manual');
    await expect(code).toHaveValue('QA-MANUAL');
  });
}

for (const legacy of ['farm', 'shed', 'warehouse']) {
  test(`legacy ${legacy} master redirects to the unified Locations master`, async ({ page }) => {
    await gotoConsole(page, { path: `/master-data/${legacy}` });
    await expect(page).toHaveURL(/\/master-data\/location$/);
    await expect(page.locator(CONTENT).getByRole('button', { name: 'Add Location', exact: true })).toBeVisible();
  });
}

test('Location Parent lookup follows Farm, Shed and Pen hierarchy levels', async ({ page }) => {
  const locations = [
    { location_id: 'farm-1', location_code: 'FARM-001', location_name: 'Main Farm', location_type: 'FARM', location_level: 1 },
    { location_id: 'shed-1', location_code: 'FARM-001/SHED-001', location_name: 'House 1', location_type: 'SHED', location_level: 2 },
    { location_id: 'pen-1', location_code: 'FARM-001/SHED-001/PEN-001', location_name: 'Pen 1', location_type: 'PEN', location_level: 3 },
  ];
  await gotoConsole(page, { path: '/master-data/location', routes: [
    ['**/api/v1/location-type?*', (route) => route.fulfill({ json: [
      { type_code: 'FARM', type_name: 'Farm', allowed_parent_types: [] },
      { type_code: 'SHED', type_name: 'Shed', allowed_parent_types: ['FARM'] },
      { type_code: 'PEN', type_name: 'Pen', allowed_parent_types: ['SHED'] },
    ] })],
    ['**/api/v1/location?*', (route) => route.fulfill({ json: locations })],
  ] });

  await page.locator(CONTENT).getByRole('button', { name: 'Add Location', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add Location', exact: true });
  const chooseType = async (code: 'FARM' | 'SHED' | 'PEN', name: string) => {
    await form.getByRole('button', { name: 'Location Type', exact: true }).click();
    await page.getByRole('dialog', { name: 'Select Location Type', exact: true })
      .getByRole('button', { name: `Select ${code} — ${name}`, exact: true }).click();
  };

  await chooseType('FARM', 'Farm');
  await expect(form.getByRole('button', { name: 'Parent Location', exact: true })).toHaveCount(0);

  await chooseType('SHED', 'Shed');
  const parent = form.getByRole('button', { name: 'Parent Location', exact: true });
  await expect(parent).toBeVisible();
  await parent.click();
  let lookup = page.getByRole('dialog', { name: 'Select Parent Location', exact: true });
  await expect(lookup.getByText('FARM-001', { exact: true })).toBeVisible();
  await expect(lookup.getByText('FARM-001/SHED-001', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await chooseType('PEN', 'Pen');
  await parent.click();
  lookup = page.getByRole('dialog', { name: 'Select Parent Location', exact: true });
  await expect(lookup.getByText('FARM-001/SHED-001', { exact: true })).toBeVisible();
  await expect(lookup.getByText('FARM-001', { exact: true })).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`Reason Master is visible but restricted for operational admins at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const record = { reason_id: 'r-1', reason_code: 'RATION_PIG', reason_name: 'Ration Pig', category: 'MORTALITY', mandatory_weight: true, is_active: true, applicable_stages: null };
    await gotoConsole(page, { path: '/master-data/reason', userType: 'OPERATIONAL_ADMIN', routes: [
      ['**/api/v1/reason?*', (r) => r.fulfill({ json: [record] })],
      ['**/api/v1/reason/r-1', (r) => r.fulfill({ json: record })],
    ] });
    const content = page.locator(CONTENT);
    await expect(content.getByText('Only a Tenant Admin or Company Admin can add, edit or deactivate reasons.', { exact: false })).toBeVisible();
    await expect(content.getByRole('button', { name: 'Add Reason', exact: true })).toHaveCount(0);
    await expect(content.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(content.getByRole('switch')).toHaveCount(0);
    await content.getByRole('button', { name: 'View Reason', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('RATION_PIG', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('All (no restriction)', { exact: true })).toBeVisible();
  });
}

test('Company Admin can choose automatic or manual Reason codes and select applicable stages', async ({ page }) => {
  await gotoConsole(page, { path: '/master-data/reason', userType: 'COMPANY_ADMIN', routes: [
    ['**/api/v1/number-series/preview?*', (r) => r.fulfill({ json: { generated: true, allowManual: true, preview: 'RSN-001' } })],
    ['**/api/v1/stage?*', (r) => r.fulfill({ json: [{ stage_code: 'GILT_REARING', stage_name: 'Gilt Rearing' }, { stage_code: 'GESTATION', stage_name: 'Gestation' }] })],
  ] });
  await page.locator(CONTENT).getByRole('button', { name: 'Add Reason', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Reason Code', { exact: true })).toHaveValue('RSN-001');
  await dialog.getByLabel('Code Entry', { exact: true }).selectOption('manual');
  await dialog.getByLabel('Reason Code', { exact: true }).fill('CUSTOM_REASON');
  await dialog.getByRole('checkbox', { name: 'GILT_REARING — Gilt Rearing', exact: true }).check();
  await expect(dialog.getByRole('checkbox', { name: 'GESTATION — Gestation', exact: true })).not.toBeChecked();
  await dialog.getByLabel('Code Entry', { exact: true }).selectOption('serial');
  await expect(dialog.getByLabel('Reason Code', { exact: true })).toHaveValue('RSN-001');
});

test('record views resolve scoped UUID references and hide internal identifiers', async ({ page }) => {
  const location = '11111111-1111-4111-8111-111111111111';
  const record = { breed_id: 'b-1', breed_code: 'BRD-001', breed_name: 'Demo breed', location_id: location, is_active: true };
  await gotoConsole(page, { path: '/master-data/breed', routes: [
    ['**/api/v1/breed?*', (r) => r.fulfill({ json: [record] })],
    ['**/api/v1/breed/b-1', (r) => r.fulfill({ json: record })],
    [`**/api/v1/location/${location}`, (r) => r.fulfill({ json: { location_code: 'FARM-001', location_name: 'Demo Farm' } })],
  ] });
  await page.locator(CONTENT).getByRole('button', { name: 'View Breed', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('FARM-001 — Demo Farm', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText(location, { exact: true })).toHaveCount(0);
});

test('Medicine withdrawal is a BC reference on view only', async ({ page }) => {
  const record = { medicine_id: 'm-1', composition: 'Demo vaccine', bc_withdrawal_days: null, withdrawal_period_days: 0, is_active: true };
  await gotoConsole(page, { path: '/master-data/medicine', routes: [
    ['**/api/v1/medicine?*', (r) => r.fulfill({ json: [record] })],
    ['**/api/v1/medicine/m-1', (r) => r.fulfill({ json: record })],
  ] });
  await page.locator(CONTENT).getByRole('button', { name: 'View Medicine', exact: true }).click();
  const bc = page.getByRole('region', { name: 'Business Central' });
  await expect(bc.getByText('From BC', { exact: true })).toBeVisible();
  await expect(bc.locator('dd')).toHaveText('—');
  await page.keyboard.press('Escape');
  await page.locator(CONTENT).getByRole('button', { name: 'Add Medicine', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Withdrawal Period (days)', { exact: true })).toHaveCount(0);
});

test('silo settings appear only for the SILO storage selection', async ({ page }) => {
  await gotoConsole(page, { path: '/master-data/location' });
  await page.locator(CONTENT).getByRole('button', { name: /^add /i }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Location', exact: true });
  await expect(dialog.getByLabel('Silo Capacity (KG)', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Storage Location', { exact: true }).selectOption('SILO');
  await expect(dialog.getByLabel('Silo Capacity (KG)', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Silo Reorder Days', { exact: true })).toHaveAttribute('aria-required', 'true');
  await dialog.getByLabel('Silo Capacity (KG)', { exact: true }).fill('2500');
  await dialog.getByLabel('Storage Location', { exact: true }).selectOption('STORE');
  await expect(dialog.getByLabel('Silo Capacity (KG)', { exact: true })).toHaveCount(0);
});

test('lookup management stays above the unsaved breed dialog without opening a tab', async ({ page }) => {
  await gotoConsole(page, { path: '/master-data/breed' });
  await page.locator(CONTENT).getByRole('button', { name: /^add /i }).click();
  const parent = page.getByRole('dialog', { name: 'Add Breed', exact: true });
  await parent.getByLabel('Breed Name', { exact: true }).fill('Unsaved piggery breed');
  await parent.getByRole('button', { name: /^Species/ }).click();
  const tabCount = page.context().pages().length;
  await parent.getByRole('button', { name: 'Manage Species', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Manage Species', exact: true });
  await expect(manager).toBeVisible();
  await manager.getByRole('button', { name: 'Add Species', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add Species', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(manager).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(manager).toHaveCount(0);
  await expect(parent.getByLabel('Breed Name', { exact: true })).toHaveValue('Unsaved piggery breed');
  expect(page.context().pages()).toHaveLength(tabCount);
});

test('manual entry can be chosen when the configured series allows it', async ({ page }) => {
  await gotoConsole(page, { path: '/master-data/uom', routes: [
    ['**/api/v1/number-series/preview?*', (route) => route.fulfill({ json: { generated: true, allowManual: true, preview: 'UOM-001' } })],
  ] });
  await page.locator(CONTENT).getByRole('button', { name: /^add /i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('UOM Code', { exact: true })).toBeDisabled();
  await dialog.getByLabel('Code Entry', { exact: true }).selectOption('manual');
  await expect(dialog.getByLabel('UOM Code', { exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('UOM Code', { exact: true })).toHaveAttribute('aria-required', 'true');
  await dialog.getByLabel('Code Entry', { exact: true }).selectOption('serial');
  await expect(dialog.getByLabel('UOM Code', { exact: true })).toBeDisabled();
});

for (const width of [1440, 390]) {
  test(`Location code mode is available before any entry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let releasePreview!: () => void;
    const initialPreview = new Promise<void>((resolve) => { releasePreview = resolve; });
    await gotoConsole(page, { path: '/master-data/location', routes: [
      ['**/api/v1/location-type?*', (route) => route.fulfill({ json: [
        { type_code: 'FARM', type_name: 'Farm' }, { type_code: 'SHED', type_name: 'Shed' },
      ] })],
      ['**/api/v1/number-series/preview?*', async (route) => {
        const type = new URL(route.request().url()).searchParams.get('type');
        if (!type) await initialPreview;
        await route.fulfill({ json: type
          ? { generated: true, allowManual: type !== 'SHED', preview: `${type}-002` }
          : { generated: false, allowManual: true } });
      }],
    ] });
    await page.locator(CONTENT).getByRole('button', { name: /^add /i }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Location', exact: true });
    const chooser = dialog.getByLabel('Code Entry', { exact: true });
    const code = dialog.getByLabel('Location Code', { exact: true });
    try {
      await expect(chooser).toBeVisible();
      await expect(chooser).toHaveValue('serial');
      await expect(code).toBeDisabled();
      await expect(code).toHaveAttribute('placeholder', 'Select Location Type to preview code');
      await chooser.selectOption('manual');
      await code.fill('MY-FARM');
    } finally {
      releasePreview();
    }
    await expect(code).toHaveValue('MY-FARM');
    await dialog.getByLabel('Location Type', { exact: true }).selectOption('FARM');
    await expect(chooser).toHaveValue('manual');
    await expect(code).toBeEnabled();
    await expect(code).toHaveValue('MY-FARM');
    await chooser.selectOption('serial');
    await expect(code).toHaveValue('FARM-002');
    await chooser.selectOption('manual');
    await dialog.getByLabel('Location Type', { exact: true }).selectOption('SHED');
    await expect(chooser).toHaveCount(0);
    await expect(code).toBeDisabled();
    await expect(code).toHaveValue('SHED-002');
  });
}

test('Breed location remains optional and falls back to manual without a series', async ({ page }) => {
  await gotoConsole(page, { path: '/master-data/breed' });
  await page.locator(CONTENT).getByRole('button', { name: /^add /i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Farm Location (optional)', { exact: true })).toHaveAttribute('aria-required', 'false');
  await expect(dialog.getByLabel('Breed Code', { exact: true })).toBeEnabled();
});

test('tenant workspace omits stale company headers and query scope', async ({ page }) => {
  let request: { company?: string; scope?: string; url: string } | undefined;
  await gotoConsole(page, { userType: 'TENANT_ADMIN', path: '/master-data/breed', routes: [
    ['**/api/v1/breed?*', async (route) => {
      const headers = route.request().headers();
      request = { company: headers['x-active-company-id'], scope: headers['x-workspace-scope'], url: route.request().url() };
      await route.fulfill({ json: [] });
    }],
  ] });
  await page.evaluate(() => localStorage.setItem('active_workspace_scope', 'TENANT'));
  await page.reload();
  await expect.poll(() => request?.scope).toBe('TENANT');
  expect(request?.company).toBeUndefined();
  expect(request?.url).not.toContain('companyId=');
  await expect(page.getByText('MASTER SCOPE', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Filter by nature of business')).toBeVisible();
});

test('operational scope hides classification controls and retains legitimate feed names', async ({ page }) => {
  await gotoConsole(page, { path: '/master-data/item', routes: [
    ['**/api/v1/item?*', (route) => route.fulfill({ json: [{ item_id: 'feed', item_code: 'FEED', item_name: 'Wheat and fish meal', item_type: 'RAW_MATERIAL', uom_primary: 'KG', is_active: true }] })],
  ] });
  await page.evaluate(() => {
    localStorage.setItem('active_workspace_scope', 'OPERATIONAL');
    localStorage.setItem('active_operational_area_id', 'area-e2e');
    localStorage.setItem('active_lob', 'PIGGERY');
  });
  await page.reload();
  await expect(page.getByText('Wheat and fish meal', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Filter by nature of business')).toHaveCount(0);
  // Items are BC-owned; verify the operational creation controls on a local master.
  await expect(page.locator(CONTENT).getByRole('button', { name: /^add /i })).toHaveCount(0);
  await page.goto('/master-data/location');
  await page.locator(CONTENT).getByRole('button', { name: /^add /i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Nature of Business', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Line of Business', { exact: true })).toHaveCount(0);
});

test('configured UOM code is generated and omitted from the creation payload', async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await gotoConsole(page, { path: '/master-data/uom', routes: [
    ['**/api/v1/number-series/preview?*', (route) => route.fulfill({ json: { generated: true, allowManual: false, seriesCode: 'UOM_WEIGHT', preview: 'UOM-001' } })],
    ['**/api/v1/uom', (route) => {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { uom_id: 'new-uom' } });
    }],
  ] });
  await page.locator(CONTENT).getByRole('button', { name: /^add /i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('UOM Code', { exact: true })).toBeDisabled();
  await dialog.getByLabel('UOM Name', { exact: true }).fill('Presentation unit');
  await dialog.getByLabel('UOM Type', { exact: true }).selectOption('WEIGHT');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => submitted).toEqual(expect.objectContaining({ company_id: 'company-e2e', uom_name: 'Presentation unit' }));
  expect(submitted).not.toHaveProperty('uom_code');
});

test('code preview refreshes with type and preserves the user’s manual choice', async ({ page }) => {
  await gotoConsole(page, { path: '/master-data/uom', routes: [
    ['**/api/v1/number-series/preview?*', (route) => {
      const type = new URL(route.request().url()).searchParams.get('type') || 'UOM';
      return route.fulfill({ json: { generated: true, allowManual: true, preview: `${type}-001` } });
    }],
  ] });
  await page.locator(CONTENT).getByRole('button', { name: /^add /i }).click();
  const dialog = page.getByRole('dialog');
  const code = dialog.getByLabel('UOM Code', { exact: true });
  await dialog.getByLabel('UOM Type', { exact: true }).selectOption('WEIGHT');
  await expect(code).toHaveValue('WEIGHT-001');
  await dialog.getByLabel('Code Entry', { exact: true }).selectOption('manual');
  await code.fill('MY-KG');
  await dialog.getByLabel('UOM Type', { exact: true }).selectOption('VOLUME');
  await expect(code).toHaveValue('MY-KG');
  await expect(code).toBeEnabled();
  await dialog.getByLabel('Code Entry', { exact: true }).selectOption('serial');
  await expect(code).toHaveValue('VOLUME-001');
});

test('resource template types remain selectable with the correct people fields', async ({ page }) => {
  await gotoConsole(page, { path: '/master-data/resource' });
  await page.locator(CONTENT).getByRole('button', { name: /^add /i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Resource Type', { exact: true }).selectOption('MANPOWER');
  await dialog.getByRole('button', { name: 'People', exact: true }).click();
  await expect(dialog.getByLabel('Employee ID', { exact: true })).toBeVisible();
  await dialog.getByLabel('Resource Type', { exact: true }).selectOption('UTILITY');
  await expect(dialog.getByLabel('Employee ID', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Resource Type', { exact: true }).selectOption('OTHER');
});

test('Breed farm picker requests root farms and selection updates the code', async ({ page }) => {
  let farmQuery = '';
  await gotoConsole(page, { path: '/master-data/breed', routes: [
    ['**/api/v1/location?*', (route) => {
      farmQuery = route.request().url();
      return route.fulfill({ json: [{ location_id: 'farm-1', location_code: 'FARM-001', location_name: 'Apex', is_active: true }] });
    }],
    ['**/api/v1/number-series/preview?*', (route) => {
      const parent = new URL(route.request().url()).searchParams.get('parentId');
      return route.fulfill({ json: { generated: true, allowManual: true, preview: parent ? 'FARM-001/BRD-001' : 'BRD-001' } });
    }],
  ] });
  await page.locator(CONTENT).getByRole('button', { name: /^add /i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Breed Code', { exact: true })).toHaveValue('BRD-001');
  await dialog.getByLabel('Farm Location (optional)', { exact: true }).selectOption('farm-1');
  await expect(dialog.getByLabel('Breed Code', { exact: true })).toHaveValue('FARM-001/BRD-001');
  expect(new URL(farmQuery).searchParams.get('rootOnly')).toBe('true');
  expect(new URL(farmQuery).searchParams.get('locationType')).toBe('FARM');
  expect(new URL(farmQuery).searchParams.getAll('isActive')).toEqual(['true']);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  for (const master of [
    { key: 'item', name: 'Item', idKey: 'item_id', codeKey: 'item_code', bcCount: 10 },
    { key: 'gl-account', name: 'GL Account', idKey: 'gl_account_id', codeKey: 'account_code', bcCount: 4 },
  ]) {
    test(`${master.name} is BC-owned and view-only at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const record = { [master.idKey]: 'record-1', [master.codeKey]: 'DEMO-001', is_active: true };
      const mutations: string[] = [];
      await gotoConsole(page, { path: `/master-data/${master.key}`, routes: [
        [`**/api/v1/${master.key}**`, (route) => {
          if (route.request().method() !== 'GET') mutations.push(route.request().method());
          return route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/record-1') ? record : [record] });
        }],
      ] });
      const content = page.locator(CONTENT);
      await expect(content.getByText('BC-owned · Read only.', { exact: true })).toBeVisible();
      await expect(content.getByRole('button', { name: /^add /i })).toHaveCount(0);
      await expect(content.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
      await expect(content.getByRole('switch')).toHaveCount(0);
      await content.getByRole('button', { name: `View ${master.name}`, exact: true }).click();
      const view = page.getByRole('dialog');
      await expect(view.getByText('From BC', { exact: true })).toHaveCount(master.bcCount);
      await expect(view.getByText('DEMO-001', { exact: true })).toHaveCount(1);
      await expect(view.getByRole('note')).toContainText('not synchronized BC records');
      await expect(view.locator('input,select,textarea')).toHaveCount(0);
      await page.keyboard.press('Escape');
      if (master.key === 'item') {
        await content.getByRole('button', { name: 'Manage Item Types', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Manage Item Types' }).getByRole('button', { name: 'Add Item Type' })).toBeVisible();
      }
      expect(mutations).toEqual([]);
    });
  }
  test(`BC references are view-only at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const animal = { animal_id: 'animal-1', animal_code: 'PIG-001', animal_type: 'SOW', is_active: true, bc_fixed_asset_no: 'BC-FA-001' };
    await gotoConsole(page, { path: '/master-data/animal', routes: [
      ['**/api/v1/animal?*', (route) => route.fulfill({ json: [animal] })],
      ['**/api/v1/animal/animal-1', (route) => route.fulfill({ json: animal })],
    ] });
    await page.getByRole('button', { name: /^View Animal/ }).click();
    const view = page.getByRole('dialog');
    await expect(view.getByText('BC-FA-001')).toBeVisible();
    await expect(view.getByText('From BC', { exact: true })).toHaveCount(3);
    await expect(view.locator('input,select,textarea')).toHaveCount(0);
    const bounds = await view.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    await page.keyboard.press('Escape');
    await page.locator(CONTENT).getByRole('button', { name: /^add /i }).click();
    await expect(page.getByRole('dialog').getByText('From BC', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog').getByText('Fixed Asset No.', { exact: true })).toHaveCount(0);
  });
}
