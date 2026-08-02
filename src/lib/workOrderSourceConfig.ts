// V226_WORK_ORDER_SOURCE_CONFIG
// 工单来源规则：优先读取 Netlify 里正在使用的 WORK_ORDER_SHEET_ID(S)，
// 只有环境变量完全没有配置时，才回退到代码里的备用表。
// 页签不再使用旧 WORK_ORDER_SHEETS 白名单，而是自动识别全部 raw_workorder_* 页签。

export const WORK_ORDER_SOURCE_CONFIG = {
  // false = Netlify 环境变量优先；代码 sheetIds 仅作备用。
  useConfigFile: false,

  // 备用来源。Netlify 没有 WORK_ORDER_SHEET_ID / WORK_ORDER_SHEET_IDS 时才使用。
  sheetIds: [
    "1a8X0uVpo38LimYAmlxpAYiH9Q3ltkJ_yiaFt0q61zIw",
    "1g_xeFYAE6EiOwC8CX23uoHroefXQfLXfLMPwmI0Vtrg"
  ],

  // 留空 = 自动识别 raw_workorder_*。
  sheetNames: [] as string[],

  // 一次覆盖 daily / type / employee 以及后续新增的 RAW 工单页签。
  sheetNamePrefixes: ["raw_workorder_"],

  // 留空时按 Google Sheet 实际网格范围读取。
  range: ""
};
