import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// mail.tm 的 CORS 白名单不允许浏览器直连，
// 开发/预览时通过本地代理把 /api 转发到 mail.tm（生产环境用 VITE_MAIL_API_BASE 指向自建后端或反代）。
const mailProxy = {
  '/api': {
    target: 'https://api.mail.tm',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: mailProxy,
  },
  preview: {
    proxy: mailProxy,
  },
})
