/**
 * Every extension barrel must export each name exactly once.
 *
 * This test lives here rather than in each package because it is one rule about the whole
 * repository, and because the failure it catches is invisible to an ordinary suite.
 *
 * ## Why an ordinary test cannot see this
 *
 * Two modules in one `export *` barrel exporting the same runtime name make `index.ts`
 * throw `Cannot redefine property` the moment it is imported. Unit tests import the modules
 * **directly**, so they never load the barrel and never notice — and a suite that fails to
 * load reports zero tests and zero failures, so a count-based sweep reads the package as
 * healthy while the application would not start.
 *
 * Duplicate *types* are quieter still: babel erases them, so nothing fails at test time and
 * only a type-check or a build complains.
 *
 * The check is static on purpose: importing forty barrels would pull in React components,
 * viewport code and DICOM parsers, and the failure would then depend on load order.
 */
import fs from 'fs';
import path from 'path';

// __dirname is <repo>/extensions/rt-services/src, so two levels up is extensions/.
const EXTENSIONS_DIR = path.resolve(__dirname, '../..');

const EXPORTED = new RegExp(
  String.raw`^export\s+(?:declare\s+)?(?:async\s+)?` +
    String.raw`(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z0-9_$]+)`,
  'gm'
);
const STAR_EXPORT = /export \* from '\.\/([A-Za-z0-9_/-]+)'/g;

interface Barrel {
  pkg: string;
  duplicates: Array<{ name: string; modules: string[] }>;
}

function readBarrel(pkg: string): Barrel | null {
  const srcDir = path.join(EXTENSIONS_DIR, pkg, 'src');
  const indexPath = path.join(srcDir, 'index.ts');
  if (!fs.existsSync(indexPath)) {
    return null;
  }
  const index = fs.readFileSync(indexPath, 'utf8');
  const owners = new Map<string, string[]>();

  STAR_EXPORT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STAR_EXPORT.exec(index)) !== null) {
    const modulePath = path.join(srcDir, `${match[1]}.ts`);
    if (!fs.existsSync(modulePath)) {
      continue;
    }
    const body = fs.readFileSync(modulePath, 'utf8');
    EXPORTED.lastIndex = 0;
    const names = new Set<string>();
    let name: RegExpExecArray | null;
    while ((name = EXPORTED.exec(body)) !== null) {
      names.add(name[1]);
    }
    for (const n of names) {
      owners.set(n, [...(owners.get(n) ?? []), match[1]]);
    }
  }

  return {
    pkg,
    duplicates: [...owners.entries()]
      .filter(([, modules]) => modules.length > 1)
      .map(([name, modules]) => ({ name, modules: modules.sort() })),
  };
}

describe('every extension barrel exports each name once', () => {
  const packages = fs
    .readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  const barrels = packages.map(readBarrel).filter(Boolean) as Barrel[];

  it('finds barrels to check', () => {
    expect(barrels.length).toBeGreaterThan(10);
  });

  it.each(barrels.map(b => [b.pkg, b] as const))('%s', (_pkg, barrel) => {
    const report = barrel.duplicates
      .map(d => `${d.name} exported by ${d.modules.join(' and ')}`)
      .join('; ');
    expect(report).toBe('');
  });
});
