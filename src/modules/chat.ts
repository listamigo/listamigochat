import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE_CONFIG, GIPHY_CONFIG, ADMIN_CODE } from '../config/constants';
import { showConfirmModal, showToast } from '../utils/dom';

interface ChatMessage {
  id: string;
  nickname: string;
  text: string;
  timestamp: number;
  gif?: { url: string; width?: number; height?: number };
  image?: { url: string };
  color?: string;
  emoji?: string;
}

const STORAGE_KEY = 'chat_messages';
const NICKNAME_KEY = 'chat_nickname';
const COLOR_KEY = 'chat_color';
const EMOJI_KEY = 'chat_emoji';
const RESET_KEY = 'chat_reset_at';
const MAX_MESSAGES = 200;

const COLORS = [
  '#1D4ED8', '#7C3AED', '#DB2777', '#DC2626',
  '#EA580C', '#D97706', '#65A30D', '#0891B2',
];

const EMOJIS = ['😀', '🎉', '👍', '❤️', '🔥', '😎', '💪', '🎯'];

let supabase: SupabaseClient | null = null;
let supabaseChannel: RealtimeChannel | null = null;
let currentNickname = '';
let currentColor = '';
let currentEmoji = '';
let checkingNickname = false;
let presenceEntered = false;
let audioCtx: AudioContext | null = null;
const sentIds = new Set<string>();

function initAudio(): void {
  if (audioCtx) return;
  audioCtx = new AudioContext();
}

function playNotificationSound(): void {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);
  osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.08);
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.25);
}

function loadMessages(): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').filter((m: ChatMessage) => m.timestamp > getResetAt());
  } catch { return []; }
}

function getResetAt(): number {
  try {
    return parseInt(localStorage.getItem(RESET_KEY) || '0', 10);
  } catch { return 0; }
}

function saveMessages(msgs: ChatMessage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  } catch { /* ignore */ }
}

function loadNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) || '';
  } catch {
    return '';
  }
}

function saveNickname(name: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, name);
  } catch { /* ignore */ }
}

function loadColor(): string {
  try {
    return localStorage.getItem(COLOR_KEY) || '';
  } catch {
    return '';
  }
}

function saveColor(c: string): void {
  currentColor = c;
  try {
    localStorage.setItem(COLOR_KEY, c);
  } catch { /* ignore */ }
}

function renderMessages(): void {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const messages = loadMessages();
  if (messages.length === 0) {
    container.innerHTML = '<div class="chat-empty">No hay mensajes aún. ¡Sé el primero en escribir!</div>';
    return;
  }
  container.innerHTML = '';
  const fragment = document.createDocumentFragment();
  messages.forEach(m => {
    fragment.appendChild(createMessageElement(m));
  });
  container.appendChild(fragment);
  container.scrollTop = container.scrollHeight;
}

