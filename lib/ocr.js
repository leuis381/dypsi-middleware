import axios from "axios";
import FormData from "form-data";

/**
 * ocr.js
 * Robust OCR helper for Vercel middleware (DYPSI).
 *
 * Features:
 * - Supports OCR.Space (via OCR_API_KEY) and Google Vision REST API (via GOOGLE_API_KEY).
 * - Accepts image URL or image Buffer (file upload).
 * - Retries with exponential backoff on transient errors.
 * - Parses OCR text to extract monetary amounts, operation/account numbers and likely Yape/Plin references.
 * - Returns structured result: { text, amounts, operationNumbers, accountNumbers, provider, confidence, raw }
 *
 * Environment variables:
 * - OCR_API_KEY         -> API key for ocr.space (optional)
 * - GOOGLE_API_KEY      -> API key for Google Vision REST (optional)
 *
 * Usage:
 * - readImage(url)                // OCR from remote URL
 * - readImageBuffer(buffer, name) // OCR from Buffer (file upload)
 *
 * Notes:
 * - At least one provider should be configured for best results; if none, function will attempt OCR.Space if key present.
 * - Keep responses small and fast; timeouts are short by default.
 */

/* ---------- Configuration ---------- */
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 250; // exponential backoff base
const OCR_SPACE_ENDPOINT = "https://api.ocr.space/parse/image";
const GOOGLE_VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

