import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function copyIfChanged(source, target, versionFile) {
  if (!existsSync(source)) {
    throw new Error(`Vendor asset source not found: ${source}`)
  }
  const versionPath = path.join(versionFile)
  const stampPath = path.join(target, '.vendor-version')
  let currentVersion = 'dev'
  try {
    const pkg = JSON.parse(await readFile(versionPath, 'utf8'))
    currentVersion = pkg.version ?? 'dev'
  } catch {
    currentVersion = 'dev'
  }
  let existingVersion = ''
  try {
    existingVersion = (await readFile(stampPath, 'utf8')).trim()
  } catch {
    existingVersion = ''
  }
  if (existingVersion === currentVersion && existsSync(target)) {
    return { copied: false, version: currentVersion }
  }
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(source, target, { recursive: true })
  await writeFile(stampPath, currentVersion)
  return { copied: true, version: currentVersion }
}

async function main() {
  const results = []
  results.push(
    await copyIfChanged(
      path.join(root, 'node_modules/mathlive/fonts'),
      path.join(root, 'public/mathlive/fonts'),
      path.join(root, 'node_modules/mathlive/package.json'),
    ),
  )
  results.push(
    await copyIfChanged(
      path.join(root, 'node_modules/mathjax'),
      path.join(root, 'public/mathjax'),
      path.join(root, 'node_modules/mathjax/package.json'),
    ),
  )
  results.push(
    await copyIfChanged(
      path.join(root, 'node_modules/@mathjax/mathjax-newcm-font'),
      path.join(root, 'public/mathjax-newcm-font'),
      path.join(root, 'node_modules/@mathjax/mathjax-newcm-font/package.json'),
    ),
  )
  for (const r of results) {
    if (r.copied) {
      console.log(`[vendor] copied asset (version ${r.version})`)
    }
  }
}

main().catch((error) => {
  console.error('[vendor] failed:', error.message)
  process.exit(1)
})
