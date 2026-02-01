import axios from "axios";
import fs from "fs/promises";
import os from "os";
import dns from "dns/promises";
import path from "path";

/**
 * health.js
 * Robust health check endpoint for Vercel middleware (delivery-middleware).
 *
 * - Performs lightweight runtime checks (uptime, memory, load)
 * - Verifies presence of critical environment variables
 * - Attempts a safe, non-blocking connectivity check to WhatsApp Graph API if credentials exist
 * - Verifies local menu.json presence and basic parseability
 * - Performs DNS resolution for DATABASE_URL host (if provided) as a non-invasive DB reachability hint
 * - Returns structured JSON suitable for monitoring, dashboards and automated alerts
 *
 * Notes:
 * - Keep this handler fast and idempotent. Network checks use short timeouts.
 * - Avoid heavy or blocking operations. This endpoint is intended for monitoring only.
 */

const WHATSAPP_GRAPH_BASE = "https://graph.facebook.com";
const LOCAL_MENU_PATH = path.resolve(process.cwd(), "menu.json");
const WHATSAPP_TIMEOUT_MS = 3000; // short timeout for health probe
const PACKAGE_JSON_PATH = path.resolve(process.cwd(), "package.json");

async function checkWhatsApp() {
  const id = process.env.WHATSAPP_BUSINESS_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!id || !token) {
    return { ok: false, reason: "missing_env", details: "WHATSAPP_BUSINESS_ID or WHATSAPP_TOKEN not set" };
  }

  const url = `${WHATSAPP_GRAPH_BASE}/v18.0/${id}`;
  try {
    const r = await axios.get(url, {
      timeout: WHATSAPP_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: () => true
    });

    // Accept 200 as healthy; 400/401/403 indicate auth/permission issues (report them)
    if (r.status === 200) {
      return { ok: true, status: r.status, details: "WhatsApp Graph reachable" };
    } else {
      return {
        ok: false,
        status: r.status,
        reason: "api_response",
        details: r.data || `HTTP ${r.status}`
      };
    }
  } catch (err) {
    return { ok: false, reason: "network_error", details: err.message || String(err) };
  }
}

async function checkLocalMenu() {
  try {
    const stat = await fs.stat(LOCAL_MENU_PATH);
    if (!stat.isFile()) {
      return { ok: false, reason: "not_a_file", path: LOCAL_MENU_PATH };
    }
    // Try to read and parse first KB to ensure valid JSON structure (non-blocking)
    const content = await fs.readFile(LOCAL_MENU_PATH, { encoding: "utf8" });
    try {
      JSON.parse(content);
      return { ok: true, path: LOCAL_MENU_PATH, size_bytes: stat.size };
    } catch (parseErr) {
      return { ok: false, reason: "invalid_json", details: parseErr.message };
    }
  } catch (err) {
    return { ok: false, reason: "missing", details: err.code || err.message };
  }
}

async function checkDatabaseDns() {
  const dbUrl = process.env.DATABASE_URL || process.env.DB_URL || null;
  if (!dbUrl) return { ok: null, reason: "no_database_env" };

  try {
    // Parse host from URL safely
    const url = new URL(dbUrl);
    const host = url.hostname;
    const port = url.port || null;
    const records = await dns.lookup(host);
    return { ok: true, host, port, address: records.address, family: records.family };
  } catch (err) {
    return { ok: false, reason: "dns_lookup_failed", details: err.message || String(err) };
  }
}

async function readPackageInfo() {
  try {
    const content = await fs.readFile(PACKAGE_JSON_PATH, "utf8");
    const pkg = JSON.parse(content);
    return { ok: true, name: pkg.name || null, version: pkg.version || null };
  } catch {
    return { ok: false };
  }
}

function runtimeMetrics() {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const load = os.loadavg(); // [1,5,15] minute averages
  return {
    uptime_seconds: Math.floor(uptime),
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external
    },
    os: {
      cpus: os.cpus().length,
      loadavg_1m: load[0],
      loadavg_5m: load[1],
      loadavg_15m: load[2],
      free_mem: os.freemem(),
      total_mem: os.totalmem()
    }
  };
}

export default async function handler(req, res) {
  // Only allow GET for health checks
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method Not Allowed. Use GET." });
  }

  const start = Date.now();

  // Basic info
  const pkg = await readPackageInfo();
  const runtime = runtimeMetrics();

  // Environment checks
  const env = {
    WHATSAPP_BUSINESS_ID: !!process.env.WHATSAPP_BUSINESS_ID,
    WHATSAPP_TOKEN: !!process.env.WHATSAPP_TOKEN,
    DATABASE_URL: !!(process.env.DATABASE_URL || process.env.DB_URL),
    NODE_ENV: process.env.NODE_ENV || "undefined",
    VERCEL: !!process.env.VERCEL
  };

  // Perform async probes in parallel but with safe timeouts
  const probes = await Promise.allSettled([
    checkWhatsApp(),
    checkLocalMenu(),
    checkDatabaseDns()
  ]);

  const whatsappProbe = probes[0].status === "fulfilled" ? probes[0].value : { ok: false, reason: "probe_failed", details: probes[0].reason?.message || String(probes[0].reason) };
  const localMenuProbe = probes[1].status === "fulfilled" ? probes[1].value : { ok: false, reason: "probe_failed", details: probes[1].reason?.message || String(probes[1].reason) };
  const dbDnsProbe = probes[2].status === "fulfilled" ? probes[2].value : { ok: false, reason: "probe_failed", details: probes[2].reason?.message || String(probes[2].reason) };

  // Determine overall status
  const criticalFailures = [];
  // Consider WhatsApp optional but warn if env present and probe failed
  if ((process.env.WHATSAPP_BUSINESS_ID || process.env.WHATSAPP_TOKEN) && !whatsappProbe.ok) {
    criticalFailures.push({ component: "whatsapp", detail: whatsappProbe });
  }
  // Local menu is critical
  if (!localMenuProbe.ok) {
    criticalFailures.push({ component: "local_menu", detail: localMenuProbe });
  }
  // DB DNS failure is not necessarily critical but flagged
  const warnings = [];
  if (dbDnsProbe.ok === false) warnings.push({ component: "database_dns", detail: dbDnsProbe });

  const duration_ms = Date.now() - start;

  const payload = {
    ok: criticalFailures.length === 0,
    service: "delivery-middleware",
    status: criticalFailures.length === 0 ? "running" : "degraded",
    timestamp: new Date().toISOString(),
    duration_ms,
    package: pkg.ok ? { name: pkg.name, version: pkg.version } : null,
    runtime,
    env,
    probes: {
      whatsapp: whatsappProbe,
      local_menu: localMenuProbe,
      database_dns: dbDnsProbe
    },
    criticalFailures,
    warnings,
    notes: [
      "Health endpoint performs lightweight checks only. For deeper diagnostics, consult logs and monitoring dashboards.",
      "If WhatsApp env vars are set and WhatsApp probe fails, check token validity and Graph API permissions.",
      "Local menu (menu.json) must be present and valid JSON for fallback catalog operations."
    ]
  };

  // Choose HTTP status: 200 if ok, 200 if degraded but still reachable (so monitoring can inspect payload)
  const httpStatus = payload.ok ? 200 : 200;

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  return res.status(httpStatus).json(payload);
}