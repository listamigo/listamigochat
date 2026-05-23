export function $(selector: string, parent: ParentNode = document): HTMLElement | null {
  return parent.querySelector(selector) as HTMLElement | null;
}

export function $$(selector: string, parent: ParentNode = document): HTMLElement[] {
  return Array.from(parent.querySelectorAll(selector)) as HTMLElement[];
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<HTMLElementTagNameMap[K]> & Record<string, string | number | boolean> = {},
  children: (string | HTMLElement)[] = []
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      el.className = String(value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value as Record<string, string>);
    } else if (typeof value === 'boolean') {
      if (value) el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      el.textContent = child;
    } else {
      el.appendChild(child);
    }
  }
  return el;
}

export function $empty(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function showToast(msg: string): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function truncate(val: string, max: number): string {
  return val.length > max ? val.slice(0, max) : val;
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

let lastFocusedEl: HTMLElement | null = null;

function getFocusable(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
}

export function openModal(id: string): void {
  const modal = document.getElementById(id);
  if (!modal) return;
  lastFocusedEl = document.activeElement as HTMLElement;
  modal.classList.add('visible');
  const focusable = getFocusable(modal);
  if (focusable.length) focusable[0].focus();
}

export function closeModal(id: string): void {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('visible');
  lastFocusedEl?.focus();
  lastFocusedEl = null;
}

export function trapTabFocus(e: KeyboardEvent, containerId: string): void {
  if (e.key !== 'Tab') return;
  const container = document.getElementById(containerId);
  if (!container || !container.classList.contains('visible')) return;
  const focusable = getFocusable(container);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function delegate(
  parent: HTMLElement,
  selector: string,
  eventType: string,
  handler: (target: HTMLElement, event: Event) => void
): void {
  parent.addEventListener(eventType, (e: Event) => {
    const target = (e.target as HTMLElement).closest(selector) as HTMLElement | null;
    if (target && parent.contains(target)) {
      handler(target, e);
    }
  });
}

let confirmCallback: (() => void) | null = null;

export function showConfirmModal(title: string, message: string, btnText: string, callback: () => void): void {
  const titleEl = document.getElementById('confirmTitle');
  const msgEl = document.getElementById('confirmMessage');
  const actionBtn = document.getElementById('confirmActionBtn');
  const modal = document.getElementById('confirmModal');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (actionBtn) actionBtn.textContent = btnText;
  confirmCallback = callback;
  openModal('confirmModal');
}

export function closeConfirmModal(): void {
  closeModal('confirmModal');
  confirmCallback = null;
}

export function executeConfirmAction(): void {
  const cb = confirmCallback;
  closeConfirmModal();
  if (cb) cb();
}

export function getLastBackupDate(): string | null {
  return localStorage.getItem('lastBackupDate');
}

export function setLastBackupDate(date: string): void {
  localStorage.setItem('lastBackupDate', date);
}
