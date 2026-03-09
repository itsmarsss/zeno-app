import { build } from 'esbuild'
import { readdir, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { createWriteStream } from 'fs'
import archiver from 'archiver'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

async function bundle() {
  console.log('Building Lambda functions...')

  // Clean dist directory
  try {
    await rm(join(rootDir, 'dist'), { recursive: true })
  } catch (err) {
    // Directory might not exist
  }
  await mkdir(join(rootDir, 'dist'), { recursive: true })

  // Build all handlers
  await build({
    entryPoints: [
      'src/handlers/auth.ts',
      'src/handlers/analysis.ts',
    ],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outdir: 'dist',
    banner: {
      js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
    external: ['@aws-sdk/*'],
  })

  console.log('Creating Lambda deployment package...')

  // Create zip file
  const output = createWriteStream(join(rootDir, 'dist', 'lambda.zip'))
  const archive = archiver('zip', { zlib: { level: 9 } })

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log(`Lambda package created: ${archive.pointer()} bytes`)
      resolve()
    })

    archive.on('error', reject)
    archive.pipe(output)

    // Add all files from dist (except the zip itself)
    archive.directory('dist', false, (data) => {
      if (data.name.endsWith('.zip')) return false
      return data
    })

    archive.finalize()
  })
}

bundle().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
