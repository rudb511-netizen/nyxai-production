/** ISO markets NYX bills in. Prices are approved server-side — never live-converted on the client. */

export type BillingMarket = {
  iso: string;
  name: string;
  currency: string;
  locale: string;
};

/** UN members + Holy See + State of Palestine (195). */
export const BILLING_MARKETS: BillingMarket[] = [
  ["AF", "Afghanistan", "AFN", "fa-AF"],
  ["AL", "Albania", "ALL", "sq-AL"],
  ["DZ", "Algeria", "DZD", "ar-DZ"],
  ["AD", "Andorra", "EUR", "ca-AD"],
  ["AO", "Angola", "AOA", "pt-AO"],
  ["AG", "Antigua and Barbuda", "XCD", "en-AG"],
  ["AR", "Argentina", "ARS", "es-AR"],
  ["AM", "Armenia", "AMD", "hy-AM"],
  ["AU", "Australia", "AUD", "en-AU"],
  ["AT", "Austria", "EUR", "de-AT"],
  ["AZ", "Azerbaijan", "AZN", "az-AZ"],
  ["BS", "Bahamas", "BSD", "en-BS"],
  ["BH", "Bahrain", "BHD", "ar-BH"],
  ["BD", "Bangladesh", "BDT", "bn-BD"],
  ["BB", "Barbados", "BBD", "en-BB"],
  ["BY", "Belarus", "BYN", "be-BY"],
  ["BE", "Belgium", "EUR", "nl-BE"],
  ["BZ", "Belize", "BZD", "en-BZ"],
  ["BJ", "Benin", "XOF", "fr-BJ"],
  ["BT", "Bhutan", "BTN", "dz-BT"],
  ["BO", "Bolivia", "BOB", "es-BO"],
  ["BA", "Bosnia and Herzegovina", "BAM", "bs-BA"],
  ["BW", "Botswana", "BWP", "en-BW"],
  ["BR", "Brazil", "BRL", "pt-BR"],
  ["BN", "Brunei", "BND", "ms-BN"],
  ["BG", "Bulgaria", "BGN", "bg-BG"],
  ["BF", "Burkina Faso", "XOF", "fr-BF"],
  ["BI", "Burundi", "BIF", "fr-BI"],
  ["CV", "Cabo Verde", "CVE", "pt-CV"],
  ["KH", "Cambodia", "KHR", "km-KH"],
  ["CM", "Cameroon", "XAF", "fr-CM"],
  ["CA", "Canada", "CAD", "en-CA"],
  ["CF", "Central African Republic", "XAF", "fr-CF"],
  ["TD", "Chad", "XAF", "fr-TD"],
  ["CL", "Chile", "CLP", "es-CL"],
  ["CN", "China", "CNY", "zh-CN"],
  ["CO", "Colombia", "COP", "es-CO"],
  ["KM", "Comoros", "KMF", "ar-KM"],
  ["CR", "Costa Rica", "CRC", "es-CR"],
  ["CI", "Côte d’Ivoire", "XOF", "fr-CI"],
  ["HR", "Croatia", "EUR", "hr-HR"],
  ["CU", "Cuba", "CUP", "es-CU"],
  ["CY", "Cyprus", "EUR", "el-CY"],
  ["CZ", "Czechia", "CZK", "cs-CZ"],
  ["CD", "Democratic Republic of the Congo", "CDF", "fr-CD"],
  ["DK", "Denmark", "DKK", "da-DK"],
  ["DJ", "Djibouti", "DJF", "fr-DJ"],
  ["DM", "Dominica", "XCD", "en-DM"],
  ["DO", "Dominican Republic", "DOP", "es-DO"],
  ["EC", "Ecuador", "USD", "es-EC"],
  ["EG", "Egypt", "EGP", "ar-EG"],
  ["SV", "El Salvador", "USD", "es-SV"],
  ["GQ", "Equatorial Guinea", "XAF", "es-GQ"],
  ["ER", "Eritrea", "ERN", "ti-ER"],
  ["EE", "Estonia", "EUR", "et-EE"],
  ["SZ", "Eswatini", "SZL", "en-SZ"],
  ["ET", "Ethiopia", "ETB", "am-ET"],
  ["FJ", "Fiji", "FJD", "en-FJ"],
  ["FI", "Finland", "EUR", "fi-FI"],
  ["FR", "France", "EUR", "fr-FR"],
  ["GA", "Gabon", "XAF", "fr-GA"],
  ["GM", "Gambia", "GMD", "en-GM"],
  ["GE", "Georgia", "GEL", "ka-GE"],
  ["DE", "Germany", "EUR", "de-DE"],
  ["GH", "Ghana", "GHS", "en-GH"],
  ["GR", "Greece", "EUR", "el-GR"],
  ["GD", "Grenada", "XCD", "en-GD"],
  ["GT", "Guatemala", "GTQ", "es-GT"],
  ["GN", "Guinea", "GNF", "fr-GN"],
  ["GW", "Guinea-Bissau", "XOF", "pt-GW"],
  ["GY", "Guyana", "GYD", "en-GY"],
  ["HT", "Haiti", "HTG", "fr-HT"],
  ["HN", "Honduras", "HNL", "es-HN"],
  ["HU", "Hungary", "HUF", "hu-HU"],
  ["IS", "Iceland", "ISK", "is-IS"],
  ["IN", "India", "INR", "hi-IN"],
  ["ID", "Indonesia", "IDR", "id-ID"],
  ["IR", "Iran", "IRR", "fa-IR"],
  ["IQ", "Iraq", "IQD", "ar-IQ"],
  ["IE", "Ireland", "EUR", "en-IE"],
  ["IL", "Israel", "ILS", "he-IL"],
  ["IT", "Italy", "EUR", "it-IT"],
  ["JM", "Jamaica", "JMD", "en-JM"],
  ["JP", "Japan", "JPY", "ja-JP"],
  ["JO", "Jordan", "JOD", "ar-JO"],
  ["KZ", "Kazakhstan", "KZT", "kk-KZ"],
  ["KE", "Kenya", "KES", "en-KE"],
  ["KI", "Kiribati", "AUD", "en-KI"],
  ["KW", "Kuwait", "KWD", "ar-KW"],
  ["KG", "Kyrgyzstan", "KGS", "ky-KG"],
  ["LA", "Laos", "LAK", "lo-LA"],
  ["LV", "Latvia", "EUR", "lv-LV"],
  ["LB", "Lebanon", "LBP", "ar-LB"],
  ["LS", "Lesotho", "LSL", "en-LS"],
  ["LR", "Liberia", "LRD", "en-LR"],
  ["LY", "Libya", "LYD", "ar-LY"],
  ["LI", "Liechtenstein", "CHF", "de-LI"],
  ["LT", "Lithuania", "EUR", "lt-LT"],
  ["LU", "Luxembourg", "EUR", "fr-LU"],
  ["MG", "Madagascar", "MGA", "fr-MG"],
  ["MW", "Malawi", "MWK", "en-MW"],
  ["MY", "Malaysia", "MYR", "ms-MY"],
  ["MV", "Maldives", "MVR", "dv-MV"],
  ["ML", "Mali", "XOF", "fr-ML"],
  ["MT", "Malta", "EUR", "mt-MT"],
  ["MH", "Marshall Islands", "USD", "en-MH"],
  ["MR", "Mauritania", "MRU", "ar-MR"],
  ["MU", "Mauritius", "MUR", "en-MU"],
  ["MX", "Mexico", "MXN", "es-MX"],
  ["FM", "Micronesia", "USD", "en-FM"],
  ["MD", "Moldova", "MDL", "ro-MD"],
  ["MC", "Monaco", "EUR", "fr-MC"],
  ["MN", "Mongolia", "MNT", "mn-MN"],
  ["ME", "Montenegro", "EUR", "sr-ME"],
  ["MA", "Morocco", "MAD", "ar-MA"],
  ["MZ", "Mozambique", "MZN", "pt-MZ"],
  ["MM", "Myanmar", "MMK", "my-MM"],
  ["NA", "Namibia", "NAD", "en-NA"],
  ["NR", "Nauru", "AUD", "en-NR"],
  ["NP", "Nepal", "NPR", "ne-NP"],
  ["NL", "Netherlands", "EUR", "nl-NL"],
  ["NZ", "New Zealand", "NZD", "en-NZ"],
  ["NI", "Nicaragua", "NIO", "es-NI"],
  ["NE", "Niger", "XOF", "fr-NE"],
  ["NG", "Nigeria", "NGN", "en-NG"],
  ["KP", "North Korea", "KPW", "ko-KP"],
  ["MK", "North Macedonia", "MKD", "mk-MK"],
  ["NO", "Norway", "NOK", "nb-NO"],
  ["OM", "Oman", "OMR", "ar-OM"],
  ["PK", "Pakistan", "PKR", "ur-PK"],
  ["PW", "Palau", "USD", "en-PW"],
  ["PA", "Panama", "PAB", "es-PA"],
  ["PG", "Papua New Guinea", "PGK", "en-PG"],
  ["PY", "Paraguay", "PYG", "es-PY"],
  ["PE", "Peru", "PEN", "es-PE"],
  ["PH", "Philippines", "PHP", "en-PH"],
  ["PL", "Poland", "PLN", "pl-PL"],
  ["PT", "Portugal", "EUR", "pt-PT"],
  ["QA", "Qatar", "QAR", "ar-QA"],
  ["CG", "Republic of the Congo", "XAF", "fr-CG"],
  ["RO", "Romania", "RON", "ro-RO"],
  ["RU", "Russia", "RUB", "ru-RU"],
  ["RW", "Rwanda", "RWF", "rw-RW"],
  ["KN", "Saint Kitts and Nevis", "XCD", "en-KN"],
  ["LC", "Saint Lucia", "XCD", "en-LC"],
  ["VC", "Saint Vincent and the Grenadines", "XCD", "en-VC"],
  ["WS", "Samoa", "WST", "en-WS"],
  ["SM", "San Marino", "EUR", "it-SM"],
  ["ST", "São Tomé and Príncipe", "STN", "pt-ST"],
  ["SA", "Saudi Arabia", "SAR", "ar-SA"],
  ["SN", "Senegal", "XOF", "fr-SN"],
  ["RS", "Serbia", "RSD", "sr-RS"],
  ["SC", "Seychelles", "SCR", "en-SC"],
  ["SL", "Sierra Leone", "SLE", "en-SL"],
  ["SG", "Singapore", "SGD", "en-SG"],
  ["SK", "Slovakia", "EUR", "sk-SK"],
  ["SI", "Slovenia", "EUR", "sl-SI"],
  ["SB", "Solomon Islands", "SBD", "en-SB"],
  ["SO", "Somalia", "SOS", "so-SO"],
  ["ZA", "South Africa", "ZAR", "en-ZA"],
  ["KR", "South Korea", "KRW", "ko-KR"],
  ["SS", "South Sudan", "SSP", "en-SS"],
  ["ES", "Spain", "EUR", "es-ES"],
  ["LK", "Sri Lanka", "LKR", "si-LK"],
  ["SD", "Sudan", "SDG", "ar-SD"],
  ["SR", "Suriname", "SRD", "nl-SR"],
  ["SE", "Sweden", "SEK", "sv-SE"],
  ["CH", "Switzerland", "CHF", "de-CH"],
  ["SY", "Syria", "SYP", "ar-SY"],
  ["TJ", "Tajikistan", "TJS", "tg-TJ"],
  ["TZ", "Tanzania", "TZS", "sw-TZ"],
  ["TH", "Thailand", "THB", "th-TH"],
  ["TL", "Timor-Leste", "USD", "pt-TL"],
  ["TG", "Togo", "XOF", "fr-TG"],
  ["TO", "Tonga", "TOP", "en-TO"],
  ["TT", "Trinidad and Tobago", "TTD", "en-TT"],
  ["TN", "Tunisia", "TND", "ar-TN"],
  ["TR", "Türkiye", "TRY", "tr-TR"],
  ["TM", "Turkmenistan", "TMT", "tk-TM"],
  ["TV", "Tuvalu", "AUD", "en-TV"],
  ["UG", "Uganda", "UGX", "en-UG"],
  ["UA", "Ukraine", "UAH", "uk-UA"],
  ["AE", "United Arab Emirates", "AED", "ar-AE"],
  ["GB", "United Kingdom", "GBP", "en-GB"],
  ["US", "United States", "USD", "en-US"],
  ["UY", "Uruguay", "UYU", "es-UY"],
  ["UZ", "Uzbekistan", "UZS", "uz-UZ"],
  ["VU", "Vanuatu", "VUV", "en-VU"],
  ["VE", "Venezuela", "VES", "es-VE"],
  ["VN", "Vietnam", "VND", "vi-VN"],
  ["YE", "Yemen", "YER", "ar-YE"],
  ["ZM", "Zambia", "ZMW", "en-ZM"],
  ["ZW", "Zimbabwe", "USD", "en-ZW"],
  ["VA", "Holy See (Vatican City)", "EUR", "it-VA"],
  ["PS", "State of Palestine", "ILS", "ar-PS"],
].map(([iso, name, currency, locale]) => ({ iso, name, currency, locale }));

