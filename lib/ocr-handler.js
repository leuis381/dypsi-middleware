import { readImage } from "./ocr.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const { imageUrl } = req.body || {};

    if (!imageUrl) {
      return res.status(400).json({
        ok: false,
        error: "imageUrl es requerido"
      });
    }

    const result = await readImage(imageUrl);

    return res.status(200).json({
      ok: true,
      result
    });
  } catch (error) {
    console.error("OCR error:", error);

    return res.status(500).json({
      ok: false,
      error: "OCR failed",
      details: error.message
    });
  }
}
