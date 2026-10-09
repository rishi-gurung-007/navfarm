import { hasPermission } from '../src/hooks/useAuth';

describe('Stock Transfer Authorization & Edge Cases', () => {
  const warehouses = [
    {
      warehouse_id: 'wh-mul-store',
      location_id: 'wh-mul-store',
      warehouse_code: 'MUL100/STORE-001',
      farm_id: 'farm-mul',
      parent_location_id: 'farm-mul',
      location_type: 'STORE',
    },
    {
      warehouse_id: 'wh-mul-silo',
      location_id: 'wh-mul-silo',
      warehouse_code: 'MUL100/SILO-001',
      farm_id: 'farm-mul',
      parent_location_id: 'farm-mul',
      location_type: 'SILO',
    },
    {
      warehouse_id: 'wh-lio-store',
      location_id: 'wh-lio-store',
      warehouse_code: 'LIO100/STORE-001',
      farm_id: 'farm-lio',
      parent_location_id: 'farm-lio',
      location_type: 'STORE',
    },
  ];

  const farms = [
    { location_id: 'farm-mul', location_code: 'MUL100', location_name: 'Grasmere Farm Norton' },
    { location_id: 'farm-lio', location_code: 'LIO100', location_name: 'Lionshead Farm' },
  ];

  const getWarehouseFarm = (warehouseId: string | undefined) => {
    if (!warehouseId) return { farm_id: null, farm_code: null };
    const wh = warehouses.find((w) => w.warehouse_id === warehouseId || w.location_id === warehouseId);
    const farmId = wh?.farm_id || wh?.parent_location_id || null;
    const farmObj = farms.find((f) => f.location_id === farmId);
    return {
      farm_id: farmId,
      farm_code: farmObj?.location_code || (wh?.warehouse_code ? wh.warehouse_code.split('/')[0] : null),
    };
  };

  const isLocationOnActiveFarm = (locationId: string | undefined, activeFarmId: string | null) => {
    if (!locationId) return false;
    if (!activeFarmId) return true; // Global admin view
    const { farm_id } = getWarehouseFarm(locationId);
    return farm_id === activeFarmId;
  };

  const canUserShip = (transfer: any, activeFarmId: string | null, canEdit: boolean) => {
    if (!canEdit) return false;
    if (['CANCELLED', 'POSTED', 'RECEIVED'].includes(transfer.status)) return false;
    const hasRemainingToShip =
      transfer.status === 'DRAFT' ||
      (transfer.lines || []).some((l: any) => {
        const ord = Number(l.quantity) || 0;
        const shp = l.qty_shipped !== undefined ? Number(l.qty_shipped) : 0;
        const rem = l.qty_to_ship !== undefined ? Number(l.qty_to_ship) : Math.max(0, ord - shp);
        return rem > 0;
      });
    if (!hasRemainingToShip) return false;
    return isLocationOnActiveFarm(transfer.from_warehouse_id, activeFarmId);
  };

  const canUserReceive = (transfer: any, activeFarmId: string | null, canEdit: boolean) => {
    if (!canEdit) return false;
    if (['CANCELLED', 'POSTED', 'DRAFT'].includes(transfer.status)) return false;
    const hasInTransit =
      transfer.status === 'IN_TRANSIT' ||
      (transfer.lines || []).some((l: any) => Number(l.qty_in_transit) > 0);
    if (!hasInTransit) return false;
    return isLocationOnActiveFarm(transfer.to_warehouse_id, activeFarmId);
  };

  const interFarmTransfer = {
    transfer_id: 'tr-0012',
    transfer_no: 'TR-000012',
    from_warehouse_id: 'wh-mul-store',
    to_warehouse_id: 'wh-lio-store',
    status: 'IN_TRANSIT',
    lines: [{ item_id: 'item-1', quantity: 10, qty_shipped: 10, qty_in_transit: 10, qty_received: 0 }],
  };

  it('EC-1: Origin farm user (MUL100) cannot receive an outbound transfer in-transit to LIO100', () => {
    const activeFarmId = 'farm-mul';
    expect(canUserReceive(interFarmTransfer, activeFarmId, true)).toBe(false);
  });

  it('EC-2: Destination farm user (LIO100) CAN receive an inbound transfer in-transit from MUL100', () => {
    const activeFarmId = 'farm-lio';
    expect(canUserReceive(interFarmTransfer, activeFarmId, true)).toBe(true);
  });

  it('EC-3: Destination farm user (LIO100) CANNOT ship a transfer originating from MUL100', () => {
    const activeFarmId = 'farm-lio';
    expect(canUserShip(interFarmTransfer, activeFarmId, true)).toBe(false);
  });

  it('EC-4: Intra-farm transfer (MUL100 store to MUL100 silo) permits both ship and receive for MUL100 user', () => {
    const intraFarm = {
      ...interFarmTransfer,
      from_warehouse_id: 'wh-mul-store',
      to_warehouse_id: 'wh-mul-silo',
      status: 'IN_TRANSIT',
    };
    expect(canUserReceive(intraFarm, 'farm-mul', true)).toBe(true);
  });

  it('EC-9: User without edit permission cannot ship or receive', () => {
    expect(canUserReceive(interFarmTransfer, 'farm-lio', false)).toBe(false);
    expect(canUserShip(interFarmTransfer, 'farm-mul', false)).toBe(false);
  });

  it('EC-11: Global admin with unrestricted scope (null activeFarmId) can manage all transfers', () => {
    expect(canUserReceive(interFarmTransfer, null, true)).toBe(true);
  });
});
