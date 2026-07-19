import { fetchBranding } from './fetchBranding';

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

describe('fetchBranding', () => {
  const endpoint = 'https://connect.rtmedical.ai/api/branding/{tenantId}';

  it('returns null when no fetch implementation is available', async () => {
    const result = await fetchBranding({ endpoint, tenantId: 'a', fetchImpl: undefined });
    // jsdom provides no global fetch by default, so this resolves to null.
    expect(result).toBeNull();
  });

  it('substitutes and encodes the tenant id in the endpoint', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ productName: 'A' }));
    await fetchBranding({ endpoint, tenantId: 'hosp a/1', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://connect.rtmedical.ai/api/branding/hosp%20a%2F1',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('returns parsed branding on a 2xx response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ productName: 'Hospital A' }));
    const result = await fetchBranding({ endpoint, tenantId: 'a', fetchImpl });
    expect(result).toEqual({ productName: 'Hospital A' });
  });

  it('drops unsafe URLs and fields with invalid runtime types', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse({
        productName: 42,
        shortName: 'Hospital A',
        logoHref: 'javascript:alert(1)',
        logoUrl: '/assets/hospital-a.png',
        websiteUrl: 'data:text/html,boom',
        theme: { primary: '#123456', background: false },
      })
    );

    expect(await fetchBranding({ endpoint, tenantId: 'a', fetchImpl })).toEqual({
      shortName: 'Hospital A',
      logoUrl: '/assets/hospital-a.png',
      theme: { primary: '#123456' },
    });
  });

  it('returns null on a non-2xx response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, false));
    expect(await fetchBranding({ endpoint, tenantId: 'a', fetchImpl })).toBeNull();
  });

  it('returns null when the network call rejects', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    expect(await fetchBranding({ endpoint, tenantId: 'a', fetchImpl })).toBeNull();
  });

  it('returns null when the body is not a JSON object', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(['array']));
    expect(await fetchBranding({ endpoint, tenantId: 'a', fetchImpl })).toBeNull();
  });

  it('returns null when given an empty tenant id', async () => {
    const fetchImpl = jest.fn();
    expect(await fetchBranding({ endpoint, tenantId: '', fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
