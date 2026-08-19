import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING', 'COPYING.txt']

function readLicense(dir) {
  for (const f of LICENSE_FILES) {
    const p = path.join(dir, f)
    if (existsSync(p)) return readFileSync(p, 'utf8').trim()
  }
  return null
}

function normalizeLicense(license) {
  if (typeof license === 'string') return license
  if (license && typeof license.type === 'string') return license.type
  if (Array.isArray(license)) return license.map(normalizeLicense).filter(Boolean).join(' OR ')
  return 'UNKNOWN'
}

function npmPackages() {
  const res = spawnSync('npm', ['ls', '--omit=dev', '--parseable', '--all'], { cwd: root })
  const out = res.stdout.toString()
  const seen = new Set()
  const pkgs = []
  for (const line of out.split('\n')) {
    const dir = line.trim()
    if (!dir || dir === root) continue
    const pkgFile = path.join(dir, 'package.json')
    if (!existsSync(pkgFile)) continue
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    if (!pkg.name) continue
    const key = `${pkg.name}@${pkg.version}`
    if (seen.has(key)) continue
    seen.add(key)
    pkgs.push({
      name: pkg.name,
      version: pkg.version,
      license: normalizeLicense(pkg.license),
      text: readLicense(dir),
    })
  }
  return pkgs
}

function renderNpm(pkgs) {
  const byText = new Map()
  const noText = []
  for (const pkg of pkgs) {
    if (pkg.text) {
      const key = `${pkg.license}::${pkg.text}`
      if (!byText.has(key)) byText.set(key, { license: pkg.license, text: pkg.text, used: [] })
      byText.get(key).used.push(`${pkg.name} ${pkg.version}`)
    } else {
      noText.push(`${pkg.name} ${pkg.version} (${pkg.license})`)
    }
  }
  const entries = [...byText.values()].sort((a, b) => a.license.localeCompare(b.license))
  let md = '## JavaScript dependencies\n\n'
  for (const e of entries) {
    md += `### ${e.license}\n\nUsed by:\n\n`
    for (const u of e.used.sort()) md += `- ${u}\n`
    md += `\n\`\`\`text\n${e.text}\n\`\`\`\n\n`
  }
  if (noText.length) {
    md += '### Packages without a bundled license file\n\n'
    for (const n of noText.sort()) md += `- ${n}\n`
    md += '\n'
  }
  return md
}

function renderRust() {
  const out = execFileSync('cargo', ['about', 'generate', 'about.hbs'], {
    cwd: path.join(root, 'src-tauri'),
    encoding: 'utf8',
  })
  return `## Rust dependencies\n\n${out}`
}

function main() {
  const pkgs = npmPackages()
  const header = [
    '# Third-Party Licenses',
    '',
    'This file lists the licenses of third-party dependencies bundled with FormulaForge.',
    'It is generated automatically; do not edit by hand. Run `npm run generate:licenses` to regenerate.',
    '',
  ].join('\n')
  const out = `${header}\n${renderNpm(pkgs)}\n${renderRust()}`
  const target = path.join(root, 'THIRD_PARTY_LICENSES.md')
  writeFileSync(target, out)
  console.log(`Wrote ${path.relative(root, target)} (${pkgs.length} npm packages, Rust via cargo-about)`)
}

main()
