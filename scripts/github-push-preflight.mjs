import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const EXPECTED_REMOTE_URL = process.env.GOODS_COMM_GITHUB_REMOTE_URL || 'https://github.com/lufeiz/goods-comm'
const EXPECTED_BRANCH = process.env.GOODS_COMM_GITHUB_BRANCH || 'main'
const REQUIRED_SCOPES = ['repo', 'workflow']
const STRICT_GH_AUTH = process.env.GOODS_COMM_GITHUB_PREFLIGHT_STRICT_GH_AUTH === 'true'

if (process.argv.includes('--self-test')) {
  runSelfTest()
  process.exit(0)
}

const allowDirty = process.argv.includes('--allow-dirty')
const failures = []
const warnings = []

checkRemoteUrl()
checkBranchAndUpstream()
checkWorkingTree()
checkGithubCliScopes()

if (failures.length > 0) {
  console.error('GitHub push preflight failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

if (warnings.length > 0) {
  console.warn('GitHub push preflight warnings:')
  for (const warning of warnings) {
    console.warn(`- ${warning}`)
  }
}

console.log('GitHub push preflight passed')

function checkRemoteUrl() {
  const remote = run('git', ['remote', 'get-url', 'origin'])
  if (remote.status !== 0) {
    failures.push('origin remote is missing; run `git remote add origin https://github.com/lufeiz/goods-comm`')
    return
  }

  const actual = normalizeRemoteUrl(remote.stdout)
  const expected = normalizeRemoteUrl(EXPECTED_REMOTE_URL)

  if (actual !== expected) {
    failures.push(`origin remote must be ${EXPECTED_REMOTE_URL}, got ${remote.stdout.trim() || '(empty)'}`)
  }
}

function checkBranchAndUpstream() {
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch.status !== 0) {
    failures.push('cannot resolve current Git branch')
    return
  }

  const currentBranch = branch.stdout.trim()
  if (currentBranch !== EXPECTED_BRANCH) {
    failures.push(`current branch must be ${EXPECTED_BRANCH}, got ${currentBranch || '(empty)'}`)
  }

  const upstream = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (upstream.status !== 0) {
    failures.push(`branch ${currentBranch || EXPECTED_BRANCH} must track origin/${EXPECTED_BRANCH}`)
    return
  }

  const expectedUpstream = `origin/${EXPECTED_BRANCH}`
  const actualUpstream = upstream.stdout.trim()
  if (actualUpstream !== expectedUpstream) {
    failures.push(`branch upstream must be ${expectedUpstream}, got ${actualUpstream || '(empty)'}`)
  }
}

function checkWorkingTree() {
  const status = run('git', ['status', '--porcelain=v1'])
  if (status.status !== 0) {
    failures.push('cannot inspect Git working tree status')
    return
  }

  const dirtyEntries = status.stdout.trim().split('\n').filter(Boolean)
  if (dirtyEntries.length > 0 && !allowDirty) {
    failures.push(`working tree must be clean before push; found ${dirtyEntries.length} changed path(s)`)
  }
}

function checkGithubCliScopes() {
  const workflowPush = pushTouchesWorkflowFiles()
  const strictAuth = STRICT_GH_AUTH || workflowPush
  const gh = run('gh', ['auth', 'status', '-h', 'github.com'])
  if (gh.status !== 0) {
    const message = 'GitHub CLI auth is unavailable; run `gh auth login` or `gh auth refresh -h github.com -s workflow`'
    if (strictAuth) {
      failures.push(message)
    } else {
      warnings.push(`${message}; continuing because no pending workflow file changes were detected`)
    }
    return
  }

  const scopes = parseGhAuthScopes(`${gh.stdout}\n${gh.stderr}`)
  for (const scope of REQUIRED_SCOPES) {
    if (!scopes.includes(scope)) {
      const message = `GitHub token must include ${scope} scope; run \`gh auth refresh -h github.com -s ${scope}\``
      if (strictAuth) {
        failures.push(message)
      } else {
        warnings.push(`${message}; continuing because no pending workflow file changes were detected`)
      }
    }
  }
}

function pushTouchesWorkflowFiles() {
  const changed = run('git', ['diff', '--name-only', '@{u}...HEAD'])
  if (changed.status !== 0) {
    failures.push('cannot inspect pending commits against upstream for workflow file changes')
    return true
  }

  return parseChangedFiles(changed.stdout).some(isWorkflowFile)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8'
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  }
}

function normalizeRemoteUrl(value = '') {
  return String(value || '')
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
}

function parseGhAuthScopes(output = '') {
  const clean = stripAnsi(String(output || ''))
  const match = clean.match(/Token scopes:\s*([^\n]+)/i)
  if (!match) {
    return []
  }

  return match[1]
    .replace(/['"`]/g, '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
}

function parseChangedFiles(output = '') {
  return String(output || '')
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean)
}

function isWorkflowFile(file = '') {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(String(file || '').trim())
}

function stripAnsi(value = '') {
  return String(value || '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

function runSelfTest() {
  assert.equal(
    normalizeRemoteUrl('https://github.com/lufeiz/goods-comm.git\n'),
    'https://github.com/lufeiz/goods-comm'
  )
  assert.deepEqual(
    parseGhAuthScopes("  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'\n"),
    ['gist', 'read:org', 'repo', 'workflow']
  )
  assert.deepEqual(parseGhAuthScopes('missing scope line'), [])
  assert.deepEqual(parseChangedFiles('README.md\n.github/workflows/ci.yml\n\n'), [
    'README.md',
    '.github/workflows/ci.yml'
  ])
  assert.equal(isWorkflowFile('.github/workflows/ci.yml'), true)
  assert.equal(isWorkflowFile('.github/workflows/release-strict.yaml'), true)
  assert.equal(isWorkflowFile('.github/actions/setup/action.yml'), false)
  console.log('GitHub push preflight self-test passed')
}
