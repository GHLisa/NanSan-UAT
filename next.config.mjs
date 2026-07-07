/** @type {import('next').NextConfig} */
// [效能] optimizePackageImports 能縮小正式環境 bundle、降低 hydration 成本，
// 但在 dev 模式會額外分析 antd 這個超大套件的匯入，反而拉長冷編譯時間。
// 因此僅在正式 build（NODE_ENV=production）啟用，dev 維持原本編譯速度。
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  ...(isProd
    ? { experimental: { optimizePackageImports: ['antd', '@ant-design/icons'] } }
    : {}),
  // 主頁面環境資訊（部署日期以台北時區 UTC+8 於 build 時自動帶入）
  env: {
    NEXT_PUBLIC_APP_ENV: 'UAT',
    NEXT_PUBLIC_DEPLOY_DATE: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
  },
};

export default nextConfig;
