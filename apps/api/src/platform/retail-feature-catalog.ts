// Read-only capability truth shared by bootstrap and runtime manifest.
// These descriptions never enable a flag or certify an external provider.
export const RETAIL_FEATURE_CATALOG: Record<string, Record<string, string | boolean>> = {
  retail_exchange: {
    configurable: true, maturity: 'implemented-limited-cash-exchange', maturityClass: 'LIMITED',
    operatorVisibility: 'OPERATOR_VISIBLE_LIMITED', ownership: 'TOKO360_RUNTIME',
    helpText: 'Tukar barang online CASH ke CASH melalui retur yang lulus inspeksi dan shift milik operator; default nonaktif.',
  },
  customer_deposit: {
    configurable: true, maturity: 'implemented-limited-liability-deposit', maturityClass: 'LIMITED',
    operatorVisibility: 'OPERATOR_VISIBLE_LIMITED', ownership: 'TOKO360_RUNTIME',
    helpText: 'Deposit online memakai jurnal LIABILITY tersendiri, approval dan posting; bukan uang muka order 2105. Default nonaktif.',
  },
  customer_campaign: {
    configurable: true, maturity: 'adapter-ready-consent-communications', maturityClass: 'ADAPTER_REQUIRED',
    operatorVisibility: 'CONFIGURATION_ONLY', ownership: 'TOKO360_RUNTIME_WITH_EXTERNAL_PROVIDER',
    helpText: 'Antrean dan consent tersedia; pengiriman memerlukan kontak terverifikasi, konfigurasi dan sertifikasi provider. Default nonaktif.',
  },
  pos_ship_later: {
    configurable: true, maturity: 'implemented-limited-staff-cash-order', maturityClass: 'LIMITED',
    operatorVisibility: 'OPERATOR_VISIBLE_LIMITED', ownership: 'TOKO360_RUNTIME',
    helpText: 'Order staf online dengan kas shift, reservasi dan inspeksi/pemenuhan canonical; settlement awal CASH. Default nonaktif.',
  },
  tax_export: {
    configurable: true, maturity: 'implemented-limited-reviewed-xml', maturityClass: 'LIMITED',
    operatorVisibility: 'OPERATOR_VISIBLE_LIMITED', ownership: 'TOKO360_RUNTIME',
    helpText: 'Faktur/BPPU XML dari Tax Core melalui review legal dan worker; bukan penyerahan otomatis atau sertifikasi DJP/PJAP. Default nonaktif.',
  },
};
