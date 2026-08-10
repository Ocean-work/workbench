import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages 部署在 /workbench/ 子路径下，使用绝对路径确保动态 import 正确解析
  base: '/workbench/',
})
