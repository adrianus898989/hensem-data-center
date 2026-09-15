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

/** Stable first-occurrence order, suitable for draft/applied multi-select state. */
export function canonicalThirdPartyPlatformSelections(country: string, selections: readonly string[]): string[] {
  return Array.from(new Set(selections.map(value => canonicalThirdPartyPlatform(country, value)).filter(Boolean)));
}

/** Use each row's country, including when several countries share a page. */
export function matchesThirdPartyPlatformSelection(country: string, platform: string, selections: readonly string[]): boolean {
  return selections.length === 0 || canonicalThirdPartyPlatformSelections(country, selections).includes(canonicalThirdPartyPlatform(country, platform));
}
