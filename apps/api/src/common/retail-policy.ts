// Pure presentation/validation contract. Monetary and inventory posting remain server owned.
export type RetailPolicy = {
  gallery: Array<{ url: string; alt: string }>;
  weight: { barcodeKey: string; baseUnitsPerEncodedUnit: number } | null;
  kitRecipeId: string | null;
};

export function normalizeRetailPolicy(value: unknown): RetailPolicy {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const gallery = input.gallery ?? [];
  if (!Array.isArray(gallery) || gallery.length > 12) throw new Error('Galeri maksimal 12 gambar.');
  const images = gallery.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Gambar galeri tidak valid.');
    const row = entry as Record<string, unknown>;
    const url = String(row.url ?? '').trim();
    const alt = String(row.alt ?? '').trim();
    if (!url || url.length > 1000 || !alt || alt.length > 200) throw new Error('URL dan deskripsi gambar wajib valid.');
    if (url.startsWith('/')) {
      if (!/^\/(?!\/)[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|avif)$/i.test(url) || url.includes('..')) throw new Error('Path gambar lokal tidak valid.');
    } else {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !/\.(?:png|jpe?g|webp|avif)$/i.test(parsed.pathname)) throw new Error('Gambar harus HTTPS tanpa credential/query, dengan format raster.');
    }
    return { url, alt };
  });
  let weight: RetailPolicy['weight'] = null;
  if (input.weight != null) {
    const row = input.weight as Record<string, unknown>;
    const barcodeKey = String(row.barcodeKey ?? '').trim();
    const factor = Number(row.baseUnitsPerEncodedUnit);
    if (!/^2\d{6}$/.test(barcodeKey) || !Number.isSafeInteger(factor) || factor < 1 || factor > 1000) throw new Error('Barcode timbangan membutuhkan key 7 digit (awalan 2) dan faktor base unit integer 1–1000.');
    weight = { barcodeKey, baseUnitsPerEncodedUnit: factor };
  }
  const kitRecipeId = input.kitRecipeId == null || input.kitRecipeId === '' ? null : String(input.kitRecipeId).trim();
  if (kitRecipeId && kitRecipeId.length > 100) throw new Error('Recipe ID tidak valid.');
  if (kitRecipeId && weight) throw new Error('Kit dan barang timbang tidak boleh digabung pada satu produk.');
  return { gallery: images, weight, kitRecipeId };
}

export function readRetailPolicy(metadata: unknown): RetailPolicy {
  const row = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  return normalizeRetailPolicy(row.retail);
}

/** Explicit supported format: 2-digit prefix + 5-digit PLU + 5-digit weight + EAN checksum. */
export function decodeWeightBarcode(code: string): { barcodeKey: string; encodedQuantity: number } | null {
  if (!/^2\d{12}$/.test(code)) return null;
  const sum = [...code.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  if ((10 - sum % 10) % 10 !== Number(code[12])) throw new Error('Checksum barcode timbangan tidak valid.');
  const encodedQuantity = Number(code.slice(7, 12));
  if (encodedQuantity < 1) throw new Error('Berat barcode harus lebih besar dari nol.');
  return { barcodeKey: code.slice(0, 7), encodedQuantity };
}
