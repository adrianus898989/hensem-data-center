"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./AccountEditorDialog.css";

type Props={title:string;busy?:boolean;onClose:()=>void;children:ReactNode;bodyClassName?:string};
export default function AccountEditorDialog({title,busy=false,onClose,children,bodyClassName=""}:Props){
 const titleId=useId(),dialog=useRef<HTMLDivElement>(null),current=useRef({busy,onClose});current.current={busy,onClose};
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow="hidden";
  const focusable=()=>Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')||[]).filter(el=>!el.closest('[hidden]'));
  const timer=setTimeout(()=>{const target=dialog.current?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled)')||focusable()[0]||dialog.current;target?.focus()},0);
  function keydown(event:KeyboardEvent){if(event.key==="Escape"){event.preventDefault();event.stopPropagation();if(!current.current.busy)current.current.onClose();return}if(event.key!=="Tab")return;const items=focusable(),first=items[0],last=items.at(-1);if(!first){event.preventDefault();dialog.current?.focus();return}if(event.shiftKey&&(document.activeElement===first||!dialog.current?.contains(document.activeElement))){event.preventDefault();last?.focus()}else if(!event.shiftKey&&(document.activeElement===last||!dialog.current?.contains(document.activeElement))){event.preventDefault();first.focus()}}
  document.addEventListener("keydown",keydown,true);return()=>{clearTimeout(timer);document.removeEventListener("keydown",keydown,true);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()};
 },[]);
 return createPortal(<div className="account-editor-overlay" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}><div ref={dialog} className="account-editor-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}><header><h2 id={titleId}>{title}</h2><button type="button" aria-label="关闭账号弹窗" disabled={busy} onClick={onClose}>×</button></header><div className={"account-editor-dialog-body "+bodyClassName}>{children}</div></div></div>,document.body);
}