function createMessageElement(m: ChatMessage): HTMLElement {
  const time = new Date(m.timestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const isOwn = m.nickname === currentNickname;
  const nickColor = isOwn ? (currentColor || 'var(--primary)') : (m.color || 'var(--primary)');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (isOwn ? 'chat-msg-own' : 'chat-msg-other');
  div.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-nick" style="color:${nickColor}">${m.emoji ? escapeHtml(m.emoji) + ' ' : ''}${escapeHtml(m.nickname)}</span>
      <span class="chat-msg-time">${time}</span>
    </div>
    ${m.image
      ? `<img class="chat-msg-image" src="${escapeHtml(m.image.url)}" alt="Imagen" loading="lazy">`
      : m.gif
      ? `<img class="chat-msg-gif" src="${escapeHtml(m.gif.url)}" alt="GIF" loading="lazy">`
      : `<div class="chat-msg-text">${escapeHtml(m.text)}</div>`
    }
  `;
  return div;
}

function appendMessage(msg: ChatMessage): void {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();
  container.appendChild(createMessageElement(msg));
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function isValidChatMessage(data: unknown): data is ChatMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  if (typeof m.id !== 'string' || !m.id) return false;
  if (typeof m.nickname !== 'string' || !m.nickname) return false;
  if (typeof m.timestamp !== 'number') return false;
  if (typeof m.text !== 'string') return false;
  if (m.color !== undefined && typeof m.color !== 'string') return false;
  if (m.emoji !== undefined && typeof m.emoji !== 'string') return false;
  if (m.gif !== undefined) {
    if (typeof m.gif !== 'object' || !m.gif) return false;
    if (typeof (m.gif as Record<string, unknown>).url !== 'string') return false;
  }
  if (m.image !== undefined) {
    if (typeof m.image !== 'object' || !m.image) return false;
    if (typeof (m.image as Record<string, unknown>).url !== 'string') return false;
  }
  return true;
}

function receiveMessage(data: unknown): void {
  if (!isValidChatMessage(data)) return;
  const msg = data as ChatMessage;
  const messages = loadMessages();
  const exists = messages.some(m => m.id === msg.id);
  if (!exists) {
    messages.push(msg);
    if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
    saveMessages(messages);
    appendMessage(msg);
    if (!sentIds.has(msg.id) && msg.nickname !== currentNickname) playNotificationSound();
  }
}

function enterPresence(nick: string): void {
  if (!supabaseChannel || presenceEntered) return;
  presenceEntered = true;
  try {
    supabaseChannel.track({ nickname: nick, enteredAt: Date.now() });
  } catch (e) {
    console.error('Presence track error:', e);
  }
}

async function isNicknameTaken(nick: string): Promise<boolean> {
  if (!supabaseChannel) return false;
  try {
    const presences = supabaseChannel.presenceState();
    return Object.values(presences).flat().some((p: any) => p.nickname === nick);
  } catch {
    return false;
  }
}

function sendMessage(gifUrl?: string, imageUrl?: string): void {
  const input = document.getElementById('chatInput') as HTMLInputElement | null;

  if (!gifUrl && !imageUrl && (!input || !input.value.trim())) return;

  const hasMedia = !!(gifUrl || imageUrl);
  const text = hasMedia ? '' : (input?.value.trim() || '');
  if (!hasMedia && /(https?:\/\/[^\s]+|https?:\S+|www\.[^\s]+|[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})+\/?[^\s]*)/i.test(text)) {
    showToast('⚠️ No se permiten enlaces en el chat');
    return;
  }

  if (!currentNickname) {
    const nickInput = document.getElementById('chatNickname') as HTMLInputElement | null;
    if (!nickInput) return;
    const nick = nickInput.value.trim();
    if (!nick) {
      (document.querySelector('.chat-nickname-input') as HTMLElement)?.classList.add('shake');
      setTimeout(() => (document.querySelector('.chat-nickname-input') as HTMLElement)?.classList.remove('shake'), 400);
      return;
    }
    setNickname(nick);
  }

  const msg: ChatMessage = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    nickname: currentNickname,
    color: currentColor || undefined,
    emoji: currentEmoji || undefined,
    text: hasMedia ? '' : text,
    timestamp: Date.now(),
  };

  if (gifUrl) {
    msg.gif = { url: gifUrl };
  }
  if (imageUrl) {
    msg.image = { url: imageUrl };
  }

  if (input) input.value = '';

  if (supabase) {
    supabase.from('messages').insert([{
      nickname: msg.nickname,
      text: msg.text,
      color: msg.color || null,
      emoji: msg.emoji || null,
      gif_url: msg.gif?.url || null,
      image_url: msg.image?.url || null
    }]).then(({ error }) => {
      if (error) {
        console.error('Error inserting message:', error);
        showToast('⚠️ Error al enviar el mensaje');
      }
    });
  }
}

async function handleNicknameKeydown(e: KeyboardEvent): Promise<void> {
  if (e.key !== 'Enter') return;
  const input = e.target as HTMLInputElement;
  const nick = input.value.trim();
  if (!nick) return;

  if (checkingNickname) return;
  checkingNickname = true;

  const taken = await isNicknameTaken(nick);
  checkingNickname = false;

  if (taken) {
    const container = input.closest('.chat-nickname-input') as HTMLElement;
    container?.classList.add('shake');
    setTimeout(() => container?.classList.remove('shake'), 400);
    input.value = '';
    input.placeholder = 'Ese nombre ya está en uso';
    setTimeout(() => { input.placeholder = 'Tu nombre...'; }, 2000);
    return;
  }

  setNickname(nick);
  document.getElementById('chatInput')?.focus();
}

function handleInputKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') sendMessage();
}

function setNickname(nick: string): void {
  currentNickname = nick;
  saveNickname(nick);
  if (!currentColor) {
    const saved = loadColor();
    currentColor = saved || COLORS[0];
    if (!saved) saveColor(currentColor);
  }
  document.getElementById('chatNicknameSection')?.classList.add('chat-hidden');
  document.getElementById('chatMainSection')?.classList.remove('chat-hidden');
  renderMessages();
  updateFooter();
}

function updateFooter(): void {
  const el = document.getElementById('chatFooterText');
  if (!el) return;
  const emoji = currentEmoji || EMOJIS[0];
  el.innerHTML = `Hablando como <strong>${escapeHtml(currentNickname)}</strong> <span class="chat-emoji-dot" id="chatEmojiDot">${emoji}</span> <span class="chat-color-dot" style="background:${currentColor || COLORS[0]}" id="chatColorDot"></span>`;
  document.getElementById('chatColorDot')?.addEventListener('click', toggleColorPicker);
  document.getElementById('chatEmojiDot')?.addEventListener('click', toggleEmojiPicker);
}

let colorPickerOpen = false;

function toggleColorPicker(): void {
  const picker = document.getElementById('chatColorPicker');
  if (!picker) return;
  colorPickerOpen = !colorPickerOpen;
  picker.classList.toggle('chat-hidden', !colorPickerOpen);
}

function selectColor(c: string): void {
  saveColor(c);
  colorPickerOpen = false;
  document.getElementById('chatColorPicker')?.classList.add('chat-hidden');
  updateFooter();
  renderMessages();
}

function loadEmoji(): string {
  try {
    return localStorage.getItem(EMOJI_KEY) || '';
  } catch {
    return '';
  }
}

function saveEmoji(e: string): void {
  currentEmoji = e;
  try {
    localStorage.setItem(EMOJI_KEY, e);
  } catch { /* ignore */ }
}

let emojiPickerOpen = false;

function toggleEmojiPicker(): void {
  const picker = document.getElementById('chatEmojiPicker');
  if (!picker) return;
  emojiPickerOpen = !emojiPickerOpen;
  picker.classList.toggle('chat-hidden', !emojiPickerOpen);
}

function selectEmoji(e: string): void {
  saveEmoji(e);
  emojiPickerOpen = false;
  document.getElementById('chatEmojiPicker')?.classList.add('chat-hidden');
  updateFooter();
  renderMessages();
}

let connectTimeout: ReturnType<typeof setTimeout> | null = null;

function setConnectionStatus(ok: boolean): void {
  const el = document.getElementById('chatConnectionStatus');
  if (!el) return;
  el.className = ok ? 'chat-status-ok' : 'chat-status-err';
  if (ok && connectTimeout) {
    clearTimeout(connectTimeout);
    connectTimeout = null;
  }
}

async function fetchHistory(): Promise<void> {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) throw error;
    if (!data || data.length === 0) return;

    const historyMsgs: ChatMessage[] = data.map((newRow: any) => ({
      id: String(newRow.id),
      nickname: newRow.nickname,
      text: newRow.text || '',
      timestamp: newRow.created_at ? new Date(newRow.created_at).getTime() : Date.now(),
      color: newRow.color || undefined,
      emoji: newRow.emoji || undefined,
      gif: newRow.gif_url ? { url: newRow.gif_url } : undefined,
      image: newRow.image_url ? { url: newRow.image_url } : undefined
    }));

    const resetAt = getResetAt();
    const filtered = historyMsgs.filter(m => m.timestamp > resetAt);
    if (filtered.length === 0) return;

    const local = loadMessages();
    const merged = [...local];
    for (const hMsg of filtered) {
      if (!merged.some(m => m.id === hMsg.id)) merged.push(hMsg);
    }
    merged.sort((a, b) => a.timestamp - b.timestamp);
    if (merged.length > MAX_MESSAGES) merged.splice(0, merged.length - MAX_MESSAGES);
    saveMessages(merged);
    renderMessages();
  } catch (err) {
    console.error('History fetch error:', err);
  }
}

function connectSupabase(): void {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.key) {
    setConnectionStatus(false);
    return;
  }

  try {
    supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
    supabaseChannel = supabase.channel(SUPABASE_CONFIG.channelName, {
      config: {
        presence: {
          key: currentNickname
        }
      }
    });

    supabaseChannel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          setConnectionStatus(true);
          const newRow = payload.new;
          const msg: ChatMessage = {
            id: String(newRow.id),
            nickname: newRow.nickname,
            text: newRow.text || '',
            timestamp: newRow.created_at ? new Date(newRow.created_at).getTime() : Date.now(),
            color: newRow.color || undefined,
            emoji: newRow.emoji || undefined,
            gif: newRow.gif_url ? { url: newRow.gif_url } : undefined,
            image: newRow.image_url ? { url: newRow.image_url } : undefined
          };
          receiveMessage(msg);
        }
      )
      .on('broadcast', { event: 'system' }, ({ payload }) => {
        if (payload && payload.action === 'reset') {
          localStorage.setItem(RESET_KEY, String(Date.now()));
          saveMessages([]);
          renderMessages();
          showToast('🔄 El chat fue reseteado globalmente');
        }
      })
      .on('presence', { event: 'sync' }, () => {
        setConnectionStatus(true);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus(true);
          setTimeout(fetchHistory, 1000);
          if (currentNickname) enterPresence(currentNickname);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnectionStatus(false);
        }
      });

  } catch (err) {
    setConnectionStatus(false);
    console.error('Supabase init error:', err);
  }
}

function clearChatHistory(): void {
  showConfirmModal(
    '🗑️ Borrar historial',
    '¿Estás seguro? Esto solo borra los mensajes de tu dispositivo. Los demás usuarios aún verán los suyos.',
    'Borrar',
    () => {
      saveMessages([]);
      renderMessages();
    }
  );
}

function resetChatForAll(): void {
  const code = prompt('Ingresa el código de administrador para resetear el chat global:');
  if (!code) return;
  if (code !== ADMIN_CODE) {
    showToast('⚠️ Código incorrecto');
    return;
  }
  showConfirmModal(
    '🔄 Resetear chat global',
    '¿Resetear el chat para TODOS los usuarios? Esta acción borrará la base de datos de mensajes.',
    'Resetear',
    async () => {
      if (!supabase || !supabaseChannel) return;
      try {
        const { error } = await supabase
          .from('messages')
          .delete()
          .neq('id', 0); // deletes all rows since all IDs are positive (>0)

        if (error) throw error;

        await supabaseChannel.send({
          type: 'broadcast',
          event: 'system',
          payload: { action: 'reset' }
        });

        localStorage.setItem(RESET_KEY, String(Date.now()));
        saveMessages([]);
        renderMessages();
        showToast('✅ Chat reseteado para todos');
      } catch (err) {
        console.error('Error resetting chat:', err);
        showToast('⚠️ Error al resetear el chat');
      }
    }
  );
}

function toggleDropdown(): void {
  const dd = document.getElementById('chatDropdown');
  if (!dd) return;
  dd.classList.toggle('chat-hidden');
}

function closeDropdown(): void {
  const dd = document.getElementById('chatDropdown');
  if (dd) dd.classList.add('chat-hidden');
}

/* GIF picker */
let gifPickerOpen = false;

function openGifPicker(): void {
  if (gifPickerOpen) return;
  gifPickerOpen = true;
  const overlay = document.getElementById('gifPicker');
  if (!overlay) return;
  overlay.classList.remove('chat-hidden');
  fetchTrendingGifs();
}

function closeGifPicker(): void {
  gifPickerOpen = false;
  const overlay = document.getElementById('gifPicker');
  if (!overlay) return;
  overlay.classList.add('chat-hidden');
}

function fetchTrendingGifs(): void {
  const grid = document.getElementById('gifGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="gif-loading">Cargando...</div>';

  fetch(`https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_CONFIG.apiKey}&limit=30&rating=g`)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(data => renderGifGrid(data.data))
    .catch(e => { grid.innerHTML = '<div class="gif-loading">Error al cargar GIFs. Verifica conexión.</div>'; });
}

function searchGifs(query: string): void {
  const grid = document.getElementById('gifGrid');
  if (!grid) return;
  if (!query.trim()) { fetchTrendingGifs(); return; }
  grid.innerHTML = '<div class="gif-loading">Buscando...</div>';

  fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_CONFIG.apiKey}&q=${encodeURIComponent(query)}&limit=30&rating=g`)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(data => renderGifGrid(data.data))
    .catch(e => { grid.innerHTML = '<div class="gif-loading">Error al buscar GIFs. Verifica conexión.</div>'; });
}