export const MARKET_BY_ISO = new Map(BILLING_MARKETS.map((m) => [m.iso, m]));

export const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export function isMarketIso(iso: string | null | undefined): iso is string {
  return Boolean(iso && MARKET_BY_ISO.has(iso.toUpperCase()));
}

export function marketForIso(iso: string | null | undefined): BillingMarket | null {
  if (!iso) return null;
  return MARKET_BY_ISO.get(iso.toUpperCase()) ?? null;
}

export function currencyExponent(currency: string): number {
  if (ZERO_DECIMAL.has(currency)) return 0;
  if (currency === "BHD" || currency === "JOD" || currency === "KWD" || currency === "OMR") return 3;
  return 2;
}

/** Psychological list rounding. Catalog NGN amounts stay exact. */
export function roundListMajor(major: number, currency: string): number {
  if (!Number.isFinite(major) || major <= 0) return 0;
  const exp = currencyExponent(currency);
  if (exp === 0) {
    if (major < 20) return Math.max(1, Math.round(major));
    return Math.max(1, Math.round(major / 10) * 10 - 1);
  }
  if (exp === 3) {
    const units = Math.round(major * 1000);
    return Math.max(1, units) / 1000;
  }
  if (major < 1) return Math.round(major * 100) / 100;
  if (major < 10) return Math.round(major * 20) / 20;
  const cents = Math.round(major * 100);
  const bump = Math.ceil(cents / 100) * 100 - 1;
  return bump / 100;
}

export function majorToMinor(major: number, currency: string): number {
  const exp = currencyExponent(currency);
  return Math.round(major * 10 ** exp);
}

export function minorToMajor(minor: number, currency: string): number {
  return minor / 10 ** currencyExponent(currency);
}
