import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

type ReceiptClaim = { v: 1; c: string; b: string; s: string; n: string; e: number };
function sign(encoded: string, secret: string) { return createHmac('sha256', secret).update(`toko360:receipt:v1:${encoded}`).digest('base64url'); }
export function mintReceiptShare(sale: { id: string; number: string; branchId: string }, companyId: string, secret: string, now = Date.now()) {
  if (!secret || secret.length < 32) throw new BadRequestException('Kunci struk aman belum dikonfigurasi.');
  const claims: ReceiptClaim = { v: 1, c: companyId, b: sale.branchId, s: sale.id, n: sale.number, e: Math.floor(now / 1000) + 3600 };
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}
export function verifyReceiptShare(token: string | undefined, number: string, secret: string, now = Date.now()): ReceiptClaim | null {
  if (!token || token.length > 1600 || !secret || secret.length < 32) return null;
  try {
    const [encoded, signature, extra] = token.split('.');
    if (extra || !encoded || !signature) return null;
    const actual = Buffer.from(signature, 'base64url'); const expected = Buffer.from(sign(encoded, secret), 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claim = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ReceiptClaim;
    if (claim.v !== 1 || claim.n !== number || ![claim.c, claim.b, claim.s, claim.n].every((value) => typeof value === 'string' && value.length > 0 && value.length <= 160) || !Number.isSafeInteger(claim.e) || claim.e <= Math.floor(now / 1000) || claim.e > Math.floor(now / 1000) + 3600) return null;
    return claim;
  } catch { return null; }
}
