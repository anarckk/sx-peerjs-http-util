import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const entryFile = resolve(__dirname, '../src/index.ts');
const outDir = resolve(__dirname, '../dist');
const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));
const VERSION = packageJson.version;

async function build() {
  try {
    // 1. 构建 ESM 格式 (用于 npm 引入)
    // peerjs 作为外部依赖，由用户自行安装
    await esbuild.build({
      entryPoints: [entryFile],
      outfile: join(outDir, 'index.esm.js'),
      format: 'esm',
      bundle: true,
      external: ['peerjs'], // npm 用户自行安装 peerjs
      sourcemap: true,
      target: ['es2022'],
      define: {
        __VERSION__: JSON.stringify(VERSION),
      },
    });
    console.log('✓ ESM build complete');

    // 2. 构建 UMD/IIFE 格式 (用于 CDN 引入)
    // 打包 peerjs 进去，用户只需引入一个 CDN 文件
    await esbuild.build({
      entryPoints: [entryFile],
      outfile: join(outDir, 'index.umd.js'),
      format: 'iife',
      globalName: 'PeerJsHttpUtil',
      bundle: true,
      // 不设置 external，直接打包 peerjs
      sourcemap: true,
      target: ['es2022'],
      define: {
        __VERSION__: JSON.stringify(VERSION),
      },
    });
    console.log('✓ UMD/IIFE build complete');

    console.log('\n✅ All builds complete!');
    console.log('\n使用方式:');
    console.log('  NPM: npm install sx-peerjs-http-util peerjs');
    console.log('  CDN: <script src="https://unpkg.com/sx-peerjs-http-util/dist/index.umd.js"></script>');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
