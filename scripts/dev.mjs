// Starts the API and the web app together. Ctrl+C stops both. Works on Windows, macOS and Linux.
import { spawn } from 'node:child_process'

const run = (name, args) => {
  const p = spawn(process.execPath, args, { stdio: 'inherit' })
  p.on('exit', (code) => {
    console.log(`[${name}] exited (${code})`)
    process.exit(code ?? 0)
  })
  return p
}

const api = run('api', ['--env-file=dev.env', '--import', 'tsx', 'src/backend/server.ts'])
const web = run('web', ['node_modules/vite/bin/vite.js'])
const stop = () => { api.kill(); web.kill() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
