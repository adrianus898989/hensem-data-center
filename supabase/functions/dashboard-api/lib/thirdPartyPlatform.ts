/** Display/filter aliases only. Never deduplicate, delete or rewrite source rows. */
export function canonicalThirdPartyPlatform(country: string, value: string): string {
  const platform = String(value || "").trim();
  // The source sometimes appends `(AR)` to the same platform name. It is a
  // backend/display suffix, not a separate platform, so normalize it before
  // building options, filters, aggregates, and work-order keys.
  const displayPlatform = platform
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/\s*\(AR\)\s*$/i, "")
    .trim() || platform;
  // Preserve the existing Shree.Win / Shreewin display compatibility exactly.
  const legacyShreeKey = displayPlatform.toLowerCase().replace(/[^a-z0-9一-龥]+/g, "");
  if (legacyShreeKey === "shreewin") return "ShreeWin";

  const countryKey = String(country || "").trim().toUpperCase();
  if (["PK", "PAKISTAN", "巴基斯坦", "巴基斯坦盘口"].includes(countryKey)) {
    const known = displayPlatform.toUpperCase();
    if (["3PATISUPER", "3PATTI-SUPER"].includes(known)) return "3PATTI-SUPER";
    if (["92GAME", "92.GAME"].includes(known)) return "92GAME";
  }
  if (["IN", "INDIA", "印度", "印度线下", "印度盘口", "印度线下盘口"].includes(countryKey)) {
    // Owner-confirmed names for the same platform, across legacy/AR/NEWAR.
    // Keep this allowlist scoped to India; never strip arbitrary suffixes.
    const known = displayPlatform.toUpperCase();
    // Fee-matrix headings use BIG(AR) / INDIA82(AR); uploaded AR orders
    // use BIGMUMBAI / 82LOTTERY. Owner confirmed both identities.
    if (["BIG", "BIGMUMBAI"].includes(known)) return "BIGMUMBAI";
    if (["INDIA82", "82LOTTERY"].includes(known)) return "82LOTTERY";
    if (["VEER.GAME", "VEERGAME"].includes(known)) return "VEER.GAME";
    if (["DHANIWIN", "DHANI.WIN", "DHANIWIN(新AR)"].includes(known)) return "DhaniWin";
    // Owner-confirmed display identity. Keep the physical AR source key as
    // RAJA; only the platform label and cross-page selection use RAJAGAMES.
    if (["RAJA", "RAJAGAME", "RAJAGAMES"].includes(known)) return "RAJAGAMES";
  }
  if (countryKey === "BR" || countryKey === "巴西") {
    // Only verified aliases; do not apply generic punctuation or suffix removal.
    const known = displayPlatform.toUpperCase();
    if (known === "43R") return "43R";
    if (known === "PLAYERBR" || known === "PLAYER BR") return "PLAYER BR";
    // Confirmed by the owner: the fee-table POPKKK新 is the same WG POPKKK.
    if (known === "POPKKK" || known === "POPKKK新") return "POPKKK";
  }
  return displayPlatform;
}

/** Owner-confirmed first business date, not the day the first daily job runs. */
export function thirdPartyPlatformNotOpen(country:string,platform:string,endDate:string):boolean {
  return ["PK","PAKISTAN","巴基斯坦","巴基斯坦盘口"].includes(country.trim().toUpperCase())
    && platform.trim().toUpperCase()==="92BLAZE" && endDate.slice(0,10)<"2026-09-22";
}

/** Stable first-occurrence order, suitable for draft/applied multi-select state. */
export function canonicalThirdPartyPlatformSelections(country: string, selections: readonly string[]): string[] {
  return Array.from(new Set(selections.map(value => canonicalThirdPartyPlatform(country, value)).filter(Boolean)));
}

/** Use each row's country, including when several countries share a page. */
export function matchesThirdPartyPlatformSelection(country: string, platform: string, selections: readonly string[]): boolean {
  return selections.length === 0 || canonicalThirdPartyPlatformSelections(country, selections).includes(canonicalThirdPartyPlatform(country, platform));
}
