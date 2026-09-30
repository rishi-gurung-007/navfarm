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
});
