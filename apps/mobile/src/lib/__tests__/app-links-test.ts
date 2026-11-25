/**
 * Android App Links: invite links (https://bdgtr.erroldee.com/invite/…) open
 * the app only if the website's assetlinks.json names this exact app and the
 * app declares a verified link filter for that host.
 */
import assetlinks from '../../../public/.well-known/assetlinks.json';
import appJson from '../../../app.json';

describe('App Links', () => {
  const statement = assetlinks[0]!;
  const filter = appJson.expo.android.intentFilters[0]!;

  it('the website vouches for this app (same package, a SHA-256 signing fingerprint)', () => {
    expect(statement.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(statement.target.namespace).toBe('android_app');
    expect(statement.target.package_name).toBe(appJson.expo.android.package);
    for (const fp of statement.target.sha256_cert_fingerprints) expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it('the app claims only invite links on the real website, verified (autoVerify), https only', () => {
    expect(filter).toMatchObject({ action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'] });
    expect(filter.data).toEqual([{ scheme: 'https', host: 'bdgtr.erroldee.com', pathPrefix: '/invite/' }]);
  });
});
