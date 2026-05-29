import { createArtifactChecks } from './artifact-checks.mjs'

const root = process.cwd()
const profile = getArgValue('--profile') || 'quick'
const validProfiles = new Set(['quick', 'full', 'release'])

if (!validProfiles.has(profile)) {
  throw new Error(`Unknown artifact smoke profile: ${profile}`)
}

const artifactChecks = await createArtifactChecks({
  root,
  profile
})

for (const target of artifactChecks.targets) {
  await artifactChecks.verifyTarget(target)
}

console.log(`Artifact smoke checks passed for ${artifactChecks.targets.length} targets`)

function getArgValue(name) {
  const index = process.argv.findIndex((arg) => arg === name)
  return index >= 0 ? process.argv[index + 1] : ''
}
