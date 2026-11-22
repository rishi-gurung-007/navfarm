import { SetupWizardController } from './setup-wizard.controller';

describe('SetupWizardController company currency compatibility', () => {
  it('passes both explicit base and local selections to the transactional save', async () => {
    const service = { saveStep5Currency: jest.fn().mockResolvedValue({ success: true }) };
    const controller = new SetupWizardController(service as any);
    await controller.saveStep5Currencies('co-1', 'base-1', 'local-1');
    expect(service.saveStep5Currency).toHaveBeenCalledWith('co-1', 'base-1', 'local-1');
  });

  it('keeps the legacy base-only route forwarding without inventing a local selection', async () => {
    const service = { saveStep5Currency: jest.fn().mockResolvedValue({ success: true }) };
    const controller = new SetupWizardController(service as any);
    await controller.saveStep5('co-1', 'base-1');
    expect(service.saveStep5Currency).toHaveBeenCalledWith('co-1', 'base-1');
  });

  it('saves the timezone from the body so a slash in the id cannot break the route', async () => {
    const service = { saveStep6Timezone: jest.fn().mockResolvedValue({ success: true }) };
    const controller = new SetupWizardController(service as any);
    await controller.saveStep6Body('co-1', { timezone_id: 'Asia/Kolkata', country_id: 'ind' });
    expect(service.saveStep6Timezone).toHaveBeenCalledWith('co-1', 'Asia/Kolkata', 'IND');
  });
});
