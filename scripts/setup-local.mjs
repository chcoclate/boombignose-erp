#!/usr/bin/env node
/**
 * One-command local setup for trying the app with demo data.
 *
 *   pnpm install
 *   pnpm setup:local
 *   pnpm dev
 *
 * Starts the local Supabase stack (migrations + seed run on first start),
 * then writes `.env.local` from `.env.example` with the local keys and the
 * demo-login button enabled. Safe to re-run: existing `.env.local` values are
 * kept except the Supabase URL/keys, which are refreshed from the stack.
 * Local development only — never use the demo login on a real deployment.
 */
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ENV_LOCAL = path.join(ROOT, ".env.local")
const ENV_EXAMPLE = path.join(ROOT, ".env.example")
const IS_WINDOWS = process.platform === "win32"

// Services the app does not need locally; skipping them makes the first
// start download far fewer Docker images.
const EXCLUDED_SERVICES = [
  "studio",
  "imgproxy",
  "vector",
  "logflare",
  "edge-runtime",
  "supavisor",
]

const DEMO_EMAIL = "demo@boombignose.org"
const DEMO_PASSWORD = "BoomDemo123!"

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

function run(cmd, args, { capture = false } = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    shell: IS_WINDOWS,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  })
}

function supabase(args, opts) {
  return run("pnpm", ["exec", "supabase", ...args], opts)
}

/** Set KEY=value in dotenv text, replacing an existing line or appending. */
export function setEnv(text, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, "m")
  if (re.test(text)) return text.replace(re, () => line)
  return `${text.replace(/\n?$/, "\n")}${line}\n`
}

/** Read KEY's value from dotenv text ("" when missing). */
export function getEnv(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"))
  return m ? m[1].trim().replace(/^"(.*)"$/, "$1") : ""
}

function main() {
  console.log("▶ ตรวจเครื่อง (checking prerequisites)")

  const major = Number(process.versions.node.split(".")[0])
  if (major < 22) fail(`ต้องใช้ Node.js 22 ขึ้นไป (ตอนนี้ ${process.versions.node})`)

  if (!existsSync(path.join(ROOT, "node_modules", ".bin"))) {
    fail("ยังไม่ได้ติดตั้ง dependencies — รัน `pnpm install` ก่อน")
  }

  const docker = run("docker", ["info"], { capture: true })
  if (docker.error || docker.status !== 0) {
    fail("Docker ยังไม่ทำงาน — เปิด Docker Desktop รอจนขึ้นว่า running แล้วรันใหม่")
  }

  console.log("▶ เปิดฐานข้อมูล Supabase (ครั้งแรกจะโหลด image นานหลายนาที)")
  const start = supabase(["start", "-x", EXCLUDED_SERVICES.join(",")])
  if (start.status !== 0) {
    fail(
      "supabase start ไม่สำเร็จ — ดู error ด้านบน ถ้าเป็นเรื่องโหลด image ไม่ได้ (rate limit) ให้รอสักครู่แล้วรันใหม่"
    )
  }

  const status = supabase(["status", "-o", "env"], { capture: true })
  if (status.status !== 0) fail(`อ่านค่าจาก supabase status ไม่ได้\n${status.stderr}`)
  const apiUrl = getEnv(status.stdout, "API_URL")
  const anonKey = getEnv(status.stdout, "ANON_KEY") || getEnv(status.stdout, "PUBLISHABLE_KEY")
  const serviceKey = getEnv(status.stdout, "SERVICE_ROLE_KEY") || getEnv(status.stdout, "SECRET_KEY")
  if (!apiUrl || !anonKey || !serviceKey) fail("supabase status ไม่มี API URL หรือ key")

  console.log("▶ เขียนไฟล์ .env.local")
  if (!existsSync(ENV_LOCAL)) copyFileSync(ENV_EXAMPLE, ENV_LOCAL)
  let env = readFileSync(ENV_LOCAL, "utf8")
  env = setEnv(env, "NEXT_PUBLIC_SUPABASE_URL", apiUrl)
  env = setEnv(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey)
  env = setEnv(env, "SUPABASE_SERVICE_ROLE_KEY", serviceKey)
  if (!getEnv(env, "NEXT_PUBLIC_DEMO_LOGIN_EMAIL")) {
    env = setEnv(env, "NEXT_PUBLIC_DEMO_LOGIN_EMAIL", DEMO_EMAIL)
  }
  if (!getEnv(env, "NEXT_PUBLIC_DEMO_LOGIN_PASSWORD")) {
    env = setEnv(env, "NEXT_PUBLIC_DEMO_LOGIN_PASSWORD", DEMO_PASSWORD)
  }
  writeFileSync(ENV_LOCAL, env)

  console.log(`
✓ พร้อมแล้ว

  1) รัน:   pnpm dev
  2) เปิด:  http://localhost:3000
  3) กดปุ่ม "Use demo account"  (หรือ ${DEMO_EMAIL} / ${DEMO_PASSWORD})

  หน้าโกดัง 3D: http://localhost:3000/warehouse
  ปิดฐานข้อมูลเมื่อเลิกใช้:  pnpm exec supabase stop
`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
