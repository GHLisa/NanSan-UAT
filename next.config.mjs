/** @type {import('next').NextConfig} */
// [效能] optimizePackageImports 能縮小正式環境 bundle、降低 hydration 成本，
// 但在 dev 模式會額外分析 antd 這個超大套件的匯入，反而拉長冷編譯時間。
// 因此僅在正式 build（NODE_ENV=production）啟用，dev 維持原本編譯速度。
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  ...(isProd
    ? { experimental: { optimizePackageImports: ['antd', '@ant-design/icons'] } }
    : {}),
};

export default nextConfig;
