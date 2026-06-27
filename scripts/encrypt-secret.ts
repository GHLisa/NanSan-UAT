// ── 敏感字串加密工具（取代 .NET 版 EncryptionTool）──────────────────────
// 用途：依 StringEncryption 雙層金鑰架構，加密要存進 .env 的敏感字串。
//
// 執行方式（於 web-site 目錄下）：
//
//   1) 產生一組新的 Data Key/IV（首次設定，或要換金鑰時）：
//        npm run encrypt -- --genkey
//      會印出 SYS_KEY / SYS_IV（已用 Master 加密），貼進 .env。
//
//   2) 加密一個明文字串（需先在 .env 設好 SYS_KEY / SYS_IV）：
//        npm run encrypt -- "要加密的明文"
//      會印出密文，貼進 .env 的對應欄位（如 SMTP_PASS）。

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { encodeMaster, encode, generateKeyIV, decodeMaster } from '../lib/encryption'

const arg = process.argv[2]

if (!arg) {
  console.error('用法：\n  npm run encrypt -- --genkey            產生新的 SYS_KEY / SYS_IV\n  npm run encrypt -- "明文"              加密字串（需先設好 SYS_KEY / SYS_IV）')
  process.exit(1)
}

if (arg === '--genkey') {
  const { key, iv } = generateKeyIV()
  console.info('// 將以下兩行貼入 .env（為 Master 加密後的 Data Key/IV）：')
  console.info(`SYS_KEY="${encodeMaster(key)}"`)
  console.info(`SYS_IV="${encodeMaster(iv)}"`)
  process.exit(0)
}

// 加密一般字串：需 SYS_KEY / SYS_IV
const encKey = process.env.SYS_KEY
const encIv = process.env.SYS_IV
if (!encKey || !encIv) {
  console.error('✗ 未設定 SYS_KEY / SYS_IV，請先執行：npm run encrypt -- --genkey 並貼入 .env')
  process.exit(1)
}
const key = decodeMaster(encKey)
const iv = decodeMaster(encIv)
console.info('密文（貼入 .env 對應欄位）：')
console.info(encode(key, iv, arg))
