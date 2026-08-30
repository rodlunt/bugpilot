// Trigger icons and the sanitiser for host-supplied `icon` markup.
//
// Both defaults draw with currentColor only, so the host accent
// (--bp-on-primary via the trigger's `color`) applies without the host
// having to know anything about the markup.

// Pill default: speech bubble (unchanged from earlier releases).
export const DEFAULT_PILL_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
  '</svg>'

// Tab default: a hand-drawn placeholder ladybird. Deliberately plain so the
// feature works before the owner picks one of the generated candidates in
// test/icon-candidates/.
export const DEFAULT_TAB_ICON =
  // Hand-drawn ladybird, chosen by the owner from widget/test/icon-candidates
  // (candidate 1). Single evenodd path on currentColor so the host accent applies.
  '<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg" viewBox="582 580.7 885.4 885.4" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M 890.659 628.214 C 929.815 626.537 958.718 647.247 985.395 672.964 C 1013.28 667.901 1035.23 666.647 1062.63 674.163 C 1063.82 672.808 1065.03 671.478 1066.28 670.175 C 1085.41 649.898 1105.58 637.906 1132.82 631.132 C 1148.33 627.275 1172.72 623.246 1171.03 647.146 C 1170.03 661.209 1157 661.465 1146.07 663.988 C 1127.25 667.488 1112.33 674.116 1098.39 687.173 C 1156.56 723.518 1189.38 776.38 1183.39 846.515 C 1298.21 918.065 1357.92 1045.71 1324.84 1179.78 C 1302.98 1268.37 1249.26 1334.46 1170.97 1380.17 C 1110.25 1413.83 1033.67 1427.5 965.519 1412.67 C 882.699 1395.26 810.274 1345.46 764.368 1274.37 C 721.169 1206.32 704.979 1122.55 722.32 1043.38 C 740.958 958.28 791.744 892.792 865.094 847.004 C 862.624 774.542 889.366 725.818 950.745 687.654 C 938.239 676.489 925.983 668.095 909.126 665.204 C 898.109 663.314 884.14 663.845 879.073 651.47 C 877.357 647.212 877.454 642.438 879.34 638.253 C 881.792 632.726 885.327 630.376 890.659 628.214 z M 1001.57 836.387 C 1004.25 835.901 1003.27 835.84 1005.93 836.564 C 1008.61 842.399 1007.4 916.702 1007.43 928.079 L 1007.74 1112.64 L 1007.6 1282.06 C 1007.64 1315.68 1008.31 1350.82 1007.48 1384.26 C 935.701 1376.98 889.14 1354.14 835.625 1306.79 C 827.916 1299.7 821.05 1291.88 814.383 1283.93 C 686.495 1131.51 757.643 905.501 945.603 847.662 C 964.464 841.858 982.162 839.011 1001.57 836.387 z M 889.279 1154.18 C 924.439 1149.95 956.423 1174.89 960.888 1210.02 C 965.353 1245.15 940.624 1277.3 905.524 1281.99 C 870.096 1286.73 837.582 1261.72 833.075 1226.27 C 828.569 1190.81 853.792 1158.46 889.279 1154.18 z M 887.271 943.417 C 922.546 940.889 953.215 967.382 955.842 1002.65 C 958.468 1037.92 932.061 1068.66 896.8 1071.39 C 861.4 1074.12 830.508 1047.59 827.872 1012.18 C 825.235 976.772 851.856 945.954 887.271 943.417 z M 1041.84 835.769 C 1068.2 839.06 1090.13 843.065 1115.35 852.235 C 1308 922.268 1361.29 1154.04 1217.9 1302.13 C 1170.34 1348.05 1108.37 1379.62 1041.92 1384.46 L 1041.84 835.769 z M 1150.95 943.29 C 1186.28 939.823 1217.74 965.663 1221.2 1001 C 1224.66 1036.34 1198.81 1067.79 1163.47 1071.24 C 1128.14 1074.69 1096.71 1048.85 1093.25 1013.53 C 1089.79 978.199 1115.62 946.755 1150.95 943.29 z M 1141.38 1154.58 C 1176.47 1148.48 1209.81 1172.13 1215.66 1207.26 C 1221.52 1242.39 1197.64 1275.57 1162.47 1281.18 C 1127.64 1286.74 1094.86 1263.14 1089.06 1228.35 C 1083.26 1193.56 1106.63 1160.62 1141.38 1154.58 z M 1011.36 703.293 C 1087.15 695.02 1144.5 755.602 1150.42 828.469 C 1106.61 811.418 1086.97 806.489 1040.49 802.089 C 983.966 800.766 950.762 807.635 899.346 829.449 C 903.307 762.62 945.072 714.68 1011.36 703.293 z"/></svg>'

// Reject anything that is not a plain <svg> element or that carries an
// executable surface. This is an allow-by-shape check, not a full parser:
// the host is trusted enough to run scripts on its own page already, so the
// aim is to stop an accidental paste of scripted markup, not a hostile host.
const BLOCKED = [
  /<script/i,
  /<foreignobject/i,
  /<iframe/i,
  /\son[a-z]+\s*=/i,      // onload=, onclick=, etc.
  /javascript:/i,
  /<use\b[^>]*\shref\s*=\s*["']?\s*(https?:|\/\/)/i, // remote <use>
]

export function sanitiseIcon(markup) {
  if (typeof markup !== 'string') return null
  const trimmed = markup.trim()
  if (!/^<svg[\s>]/i.test(trimmed)) return null
  if (!/<\/svg>\s*$/i.test(trimmed)) return null
  for (const re of BLOCKED) {
    if (re.test(trimmed)) return null
  }
  return trimmed
}

export function resolveIcon(markup, variant) {
  const fallback = variant === 'tab' ? DEFAULT_TAB_ICON : DEFAULT_PILL_ICON
  if (markup === undefined || markup === null || markup === '') return fallback
  const clean = sanitiseIcon(markup)
  if (!clean) {
    console.warn('[bugpilot] icon rejected: must be inline <svg> markup with no script, on* handlers or javascript: URLs; using the default glyph')
    return fallback
  }
  return clean
}
