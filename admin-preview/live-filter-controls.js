(function(root){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function multi({key,label,items,values=[],open=false,search='',wide=false,busy=false,error='',single=false}){
  const selected=new Set(values),q=String(search).toLocaleLowerCase(),labels=items.filter(([id])=>selected.has(id)).map(([,text])=>text);
  const caption=single?(labels.length===1?labels[0]:'请选择一个平台'):labels.length===0?'全部':labels.length===1?labels[0]:labels.length+' 项已选';
  return '<div class="live-field live-multi '+(wide?'wide':'')+'"><label id="live-'+key+'-label">'+escape(label)+'</label>'+
   '<details data-multi="'+key+'" '+(open?'open':'')+' ontoggle="liveMultiToggle(this)"><summary aria-labelledby="live-'+key+'-label" title="'+escape(caption)+'"><span class="live-multi-caption">'+escape(caption)+'</span><span aria-hidden="true">⌄</span></summary>'+
   '<div class="live-multi-menu"><div class="live-multi-search"><input type="search" aria-label="搜索'+escape(label)+'" placeholder="输入名称搜索" value="'+escape(search)+'" oninput="liveMultiSearch(\''+key+'\',this.value)"></div>'+
   '<div class="live-multi-actions">'+(single?'': '<button type="button" onclick="liveMultiAll(\''+key+'\',true)">全选结果</button>')+'<button type="button" onclick="liveMultiAll(\''+key+'\',false)">清空</button><span>'+values.length+' 项已选</span></div>'+
   '<div class="live-multi-options">'+items.map(([value,text])=>'<label class="live-multi-option" '+(!String(text).toLocaleLowerCase().includes(q)?'hidden':'')+' data-search="'+escape(String(text).toLocaleLowerCase())+'"><input type="'+(single?'radio':'checkbox')+'" name="live-choice-'+key+'" value="'+escape(value)+'" '+(selected.has(value)?'checked':'')+' onchange="liveSetMultiOption(\''+key+'\',this)"><span>'+escape(text)+'</span></label>').join('')+'</div>'+
   '<div class="live-multi-empty" '+(items.some(([,text])=>String(text).toLocaleLowerCase().includes(q))?'hidden':'')+'>'+(busy?'正在读取已有归类…':escape(error||'没有匹配选项'))+'</div></div></details>'+
   '<select id="live-'+key+'" '+(single?'':'multiple')+' hidden aria-hidden="true">'+items.map(([value,text])=>'<option value="'+escape(value)+'" '+(selected.has(value)?'selected':'')+'>'+escape(text)+'</option>').join('')+'</select></div>';
 }
 root.HensemLiveFilters={multi};
 if(typeof module!=='undefined')module.exports={multi};
})(typeof window!=='undefined'?window:globalThis);
