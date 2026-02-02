/**
 * detect-address.js
 *
 * Detector de direcciones ultrarrobusto para Perú (y genérico).
 * - Normaliza texto, detecta calles (Av., Jr., Calle, Psje), números, referencias y distritos.
 * - Devuelve { isAddress, address, components: { street, number, reference, district, raw } }
 * - Pensado para integrarse con kommo.js y session-store.js
 */

const DISTRICTS = [
  "miraflores","jesus maria","san isidro","surco","san borja","lince","magdalena",
  "barranco","san miguel","rimac","callao","los olivos","san juan de lurigancho",
  "santiago de surco","san martin de porres","ate","independencia","puente piedra"
];

function normalizeText(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s\.,#\-º°]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * isAddress(rawText)
 * - heurísticas múltiples:
 *   - presencia de abreviaturas de vía + número
 *   - presencia de distrito conocido
 *   - presencia de coordenadas lat/lon
 * - intenta extraer street, number, reference y district
 */
export function isAddress(rawText) {
  const raw = (rawText || "").toString();
  const text = normalizeText(raw);
  if (!text) return { isAddress: false };

  // Detect lat/lon pattern
  const coordMatch = raw.match(/(-?\d{1,3}\.\d+)[,;\s]+(-?\d{1,3}\.\d+)/);
  if (coordMatch) {
    return {
      isAddress: true,
      address: `Coordenadas ${coordMatch[1]}, ${coordMatch[2]}`,
      components: { street: null, number: null, reference: null, district: null, lat: Number(coordMatch[1]), lon: Number(coordMatch[2]), raw }
    };
  }

  // Street patterns (Av, Av., Avenida, Jr, Jr., Jirón, Calle, Psje, Pasaje, Mz, Lt, Manzana, Lote)
  const streetRegex = /\b(av|av\.|avenida|jiron|jr|jr\.|jirón|calle|psje|pasaje|psje\.|psje|pje|pje\.|manzana|mz|lote|lt|jr)\b\s*([a-z0-9\s\-º°#]+?)(?:,|\b|#|\d)/i;
  const streetMatch = text.match(streetRegex);

  // Number patterns (n°, nro, #, número, num)
  const numberRegex = /\b(?:nro|n°|numero|num|#)\s*[:\-]?\s*(\d{1,6})\b/i;
  const numberMatch = text.match(numberRegex) || text.match(/\b(\d{1,6})\b/);

  // District detection
  const districtFound = DISTRICTS.find(d => text.includes(d));

  // Reference extraction (entre 'cerca', 'frente a', 'altura', 'esq', 'esquina', 'detrás de')
  const refRegex = /\b(cerca de|frente a|altura de|altura|esq|esquina de|detras de|detrás de|junto a|al lado de)\s+([a-z0-9\s\-\.,#]+)/i;
  const refMatch = raw.match(refRegex);

  const likely = !!(streetMatch || districtFound || numberMatch);

  if (!likely) return { isAddress: false };

  const street = streetMatch ? streetMatch[0].trim() : null;
  const number = numberMatch ? (numberMatch[1] || numberMatch[0]) : null;
  const reference = refMatch ? refMatch[0].trim() : null;
  const district = districtFound || null;

  const addressParts = [];
  if (street) addressParts.push(street);
  if (number) addressParts.push(number);
  if (district) addressParts.push(district);
  if (reference) addressParts.push(reference);

  const address = addressParts.length ? addressParts.join(", ") : text;

  return {
    isAddress: true,
    address,
    components: { street, number, reference, district, raw }
  };
}

export default isAddress;
