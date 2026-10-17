'use strict';
const fs=require('node:fs'),path=require('node:path'),dir=path.resolve(__dirname,'../../supabase/operations/withdraw-prepared');
const parts=['../withdraw-windows/clocks','store','kernels','../withdraw-windows/secondary','../withdraw-windows/result','runtime','schedule','capture','coordination'];
fs.writeFileSync(path.join(dir,'install.sql'),'-- Generated offline installation only: original RPC and cron remain unchanged.\nBEGIN;\nSET LOCAL lock_timeout=\'500ms\';\nSET LOCAL statement_timeout=\'15s\';\n'+parts.map(n=>'\n-- BEGIN '+n+'\n'+fs.readFileSync(path.join(dir,n+'.sql'),'utf8')).join('\n')+'\nCOMMIT;\n');
