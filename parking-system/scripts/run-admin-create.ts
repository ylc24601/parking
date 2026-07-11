// Provision an Admin UI operator account (Phase 8 Slice 1).
//   npm run admin:create -- --username alice [--display-name 王姐妹]           # generated password, printed ONCE
//   echo 'S3cret-Pass-Word!' | npm run admin:create -- --username alice --stdin # caller-chosen, nothing in argv
//
// There is deliberately NO --password flag: a password on the command line may be
// retained in shell history / the process list (the caveat documented on
// staff:set-pin). The plaintext password is never stored or logged — only its
// scrypt hash lands in admin_accounts.password_hash.
try {
  process.loadEnvFile('.env.local')
} catch {
  /* env may be provided by the shell instead */
}

import { randomBytes } from 'node:crypto'
import { createAdminAccount } from '../server/services/adminAuthService'

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const username = argValue('--username')
  if (!username) {
    throw new Error('usage: admin:create --username <name> [--display-name <text>] [--stdin]')
  }

  let password: string
  let generated = false
  if (hasFlag('--stdin')) {
    password = (await readStdin()).trim()
    if (!password) throw new Error('--stdin given but no password arrived on stdin')
  } else {
    password = randomBytes(18).toString('base64url') // 24 chars, ~144 bits
    generated = true
  }

  const account = await createAdminAccount({
    username,
    password,
    displayName: argValue('--display-name') ?? null,
  })

  console.log(`Admin account created: ${account.username}`)
  if (generated) {
    // The one deliberate print — it cannot be recovered afterwards.
    console.log('')
    console.log('  一次性密碼（僅顯示這一次，請立即存入教會密碼管理器）:')
    console.log(`  ${password}`)
    console.log('')
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