function renderGifGrid(gifs: Array<{ images: { fixed_height: { url: string; width: string; height: string } } }>): void {
  const grid = document.getElementById('gifGrid');
  if (!grid) return;
  if (!gifs || gifs.length === 0) {
    grid.innerHTML = '<div class="gif-loading">Sin resultados</div>';
    return;
  }
  grid.innerHTML = gifs.map(g =>
    `<button class="gif-item" data-url="${escapeHtml(g.images.fixed_height.url)}" style="background-image:url(${escapeHtml(g.images.fixed_height.url)})"></button>`
  ).join('');

  grid.querySelectorAll('.gif-item').forEach(el => {
    el.addEventListener('click', () => {
      const url = (el as HTMLElement).dataset.url;
      if (url) {
        closeGifPicker();
        sendMessage(url);
      }
    });
  });
}

let imagePickerOpen = false;

function openImagePicker(): void {
  if (imagePickerOpen) return;
  imagePickerOpen = true;
  const input = document.getElementById('chatImageInput') as HTMLInputElement | null;
  if (input) {
    input.value = '';
    input.click();
  }
}

function handleImageSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) { imagePickerOpen = false; return; }

  if (!file.type.startsWith('image/')) {
    showToast('⚠️ Solo se permiten imágenes');
    input.value = '';
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast('⚠️ La imagen es muy pesada (máx 5MB)');
    input.value = '';
    return;
  }

  imagePickerOpen = true;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      imagePickerOpen = false;
      input.value = '';
      sendMessage(undefined, dataUrl);
    };
    img.src = e.target?.result as string;
  };
  reader.readAsDataURL(file);
}

