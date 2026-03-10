import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  server: {
    host: true,
    port: 3001,
    allowedHosts: ['vm10.lan']
  },
  build: {
    target: 'esnext'
  }
})
