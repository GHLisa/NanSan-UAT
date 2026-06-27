// ── 字串加解密（AES-256-CBC + PKCS7）─────────────────────────────────────
// 對應專案 StringEncryption 規範的 Node.js 移植版，沿用相同 Master Key/IV，
// 與 .NET 版（Encryption.cs）密文可互通。
//
// 雙層金鑰架構：
//   Master Key/IV（本檔硬編碼）
//     └─ 加密 → Data Key/IV（存於環境變數 SYS_KEY / SYS_IV，為 Master 加密後的值）
//                  └─ 加密 → 實際敏感字串（如 SMTP_PASS，存於環境變數，為 Data Key/IV 加密後的值）
//
// 所有密文皆為 Base64 字串，明文皆為 UTF-8 字串。

import crypto from 'crypto'

const MASTER_KEY = 'i7MijypG5IphnTvCOZdkSR0T/IXmycqKXbRD6yh/XP8=' // Base64, 256-bit
const MASTER_IV = 'avQ9FrRIuvTk7+v2kFqqkA==' // Base64, 128-bit
const ALGO = 'aes-256-cbc'

function aesEncode(keyB64: string, ivB64: string, plain: string): string {
  const cipher = crypto.createCipheriv(ALGO, Buffer.from(keyB64, 'base64'), Buffer.from(ivB64, 'base64'))
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64')
}

function aesDecode(keyB64: string, ivB64: string, cipherB64: string): string {
  const decipher = crypto.createDecipheriv(ALGO, Buffer.from(keyB64, 'base64'), Buffer.from(ivB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(cipherB64, 'base64')), decipher.final()]).toString('utf8')
}

// ── Master 層（保護 Data Key/IV 用）──────────────────────────────────────
export function encodeMaster(plain: string): string {
  return aesEncode(MASTER_KEY, MASTER_IV, plain)
}
export function decodeMaster(cipher: string): string {
  return aesDecode(MASTER_KEY, MASTER_IV, cipher)
}

// ── Data 層（以自訂 Key/IV 保護實際資料用）──────────────────────────────
export function encode(key: string, iv: string, plain: string): string {
  return aesEncode(key, iv, plain)
}
export function decode(key: string, iv: string, cipher: string): string {
  return aesDecode(key, iv, cipher)
}

// 產生一組新的 Data Key/IV（明文 Base64）
export function generateKeyIV(): { key: string; iv: string } {
  return {
    key: crypto.randomBytes(32).toString('base64'),
    iv: crypto.randomBytes(16).toString('base64'),
  }
}

// ── 便捷解密：給定「Master 加密過的 Data Key/IV」與「Data 加密過的值」，還原明文 ──
// 找不到 SYS_KEY / SYS_IV 時回傳 null，呼叫端可退回視為明文（dev 友善）。
export function decodeSecret(encValue: string): string | null {
  const encKey = process.env.SYS_KEY
  const encIv = process.env.SYS_IV
  if (!encKey || !encIv) return null
  const key = decodeMaster(encKey)
  const iv = decodeMaster(encIv)
  return decode(key, iv, encValue)
}