function setupGifSearch(): void {
  const input = document.getElementById('gifSearch') as HTMLInputElement | null;
  if (!input) return;
  let debounce: ReturnType<typeof setTimeout>;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => searchGifs(input.value), 400);
  });
}

export function setupChat(): void {
  document.addEventListener('click', initAudio, { once: true });

  const savedNick = loadNickname();
  const savedColor = loadColor();
  const savedEmoji = loadEmoji();
  if (savedColor) currentColor = savedColor;
  if (!currentColor) currentColor = COLORS[0];
  if (savedEmoji) currentEmoji = savedEmoji;

  if (savedNick) {
    setNickname(savedNick);
  }

  renderMessages();
  connectSupabase();

  document.getElementById('chatSendBtn')?.addEventListener('click', () => sendMessage());
  document.getElementById('chatInput')?.addEventListener('keydown', handleInputKeydown);
  document.getElementById('chatNickname')?.addEventListener('keydown', handleNicknameKeydown);
  document.getElementById('chatClearBtn')?.addEventListener('click', () => { closeDropdown(); clearChatHistory(); });
  document.getElementById('chatResetBtn')?.addEventListener('click', () => { closeDropdown(); resetChatForAll(); });
  document.getElementById('chatMoreBtn')?.addEventListener('click', toggleDropdown);
  document.getElementById('chatGifBtn')?.addEventListener('click', openGifPicker);
  document.getElementById('gifCloseBtn')?.addEventListener('click', closeGifPicker);
  document.getElementById('chatImageBtn')?.addEventListener('click', openImagePicker);
  document.getElementById('chatImageInput')?.addEventListener('change', handleImageSelected);
  document.getElementById('gifPicker')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.gif-picker-inner')) closeGifPicker();
  });

  document.querySelectorAll('.chat-color-option').forEach(el => {
    el.addEventListener('click', () => {
      const c = (el as HTMLElement).dataset.color;
      if (c) selectColor(c);
    });
  });

  document.querySelectorAll('.chat-emoji-option').forEach(el => {
    el.addEventListener('click', () => {
      const e = (el as HTMLElement).dataset.emoji;
      if (e) selectEmoji(e);
    });
  });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (colorPickerOpen) {
      if (target.closest('#chatColorPicker') || target.closest('#chatColorDot')) return;
      colorPickerOpen = false;
      document.getElementById('chatColorPicker')?.classList.add('chat-hidden');
    }
    if (emojiPickerOpen) {
      if (target.closest('#chatEmojiPicker') || target.closest('#chatEmojiDot')) return;
      emojiPickerOpen = false;
      document.getElementById('chatEmojiPicker')?.classList.add('chat-hidden');
    }
    const dd = document.getElementById('chatDropdown');
    if (dd && !dd.classList.contains('chat-hidden') && !target.closest('.chat-footer-actions')) {
      dd.classList.add('chat-hidden');
    }
  });

  if (document.getElementById('chatNickname') && !currentNickname) {
    (document.getElementById('chatNickname') as HTMLInputElement)?.focus();
  }

  setupGifSearch();

  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('paste', (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) {
        e.preventDefault();
        openGifPicker();
      }
    });
  }

}
