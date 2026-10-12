const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const {PGlite}=require('@electric-sql/pglite');let db;
const moduleFile='collectors/lg-business-notes-upgrade/business_fields.py.part';
const cases=[
 '98****1234', '4111****1111', '****1234', '09xx xxxx 1234', 'name Alice Smith', '姓名 张三', 'name mismatch', 'Name missing', '姓名 不一致', 'recipient Synthetic Name; declined',
 '普通业务驳回，请重新提交', '业务校验 2026-10-12 12:03:04 已完成',
 'Business 2026/10/12T12:03Z and 2026.10.13 12:30+0530',
 'phone: +55 11 99999-8888; decline', '姓名：合成姓名; 业务审核',
 'email: synthetic@example.invalid; user@ybl', 'site https://example.invalid/path?secret=x',
 'visit www.example.invalid/path or example.com/private ftp://example.invalid/private',
 'IPv4 192.0.2.1 IPv6 2001:db8::1 / ::1 ; clock 12:03:04',
 'IBAN GB82 WEST 1234 5698 7654 32', 'UUID 123e4567-e89b-12d3-a456-426614174000',
 'Passport AB1234567; token: SYNTHETIC-TOKEN', '123.456.789-01 and (11) 99999 8888',
 'Bearer eyJsynthetic.eyJsynthetic.SYNTHETIC', '\u0001\u200b隐私\t业务\n说明\ufeff',
 '  [已隐藏] [已隐藏] 业务  ', '全角１２３４５６７８９；ｔｏｋｅｎ：ＳＹＮＴＨＥＴＩＣ',
 '长业务内容'.repeat(2600), '业务 2026-10-12 123456789012 尾',
 '[已隐藏]', '', '业务 [内容超长已截断]', '---', ';;', '123\u0600456789', '123\u2060456789', '123\u{e0001}456789',
];
function client(values){
 const code=String.raw`import ast,json,re,sys
from pathlib import Path
tree=ast.parse(Path(sys.argv[1]).read_text())
names={'lgd_business_plain_text','lgd_redact_business_text'}
nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names]
if {n.name for n in nodes}!=names: raise SystemExit('sanitizer fixture functions changed')
class SyntheticError(Exception): pass
env={'re':re,'LGD_REDACTED':'[已隐藏]','LGD_TRUNCATED':'[内容超长已截断]','LGD_BUSINESS_NOTE_LIMIT':12000,'lgd_SyncError':SyntheticError}
exec(compile(ast.Module(body=nodes,type_ignores=[]),'<only-two-pure-sanitizer-functions>','exec'),env)
print(json.dumps([env['lgd_redact_business_text'](v) for v in json.load(sys.stdin)],ensure_ascii=False))`;
 return JSON.parse(cp.execFileSync('python3',['-c',code,moduleFile],{input:JSON.stringify(values),encoding:'utf8'}));
}
test.before(async()=>{db=new PGlite();await db.exec('create schema private;create role anon;create role authenticated;create role service_role;');await db.exec(fs.readFileSync('supabase/lg-business-notes-receiver.sql','utf8'));});
test.after(async()=>{await db?.close()});
test('SQL sanitizer matches the actual client on synthetic text and accepts every already-sanitized output',async()=>{
 const expected=client(cases);
 for(let i=0;i<cases.length;i++){
  const out=(await db.query('select private.lg_business_note_safe($1) v',[cases[i]])).rows[0].v;
  assert.equal(out,expected[i],'client/server sanitizer case '+i);
  const stable=(await db.query('select private.lg_business_note_safe($1) v',[expected[i]])).rows[0].v;
  assert.equal(stable,expected[i],'sanitizer must be idempotent case '+i);
 }
});
test('full notes retain the 12000-character business limit, while null stays missing',async()=>{
 for(const n of [256,501,12000])assert.equal((await db.query('select length(private.lg_business_note_safe($1)) n',['文'.repeat(n)])).rows[0].n,n);
 assert.equal((await db.query('select private.lg_business_note_safe(null) v')).rows[0].v,null);
 const t=(await db.query('select private.lg_business_note_safe($1) v',['文'.repeat(13000)])).rows[0].v;
 assert.equal(t.length,12000);assert(t.endsWith('[内容超长已截断]'));
});
test('transaction identifiers have the explicit source-business exception; free note numbers do not',async()=>{
 const raw={businessSchemaVersion:1,remark:'业务校验',remarkState:'present',appRemark:'',appRemarkState:'missing',transactionId:'98765432109876543210'};
 await db.query('select private.lg_validate_business_raw($1::jsonb)',[JSON.stringify(raw)]);
 await assert.rejects(db.query('select private.lg_validate_business_raw($1::jsonb)',[JSON.stringify({...raw,remark:'98765432109876543210'})]),/LG_INVALID_BUSINESS_NOTE/);
 await assert.rejects(db.query('select private.lg_validate_business_raw($1::jsonb)',[JSON.stringify({...raw,transactionId:'email@synthetic.invalid'})]),/LG_INVALID_BUSINESS_TEXT/);
});

test('present punctuation is retained while redacted-only and empty present are rejected',async()=>{
 const row=remark=>({businessSchemaVersion:1,remark,remarkState:'present',appRemark:'',appRemarkState:'missing'});
 for(const v of client(['---',';;','…']))await db.query('select private.lg_validate_business_raw($1::jsonb)',[JSON.stringify(row(v))]);
 for(const v of ['','[已隐藏]','[已隐藏] --'])await assert.rejects(db.query('select private.lg_validate_business_raw($1::jsonb)',[JSON.stringify(row(v))]),/LG_INVALID_BUSINESS_NOTE/);
});
