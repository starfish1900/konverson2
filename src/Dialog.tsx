import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from './App.module.css';

export function Dialog({ title, children, onClose, wide=false }: { title: string; children: ReactNode; onClose: ()=>void; wide?: boolean }) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const dialog=ref.current;
    dialog?.showModal();
    const onCancel=(event:Event)=>{event.preventDefault();onClose();};
    dialog?.addEventListener('cancel',onCancel);
    return()=>{dialog?.removeEventListener('cancel',onCancel);dialog?.close();previous?.focus();};
  },[onClose]);
  return <dialog ref={ref} className={`${styles.dialog} ${wide?styles.wideDialog:''}`} aria-labelledby="dialog-title" onClick={event=>{if(event.target===ref.current){const r=ref.current.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)onClose();}}}>
    <div className={styles.dialogHeading}><h2 id="dialog-title">{title}</h2><button onClick={onClose} aria-label="Close dialog"><X size={20}/></button></div>{children}
  </dialog>;
}
