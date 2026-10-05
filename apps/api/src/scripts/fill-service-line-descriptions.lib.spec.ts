import { planServiceDescriptions, type ServiceLineRow } from './fill-service-line-descriptions.lib';

const L = (over: Partial<ServiceLineRow>): ServiceLineRow => ({
  line_id: 'l1', req_no: 'RQ-00008', line_seq: 1, doc_type: 'SERVICE', description: null,
  resource_id: 'r1', resource_code: 'PWP-02', resource_name: 'Pressure washer service', ...over,
});

describe('planServiceDescriptions — a Service line is Description + Qty; an empty description takes its Resource name', () => {
  it('fills an empty description from the resource name (RQ-00008)', () => {
    expect(planServiceDescriptions([L({})])).toEqual({
      set: [{ line_id: 'l1', at: 'RQ-00008 line 1', description: 'Pressure washer service' }],
      skipped: [],
    });
  });

  it('treats a blank description as empty', () => {
    expect(planServiceDescriptions([L({ description: '  ' })]).set).toHaveLength(1);
  });

  it('never overwrites a description, and leaves non-Service and resource-less lines alone', () => {
    const plan = planServiceDescriptions([
      L({ line_id: 'kept', description: 'Vet call-out' }),
      L({ line_id: 'fa', doc_type: 'FA' }),
      L({ line_id: 'none', resource_id: null, resource_code: null, resource_name: null }),
    ]);
    expect(plan).toEqual({ set: [], skipped: [] });
  });

  it('reports a line whose resource has no name rather than inventing one', () => {
    expect(planServiceDescriptions([L({ resource_name: null })])).toEqual({
      set: [], skipped: [{ at: 'RQ-00008 line 1', reason: 'resource PWP-02 has no name' }],
    });
  });

  it('cuts the name to the 200 characters a description may hold', () => {
    expect(planServiceDescriptions([L({ resource_name: 'x'.repeat(250) })]).set[0].description).toHaveLength(200);
  });
});
