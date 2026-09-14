import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The roles screen renders a fixed list of module/resource pairs, and the API
 * guards its routes with @RequirePermission(module, resource, action). If the
 * two drift apart, a permission can be enforced that no role is able to grant —
 * a custom role is then locked out of a screen with nothing in the UI to explain
 * why, because the missing permission simply isn't offered.
 *
 * Six pairs had drifted this way, PIGGERY/ANIMAL among them, so the animal
 * register was ungrantable to any non-admin role.
 */

const ROLES_TAB = join(
  __dirname,
  '../src/components/console/console-tabs/roles-tab.tsx',
);
const API_MODULES = join(__dirname, '../../api/src/modules');

function offeredByRolesScreen(): Set<string> {
  const source = readFileSync(ROLES_TAB, 'utf8');
  return new Set(
    [
      ...source.matchAll(
        /module_code:\s*["']([A-Z_]+)["'],\s*resource:\s*["']([A-Z_]+)["']/g,
      ),
    ].map((m) => `${m[1]}/${m[2]}`),
  );
}

function enforcedByApi(): Set<string> {
  const pairs = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
        const source = readFileSync(full, 'utf8');
        for (const m of source.matchAll(
          /RequirePermission\(\s*'([A-Z_]+)'\s*,\s*'([A-Z_]+)'/g,
        )) {
          pairs.add(`${m[1]}/${m[2]}`);
        }
      }
    }
  };
  walk(API_MODULES);
  return pairs;
}

describe('Role permissions coverage', () => {
  it('offers every permission the API enforces', () => {
    const offered = offeredByRolesScreen();
    const enforced = enforcedByApi();
    const ungrantable = [...enforced].filter((p) => !offered.has(p)).sort();

    expect(ungrantable).toEqual([]);
  });

  it('labels every offered permission with a translation key that exists', () => {
    // A missing key renders as the raw key string in the roles table — visible,
    // ugly, and easy to ship when a row is added without its label.
    const source = readFileSync(ROLES_TAB, 'utf8');
    const keys = [
      ...source.matchAll(/nameKey:\s*["']([A-Za-z0-9_]+)["']/g),
    ].map((m) => m[1]);
    const translations = readFileSync(
      join(__dirname, '../src/utils/translations.ts'),
      'utf8',
    );

    const missing = keys
      .filter((k) => !new RegExp(`^\\s{4}${k}:`, 'm').test(translations))
      .sort();

    expect(missing).toEqual([]);
  });

  it('offers nothing the API never checks', () => {
    const offered = offeredByRolesScreen();
    const enforced = enforcedByApi();
    const unenforced = [...offered].filter((p) => !enforced.has(p)).sort();

    expect(unenforced).toEqual([]);
  });
});
