const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const source=read('supabase/functions/bright-responder/fee-version-source.ts');
const mod={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,Date,Map});const api=mod.exports;
test('strict explicit ISO time rejects guessed dates, serial dates and invalid calendars',()=>{
 assert.equal(api.explicitEffectiveTime('2026-10-02T00:00:00+05:30'),'2026-10-01T18:30:00.000Z');
 for(const v of ['2026-10-02','2026-10-02 00:00:00',46300,'2026-02-30T00:00:00Z','2026-13-01T00:00:00Z','2026-10-02T24:00:00Z','2026-10-02T00:00:00+15:00','2026-10-02T00:00:00+14:01'])assert.equal(api.explicitEffectiveTime(v),null,String(v));
});
test('effective/currency columns never become fake platforms and original row/column coordinates survive',()=>{
 const rows=[['三方','生效时间','91CLUB','币种'],['P','2026-10-02T00:00:00+05:30','开启','INR']];const out=api.rateEffectiveEvidence(rows);
 assert.equal(out.values[0][1],'');assert.equal(out.values[1][3],'');assert.equal(out.values[1][2],'开启');assert.equal(rows[1][1],'2026-10-02T00:00:00+05:30');
 assert.equal(out.rows.get(2).effectiveCell,'B2');assert.equal(out.rows.get(2).currencyCell,'D2');assert.equal(out.rows.get(2).currency,'INR');assert.equal(out.rows.get(2).state,'ready');
});
test('second-row headers, duplicate headers, blanks and invalid currencies have deterministic evidence',()=>{
 const out=api.rateEffectiveEvidence([['Title'],['三方','生效时间','币种'],['P','2026-10-02T00:00:00Z','INR'],['Q','',''],['R','2026-10-03T00:00:00Z','unknown-currency']]);
 assert.equal(out.rows.get(3).state,'ready');assert.equal(out.rows.get(4).state,'missing_effective_time');assert.equal(out.rows.get(5).currency,null);
 assert.equal(api.rateEffectiveEvidence([['生效时间','生效时间'],['','','']]).rows.get(2).state,'ambiguous_effective_column');
 assert.equal(api.rateEffectiveEvidence([['三方'],['P']]).rows.get(2).state,'missing_effective_column');
});
test('actual deployed-source successor uses one atomic publisher and preserves sync authorization',()=>{
 const s=read('supabase/functions/bright-responder/sync-third-party.ts');
 const branch=s.slice(s.indexOf('if (action === "check-rates" || action === "sync-rates")'),s.indexOf('// 三方量：代收、代付必须分开跑'));
 assert.match(branch,/fee_rate_publish_generation/);assert.doesNotMatch(branch,/upsertBatchesFinal|\.delete\(\)/);assert.match(s,/receivedSecret !== expectedSecret/);
 assert.match(s,/p_observed_at: source.observedAt/);assert.match(s,/rateEffectiveEvidence\(sourceValues\)/);assert.match(s,/sheetId: Number\(s\?\.properties\?\.sheetId\)/);
 assert.match(s,/configured_rate_sheet_missing/);assert.match(s,/rate_sheet_too_large/);assert.doesNotMatch(s,/const endRow = Math.min\(sheetMeta.rowCount \|\| 800, 800\);[\s\S]*versionEvidence/);
 const transpiled=ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});assert.equal((transpiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
});
test('actual v59 parser keeps existing fee and platform facts after the two new source columns are removed',()=>{
 const entry=read('supabase/functions/bright-responder/sync-third-party.ts');
 const js=ts.transpileModule(entry,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
 const ctx={Deno:{serve(){},env:{get(){return ''}}},rateEffectiveEvidence:api.rateEffectiveEvidence,console,Map,Set,Date,URL,TextEncoder,TextDecoder};vm.createContext(ctx);
 vm.runInContext(js+'\nglobalThis.parseFixture = v166ParseUnifiedRateSheet;',ctx);
 const original=[['三方名称','类型','代收费率','代付费率','代收单笔','代付单笔','91CLUB'],['ExamplePay','BANK','1%','2%','0','6','开启']];
 const appended=original.map((row,i)=>[...row,...(i===0?['生效时间','币种']:['2026-10-02T00:00:00+05:30','INR'])]);
 const before=ctx.parseFixture('印度线下',original),after=ctx.parseFixture('印度线下',api.rateEffectiveEvidence(appended).values);
 assert.deepEqual(JSON.parse(JSON.stringify(after)),JSON.parse(JSON.stringify(before)));assert.ok(before.rates.length>0);assert.ok(before.statuses.length>0);
});
