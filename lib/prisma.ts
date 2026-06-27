import { PrismaClient } from '@prisma/client'

// BigInt 欄位（案件金額：estimatedAmount / deductible / adjustmentAmount / finalAmount）
// 預設無法被 JSON.stringify 序列化。以 toJSON → Number 讓 API 回傳維持數字型別，
// 前端與 types/index.ts（number）零改動。值域遠小於 2^53，無精度損失。
if (typeof (BigInt.prototype as { toJSON?: unknown }).toJSON !== 'function') {
  ;(BigInt.prototype as { toJSON?: () => number }).toJSON = function (this: bigint) {
    return Number(this)
  }
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
