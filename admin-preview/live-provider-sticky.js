/* Window-level header for the two single-table provider reports only. */
(function(root){
 'use strict';
 let cleanup=null;
 function clear(){if(cleanup)cleanup();cleanup=null}
 function mount(){
  clear();
  const doc=root.document,wrap=doc?.querySelector('.provider-summary-report .provider-compact-table'),table=wrap?.querySelector('table');
  if(!table?.tHead||!root.requestAnimationFrame)return;
  const floating=doc.createElement('div'),copy=doc.createElement('table'),head=table.tHead.cloneNode(true);
  floating.className='provider-summary-table provider-compact-table provider-floating-head';floating.hidden=true;
  floating.setAttribute('aria-label','三方汇总固定表头');copy.appendChild(head);floating.appendChild(copy);doc.body.appendChild(floating);
  let frame=0;
  function measure(){
   copy.style.width=table.getBoundingClientRect().width+'px';copy.style.tableLayout='fixed';
   Array.from(table.tHead.rows[0].cells).forEach((cell,i)=>{const width=cell.getBoundingClientRect().width+'px';Object.assign(head.rows[0].cells[i].style,{width,minWidth:width,maxWidth:width,boxSizing:'border-box'})});
  }
  function update(){
   frame=0;if(!wrap.isConnected){clear();return}
   const bounds=wrap.getBoundingClientRect(),top=Math.max(0,doc.querySelector('.topbar')?.getBoundingClientRect().bottom||0),height=table.tHead.getBoundingClientRect().height;
   floating.hidden=!(bounds.top<top&&bounds.bottom>top+height&&bounds.width>0);
   if(floating.hidden)return;
   Object.assign(floating.style,{top:top+'px',left:bounds.left+'px',width:wrap.clientWidth+'px'});copy.style.marginLeft=-wrap.scrollLeft+'px';
  }
  function schedule(){if(!frame)frame=root.requestAnimationFrame(update)}
  function resize(){measure();schedule()}
  doc.addEventListener('scroll',schedule,{capture:true,passive:true});root.addEventListener('resize',resize,{passive:true});
  const observer=root.ResizeObserver?new root.ResizeObserver(resize):null;observer?.observe(table);
  cleanup=()=>{doc.removeEventListener('scroll',schedule,true);root.removeEventListener('resize',resize);observer?.disconnect();if(frame)root.cancelAnimationFrame(frame);floating.remove()};
  measure();update();
 }
 root.HensemProviderSticky={mount,clear};
})(window);
