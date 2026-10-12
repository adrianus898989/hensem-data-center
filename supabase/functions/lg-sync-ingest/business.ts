// Structural companion to private.lg_validate_business_raw, schema version 1.
// SQL performs the canonical privacy check. This gate never transforms an order:
// chunk hashes, source amounts, timestamps and acknowledgements remain unchanged.
const plain = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value: object, key: string) => Object.hasOwn(value, key);
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && Array.from(value).length <= limit;
const fail = (code: string): never => { throw new Error(code); };
const legacyFields = new Set(['orderAmount','amount','realAmount','actualAmount','payAmount','callbackAmount','feeAmount','giveAmount','money','status','createTime','callbackTime','operatorAt','operateAt','operateTime','updateTime','updatedAt','createdAt','created_at','createAt','orderCreateTime','orderCreatedAt','applyTime']);
const moneyFields = new Set(['beforeRechargeWithdrawDiff','currentProfitAmount','rechargeWithdrawDiff']);
const integerFields = new Set(['firstFlag','successNo','totalOrderNum','lockType']);
const textFields = new Set(['appCode','appName','transactionId','withdrawBankAppName','withdrawChannelName','withdrawMethodName','withdrawThirdName','withdrawTypeCode','withdrawTypeName','rechargeChannelName','rechargeMethodName','rechargeThirdName','rechargeTypeName','thirdMethodName','operatorName','lockOperatorName']);
const metadataFields = new Set(['businessSchemaVersion','remark','remarkState','appRemark','appRemarkState','groupList','groupListTruncated']);
const orderFields = new Set(['order_no','member_id','status_code','status_text','status_class','order_amount','actual_amount','metric_amount','created_at','finished_at','paid_at','operator_name','operator_kind','handle_seconds','third_party','raw_channel','mapping_code','payment_method','merchant_name','raw']);
const scalar = (value: unknown) => value === null || typeof value === 'string' || typeof value === 'number';

export function validateBusinessRaw(value: unknown): void {
  if (!plain(value)) fail('LG_INVALID_PRIVATE_FIELDS');
  const raw = value as Record<string, any>;
  const versioned = has(raw, 'businessSchemaVersion');
  for (const [key, item] of Object.entries(raw)) {
    if (legacyFields.has(key)) {
      if (!scalar(item)) fail('LG_INVALID_PRIVATE_FIELDS');
    } else if (!versioned || !(moneyFields.has(key) || integerFields.has(key) || textFields.has(key) || metadataFields.has(key))) {
      fail('LG_INVALID_PRIVATE_FIELDS');
    }
  }
  if (!versioned) return;
  if (raw.businessSchemaVersion !== 1 || ['remark','remarkState','appRemark','appRemarkState'].some(key => !has(raw, key))) fail('LG_INVALID_PRIVATE_FIELDS');
  for (const key of ['remark','appRemark']) {
    const note = raw[key], state = raw[`${key}State`];
    if (!text(note, 12000) || !['present','empty','redacted','missing'].includes(state)) fail('LG_INVALID_BUSINESS_NOTE');
    if ((state === 'empty' || state === 'missing') && note !== '') fail('LG_INVALID_BUSINESS_NOTE');
    if (state === 'redacted' && note !== '[已隐藏]') fail('LG_INVALID_BUSINESS_NOTE');
    if (state === 'present' && (note.trim() === '' || (note.includes('[已隐藏]') && !/[\p{L}\p{N}]/u.test(note.replaceAll('[已隐藏]', ''))))) fail('LG_INVALID_BUSINESS_NOTE');
  }
  for (const key of moneyFields) if (has(raw, key) && !(typeof raw[key] === 'string' && /^-?[0-9]{1,30}(?:\.[0-9]{1,18})?$/.test(raw[key]))) fail('LG_INVALID_BUSINESS_AMOUNT');
  for (const key of integerFields) if (has(raw, key) && !Number.isSafeInteger(raw[key])) fail('LG_INVALID_BUSINESS_INTEGER');
  for (const key of textFields) if (has(raw, key) && !text(raw[key], key === 'transactionId' ? 200 : 500)) fail('LG_INVALID_BUSINESS_TEXT');
  if (has(raw, 'groupListTruncated') && (raw.groupListTruncated !== true || !has(raw, 'groupList'))) fail('LG_INVALID_BUSINESS_GROUPS');
  if (has(raw, 'groupList')) {
    if (!Array.isArray(raw.groupList) || raw.groupList.length > 100) fail('LG_INVALID_BUSINESS_GROUPS');
    for (const group of raw.groupList) {
      if (!plain(group) || Object.keys(group).some(key => !['groupId','groupName','colorTag'].includes(key))) fail('LG_INVALID_BUSINESS_GROUPS');
      if (has(group, 'groupId') && !Number.isSafeInteger(group.groupId)) fail('LG_INVALID_BUSINESS_GROUPS');
      if (has(group, 'groupName') && !text(group.groupName, 500)) fail('LG_INVALID_BUSINESS_GROUPS');
      if (has(group, 'colorTag') && !(typeof group.colorTag === 'string' && /^(?:#[A-Fa-f0-9]{3}|#[A-Fa-f0-9]{4}|#[A-Fa-f0-9]{6}|#[A-Fa-f0-9]{8}|[A-Za-z]{1,32})$/.test(group.colorTag))) fail('LG_INVALID_BUSINESS_GROUPS');
    }
  }
}

export function validateBusinessOrder(order: Record<string, any>): void {
  if (Array.from(orderFields).some(key => !has(order, key)) || Object.keys(order).some(key => !orderFields.has(key))) fail('LG_INVALID_PRIVATE_FIELDS');
  if (!(order.member_id === null || (typeof order.member_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(order.member_id)))) fail('LG_INVALID_PRIVATE_FIELDS');
  validateBusinessRaw(order.raw);
}
