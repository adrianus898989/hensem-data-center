const fs=require('node:fs'),path=require('node:path');
const{setup:baseSetup}=require('../provider-snapshot-harness.cjs');
// Original guarded shadow installer, then exact two reviewed replacement bodies.
// Fee relations contain no business rows. No fake owner JWT or worker execution.
async function setup(options={}){const db=await baseSetup(options);try{for(const f of['fee-baseline-fixture.sql','dependency-token-after.sql','worker-finish-after.sql'])await db.exec(fs.readFileSync(path.join(__dirname,f),'utf8'));return db;}catch(e){await db.close();throw e;}}
module.exports={setup};
