# Offline license notices validation · 2026-10-18

`npm run licenses:generate` reads installed production entries from `package-lock.json` and writes `src/assets/licenses.json`. About renders this bundled JSON offline. Regeneration does not perform network requests or invent copyright text.

The generator searches package-root and nested `LICENSE`, `COPYING`, and `NOTICE` files (including bundled `*.LICENSE.txt` files), plus README legal sections. A short README declaration such as “MIT” remains a notice and does not satisfy the complete-text check. Packages omitted from an npm tarball can use an installed sibling notice only when their normalized repository URL and declared license match exactly. Every source retains its local path; inherited notices also retain donor package/version and repository provenance.

The current installed lockfile produces **488 package/version records; 1 still lacks a recognized full license text**. The generator writes this gap into `missing` and deliberately exits with status 1. This is a release gap; the dependency notice inventory is not claimed complete. The completeness check recognizes known license clauses and does not replace legal review.

Twenty formerly missing notices now use cached official upstream sources in `docs/licenses/`, with exact package versions, npm lockfile integrity, immutable upstream commit, original source URL and SHA-256 recorded in `docs/licenses/sources.json`. The generator refuses changed source bytes, mismatched package/repository/license/integrity, or changed runtime identity used for the supplementary notices below.

- `@nodable/entities@3.1.0`, `appdirsjs@1.2.8`, `fb-dotslash@0.5.8`, and the fifteen Metro/ob1 packages at `0.87.1` use the LICENSE file(s) at their npm release commit. Both upstream DotSlash license alternatives are included.
- `boolbase@1.0.0` uses the official ISC notice added in commit `be0bcd8a4e917a0a5895e95b523fbbed05a64871`. That commit still declares package version `1.0.0`, and its runtime `index.js` is byte-for-byte identical to the installed npm package. This historical source relationship is retained explicitly.
- `standard-navigation@0.0.8` has an npm gitHead unavailable in the official repository. Official release `0.0.9` includes the added LICENSE; both shipped `lib` files exactly match installed `0.0.8`. Source release version, tarball, integrity, commit, and matching runtime SHA-256 values are retained; the generator checks those installed files. No dependency was upgraded.

The remaining gap is `ansi-fragments@0.2.1`. Its official `v0.2.1` tag (`1d295b28cc509071fbb68f1234a217805000a427`) and npm tarball contain no LICENSE/COPYING/NOTICE. README links the standard MIT text, but it does not supply a project copyright notice. The inventory keeps this gap rather than inventing a rightsholder or year.

Current inherited local sources include React Native, React, Flow, and Hermes monorepo license files. Nested donors retain the original file path even when another sibling supplies the same notice. No application or native-device behavior was validated by this generation step.

Re-run the generator after dependency installation or upgrades and review its source paths and `missing` list before release. Device checks for offline rendering, copied native version/build metadata, and external links remain separate acceptance work.
