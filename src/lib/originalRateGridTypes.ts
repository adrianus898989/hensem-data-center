// Source-only presentation contract. Never import into fee matching/calculation.
export type OriginalGridColor = { red?: number; green?: number; blue?: number; alpha?: number };
export type OriginalGridTextFormat = {
  fontFamily?: string; fontSize?: number; bold?: boolean; italic?: boolean;
  strikethrough?: boolean; underline?: boolean; foregroundColor?: OriginalGridColor;
};
export type OriginalGridBorder = { style?: string; color?: OriginalGridColor; width?: number };
export type OriginalGridFormat = {
  backgroundColor?: OriginalGridColor; textFormat?: OriginalGridTextFormat;
  horizontalAlignment?: string; verticalAlignment?: string; wrapStrategy?: string;
  padding?: { top?: number; right?: number; bottom?: number; left?: number };
  borders?: { top?: OriginalGridBorder; right?: OriginalGridBorder; bottom?: OriginalGridBorder; left?: OriginalGridBorder };
  textRotation?: { angle?: number; vertical?: boolean };
};
export type OriginalGridCell = { text: string; format?: OriginalGridFormat; runs?: { startIndex: number; format?: OriginalGridTextFormat }[] };
export type OriginalGridMerge = { startRowIndex: number; endRowIndex: number; startColumnIndex: number; endColumnIndex: number };
export type OriginalRateSheetMeta = { sheetId: number; title: string; index: number; rowCount: number; columnCount: number; frozenRowCount: number; frozenColumnCount: number; hidden?: boolean };
export type OriginalRateWorkbookMeta = { title: string; sheets: OriginalRateSheetMeta[]; fetchedAt: string };
export type OriginalRateGrid = {
  sheet: OriginalRateSheetMeta; cells: OriginalGridCell[][]; merges: OriginalGridMerge[];
  rowHeights: number[]; columnWidths: number[]; hiddenRows: number[]; hiddenColumns: number[];
  fetchedAt: string; rowCount: number; columnCount: number;
};
