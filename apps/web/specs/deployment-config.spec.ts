const createNextConfig = require('../next.config.js');

describe('Windows production deployment configuration', () => {
  const originalMode = process.env.NAVFARM_API_MODE;
  const originalUpstream = process.env.NAVFARM_API_UPSTREAM_URL;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.NAVFARM_API_MODE;
    else process.env.NAVFARM_API_MODE = originalMode;
    if (originalUpstream === undefined) delete process.env.NAVFARM_API_UPSTREAM_URL;
    else process.env.NAVFARM_API_UPSTREAM_URL = originalUpstream;
  });

  it('proxies API and upload requests to the private API origin', async () => {
    process.env.NAVFARM_API_MODE = 'proxy';
    process.env.NAVFARM_API_UPSTREAM_URL = 'http://127.0.0.1:2877';

    const config = createNextConfig('phase-production-build');

    await expect(config.rewrites()).resolves.toEqual([
      { source: '/api/v1/:path*', destination: 'http://127.0.0.1:2877/api/v1/:path*' },
      { source: '/uploads/:path*', destination: 'http://127.0.0.1:2877/uploads/:path*' },
    ]);
  });

  it('rejects credentials or path data in the private upstream URL', async () => {
    process.env.NAVFARM_API_MODE = 'proxy';
    process.env.NAVFARM_API_UPSTREAM_URL = 'http://user:secret@127.0.0.1:2877/private';

    const config = createNextConfig('phase-production-build');

    await expect(config.rewrites()).rejects.toThrow(/must not contain credentials|must be an origin/);
  });

  it('keeps the web production port explicit in its Nx target', () => {
    const webPackage = require('../package.json');

    expect(webPackage.nx.targets.start.options.command)
      .toBe('next start --hostname 0.0.0.0 --port 3002');
  });
});
