/** @type {import('next').NextConfig} */
const nextConfig = {
  // build gọn cho Docker: server.js tự chứa + node_modules đã trace
  output: 'standalone',
  // mongoose là package server-only, tránh bundle vào client
  serverExternalPackages: ['mongoose', 'bcryptjs'],
  // "/" phục vụ trang xem (public viewer) tĩnh trong /public/viewer
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', destination: '/viewer/index.html' }],
    };
  },
};

export default nextConfig;
