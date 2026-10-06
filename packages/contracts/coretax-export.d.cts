export const CORETAX_CONTRACTS: Record<string,{ root:string; list:string; item:string; hash:string }>;
export function validateTaxExportMapping(contract:string,mapping:unknown): Record<string,unknown>;
export function taxExportChecksum(payload:unknown): string;
export function renderCoretaxExport(payload:unknown): string;