/* ---------- Helpers ---------- */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidUrl(s) {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

function safeNumberParse(s) {
  const n = Number(String(s).replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/* Extract monetary amounts like "s/ 24.00", "S/24", "24.00", "24" with context */
function extractAmountsFromText(text) {
  if (!text) return [];
  const results = new Set();
  // Common patterns: S/ 24.00, s/24, PEN 24.00, 24.00
  const patterns = [
    /(?:S\/|s\/|S\.\/|s\.\/|PEN|\bsoles\b|\bs\/\b)\s*([0-9]{1,3}(?:[.,][0-9]{2})?)/g,
    /([0-9]{1,3}(?:[.,][0-9]{2}))\s*(?:soles|S\/|s\/|PEN)?/gi,
    /([0-9]{1,6})\s*(?:soles|S\/|s\/|PEN)?/gi
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      const raw = m[1];
      const parsed = safeNumberParse(raw);
      if (parsed !== null) results.add(parsed);
    }
  }
  // Return sorted unique amounts descending (likely total is largest)
  return Array.from(results).sort((a, b) => b - a);
}

/* Extract sequences that look like operation numbers or account numbers (6-20 digits) */
function extractNumbersFromText(text) {
  if (!text) return { operations: [], accounts: [] };
  const operations = new Set();
  const accounts = new Set();
  // Look for sequences of digits (6 to 20)
  const regex = /([0-9]{6,20})/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const num = m[1];
    // Heuristics: Yape/Plin often show 9-digit phone-like numbers or operation IDs 6-12 digits
    if (num.length >= 9 && num.length <= 11) accounts.add(num);
    else if (num.length >= 6 && num.length <= 20) operations.add(num);
  }
  return {
    operations: Array.from(operations),
    accounts: Array.from(accounts)
  };
}

/* Normalize provider response text and compute a simple confidence estimate */
function buildResultObject({ provider, rawText, rawResponse, confidence = null }) {
  const text = (rawText || "").trim();
  const amounts = extractAmountsFromText(text);
  const { operations, accounts } = extractNumbersFromText(text);

  return {
    provider,
    text,
    amounts, // array of numbers (descending)
    operationNumbers: operations,
    accountNumbers: accounts,
    confidence, // provider-specific if available (0-1) or null
    raw: rawResponse || null
  };
}

/* ---------- OCR Provider Implementations ---------- */

/**
 * OCR.Space (supports URL or multipart file)
 * - Requires OCR_API_KEY in env
 */
async function ocrSpaceRequest({ imageUrl = null, buffer = null, filename = "upload.jpg", language = "spa" }) {
  if (!process.env.OCR_API_KEY) {
    throw new Error("OCR_SPACE_API_KEY_NOT_CONFIGURED");
  }

  const form = new FormData();
  form.append("apikey", process.env.OCR_API_KEY);
  form.append("language", language);
  form.append("isOverlayRequired", "false");
  form.append("OCREngine", "2"); // newer engine if available

  if (imageUrl) {
    form.append("url", imageUrl);
  } else if (buffer) {
    form.append("file", buffer, { filename });
  } else {
    throw new Error("No image provided to ocrSpaceRequest");
  }

  const headers = { ...form.getHeaders() };

  const axiosInstance = axios.create({ timeout: DEFAULT_TIMEOUT_MS });

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const r = await axiosInstance.post(OCR_SPACE_ENDPOINT, form, { headers });
      const data = r.data;
      // OCR.Space returns ParsedResults array
      const parsedText = data?.ParsedResults?.[0]?.ParsedText || "";
      // OCR.Space returns OCRExitCode and ErrorMessage
      const exitCode = data?.OCRExitCode;
      const success = exitCode === 1 || exitCode === 2 || exitCode === 3; // 1=Success, 2=Partial, 3=Success with warnings
      if (!success) {
        const errMsg = data?.ErrorMessage || JSON.stringify(data);
        throw new Error(`OCR.Space error: ${errMsg}`);
      }
      // Confidence not always provided; try to compute average if available
      const confidence = null;
      return { text: parsedText, raw: data, confidence, provider: "ocr.space" };
    } catch (err) {
      attempt++;
      if (attempt >= MAX_RETRIES) throw err;
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
}

/**
 * Google Vision REST API (supports imageUri or base64 content)
 * - Requires GOOGLE_API_KEY in env
 */
async function googleVisionRequest({ imageUrl = null, buffer = null, filename = "upload.jpg", languageHints = ["es"] }) {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY_NOT_CONFIGURED");
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `${GOOGLE_VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;

  const requestBody = {
    requests: [
      {
        image: {},
        features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
        imageContext: {}
      }
    ]
  };

  if (imageUrl) {
    requestBody.requests[0].image.source = { imageUri: imageUrl };
  } else if (buffer) {
    const base64 = buffer.toString("base64");
    requestBody.requests[0].image.content = base64;
  } else {
    throw new Error("No image provided to googleVisionRequest");
  }

  if (languageHints && languageHints.length) {
    requestBody.requests[0].imageContext.languageHints = languageHints;
  }

  const axiosInstance = axios.create({ timeout: DEFAULT_TIMEOUT_MS });

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const r = await axiosInstance.post(url, requestBody, {
        headers: { "Content-Type": "application/json" }
      });
      const data = r.data;
      const annotation = data?.responses?.[0]?.fullTextAnnotation || data?.responses?.[0]?.textAnnotations?.[0];
      const text = annotation?.text || data?.responses?.[0]?.textAnnotations?.[0]?.description || "";
      // Google provides confidence per block sometimes; we can approximate
      const confidence = data?.responses?.[0]?.textAnnotations?.[0]?.score ?? null;
      return { text, raw: data, confidence, provider: "google_vision" };
    } catch (err) {
      attempt++;
      if (attempt >= MAX_RETRIES) throw err;
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
}

/* ---------- Public API ---------- */

/**
 * readImage(imageUrl)
 * - Attempts OCR using configured providers in order: Google Vision (if key), OCR.Space (if key).
 * - Returns structured result via buildResultObject.
 */
export async function readImage(imageUrl, options = {}) {
  if (!imageUrl || typeof imageUrl !== "string" || !isValidUrl(imageUrl)) {
    throw new Error("Invalid imageUrl provided to readImage");
  }

  const providersTried = [];
  // Prefer Google Vision if configured
  if (process.env.GOOGLE_API_KEY) {
    try {
      providersTried.push("google_vision");
      const res = await googleVisionRequest({ imageUrl, languageHints: options.languageHints || ["es"] });
      return buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence });
    } catch (err) {
      // continue to next provider
      console.warn("Google Vision OCR failed:", err.message || err);
    }
  }

  if (process.env.OCR_API_KEY) {
    try {
      providersTried.push("ocr.space");
      const res = await ocrSpaceRequest({ imageUrl, language: options.language || "spa" });
      return buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence });
    } catch (err) {
      console.warn("OCR.Space failed:", err.message || err);
    }
  }

  // If no provider configured or all failed, attempt a last-ditch fetch + Google Vision if possible
  throw new Error(`No OCR provider succeeded. Providers tried: ${providersTried.join(", ") || "none configured"}`);
}

/**
 * readImageBuffer(buffer, filename)
 * - Accepts a Buffer (uploaded file) and runs OCR similarly to readImage.
 */
export async function readImageBuffer(buffer, filename = "upload.jpg", options = {}) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("Invalid buffer provided to readImageBuffer");
  }

  const providersTried = [];

  if (process.env.GOOGLE_API_KEY) {
    try {
      providersTried.push("google_vision");
      const res = await googleVisionRequest({ buffer, filename, languageHints: options.languageHints || ["es"] });
      return buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence });
    } catch (err) {
      console.warn("Google Vision OCR (buffer) failed:", err.message || err);
    }
  }

  if (process.env.OCR_API_KEY) {
    try {
      providersTried.push("ocr.space");
      const res = await ocrSpaceRequest({ buffer, filename, language: options.language || "spa" });
      return buildResultObject({ provider: res.provider, rawText: res.text, rawResponse: res.raw, confidence: res.confidence });
    } catch (err) {
      console.warn("OCR.Space (buffer) failed:", err.message || err);
    }
  }

  throw new Error(`No OCR provider succeeded for buffer. Providers tried: ${providersTried.join(", ") || "none configured"}`);
}

/**
 * Utility: extractMostLikelyTotal(result)
 * - Given the structured OCR result, returns the most likely total amount (heuristic: largest amount).
 */
export function extractMostLikelyTotal(ocrResult) {
  if (!ocrResult || !Array.isArray(ocrResult.amounts) || ocrResult.amounts.length === 0) return null;
  // Heuristic: the largest detected amount is likely the total
  return ocrResult.amounts[0];
}

/**
 * Utility: detectYapeAccountInText(text, knownAccounts = [])
 * - Returns any account numbers found and whether they match known accounts (e.g., company Yape).
 */
export function detectYapeAccountInText(text, knownAccounts = []) {
  const { accountNumbers } = (() => {
    const { operations, accounts } = extractNumbersFromText(text || "");
    return { operations, accountNumbers: accounts };
  })();

  const matches = accountNumbers || [];
  const matchedKnown = matches.filter((n) => knownAccounts.includes(n));
  return { matches, matchedKnown };
}

/* ---------- Default export (convenience) ---------- */
export default {
  readImage,
  readImageBuffer,
  extractMostLikelyTotal,
  detectYapeAccountInText
};
