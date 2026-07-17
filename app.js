// ============================================================================
// app.js
// Shared helpers used across every page: guest identity, profile storage,
// recent chats storage, HTML escaping, and small UI utilities.
// Load this BEFORE supabase.js on every page.
// ============================================================================

const STORAGE_KEYS = {
  GUEST_ID: "chatapp_guest_id",
  DISPLAY_NAME: "chatapp_display_name",
  PROFILE_IMAGE: "chatapp_profile_image",
  RECENT_ROOMS: "chatapp_recent_rooms"
};

// ---------------------------------------------------------------------------
// Guest identity
// ---------------------------------------------------------------------------
function getGuestId() {
  let id = localStorage.getItem(STORAGE_KEYS.GUEST_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEYS.GUEST_ID, id);
  }
  return id;
}

// Ensure a guest ID exists as early as possible on every page load.
getGuestId();

// ---------------------------------------------------------------------------
// Profile (display name + optional avatar)
// ---------------------------------------------------------------------------
function getProfile() {
  return {
    displayName: localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME) || "",
    profileImage: localStorage.getItem(STORAGE_KEYS.PROFILE_IMAGE) || ""
  };
}

function saveProfile(displayName, profileImageDataUrl) {
  localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, displayName.trim());
  if (profileImageDataUrl) {
    localStorage.setItem(STORAGE_KEYS.PROFILE_IMAGE, profileImageDataUrl);
  }
}

function hasProfile() {
  return !!getProfile().displayName;
}

// ---------------------------------------------------------------------------
// Recent chats (Local Storage)
// ---------------------------------------------------------------------------
function getRecentRooms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RECENT_ROOMS);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Failed to parse recent rooms:", err);
    return [];
  }
}

function saveRecentRoom(room) {
  // room: { room_id, room_name, invite_token, last_opened_at }
  const rooms = getRecentRooms().filter(r => r.room_id !== room.room_id);
  rooms.unshift({ ...room, last_opened_at: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEYS.RECENT_ROOMS, JSON.stringify(rooms.slice(0, 50)));
}

function touchRecentRoom(roomId) {
  const rooms = getRecentRooms();
  const idx = rooms.findIndex(r => r.room_id === roomId);
  if (idx !== -1) {
    rooms[idx].last_opened_at = new Date().toISOString();
    localStorage.setItem(STORAGE_KEYS.RECENT_ROOMS, JSON.stringify(rooms));
  }
}

function removeRecentRoom(roomId) {
  const rooms = getRecentRooms().filter(r => r.room_id !== roomId);
  localStorage.setItem(STORAGE_KEYS.RECENT_ROOMS, JSON.stringify(rooms));
}



function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}



const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

function isAllowedImageType(file) {
  return ALLOWED_IMAGE_TYPES.includes(file.type);
}

function isAllowedImageSize(file) {
  return file.size <= MAX_IMAGE_BYTES;
}



async function compressImage(file, maxDimension = 1600, quality = 0.8) {
  try {
    if (file.type === "image/gif") return file; // don't recompress GIFs (breaks animation)
    
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(dataUrl);
    
    let { width, height } = img;
    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    
    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, file.type === "image/png" ? "image/png" : "image/jpeg", quality)
    );
    
    if (!blob) return file;
    return new File([blob], file.name, { type: blob.type });
  } catch (err) {
    console.error("Image compression failed, using original file:", err);
    return file;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}


function showToast(message, isError = false) {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = isError ? "app-toast error show" : "app-toast show";
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}

function formatMessageTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateSeparator(isoString) {
  const d = new Date(isoString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  
  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  
  return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function formatRelativeTime(isoString) {
  const d = new Date(isoString);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getInitial(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

// Simple deterministic color for default avatars, based on name.
function avatarColor(name) {
  const colors = ["#128C7E", "#25D366", "#075E54", "#34B7F1", "#ECE5DD", "#5B9279", "#008069"];
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function avatarHtml(name, imageUrl, sizeClass = "") {
  if (imageUrl) {
    return `<img class="avatar ${sizeClass}" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" />`;
  }
  const initial = escapeHtml(getInitial(name));
  const bg = avatarColor(name || "");
  return `<div class="avatar avatar-fallback ${sizeClass}" style="background:${bg}">${initial}</div>`;
}