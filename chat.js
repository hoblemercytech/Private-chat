let currentRoom = null;
let currentGuestId = null;
let roomMembers = [];
let lastRenderedDateLabel = null;
let pendingImageFile = null;
let renderedMessageIds = new Set();
let pollTimer = null;
const POLL_INTERVAL_MS = 3000;

// ---------------------------------------------------------------------------
// ENTRY POINT
// ---------------------------------------------------------------------------
async function initChatPage() {
  currentGuestId = getGuestId();

  const params = new URLSearchParams(window.location.search);
  const roomIdParam = params.get("room");
  const tokenParam = (params.get("token") || "").trim();

  showLoadingState();

  let roomRow = null;
  let errorReason = null;

  try {
    if (roomIdParam) {
      roomRow = await fetchRoomIfMember(roomIdParam);
      if (!roomRow) errorReason = "not_member";
    } else if (tokenParam) {
      const result = await fetchRoomByTokenIfMember(tokenParam);
      roomRow = result.room;
      errorReason = result.reason;
    } else {
      errorReason = "no_room_specified";
    }
  } catch (err) {
    console.error("Room verification failed:", err);
    errorReason = "error";
  }

  if (!roomRow) {
    if (errorReason) showErrorState(errorReason);
    return;
  }

  currentRoom = roomRow;
  touchRecentRoom(currentRoom.id);
  showChat();

  await loadRoomHeader();
  await loadMembers();
  await loadMessageHistory();
  wireComposer();
  wireHeaderAndMenu();
  wireImageViewer();

  startPolling();
  window.addEventListener("beforeunload", stopPolling);
}

// ---------------------------------------------------------------------------
// MEMBERSHIP VERIFICATION
// ---------------------------------------------------------------------------
async function fetchRoomIfMember(roomId) {
  const { data, error } = await window.db
    .from("rooms")
    .select("id, name, maximum_members, is_active")
    .eq("id", roomId)
    .maybeSingle();

  if (error) {
    console.error("fetchRoomIfMember error:", error);
    return null;
  }
  if (!data || !data.is_active) return null;
  return data;
}

async function fetchRoomByTokenIfMember(inviteToken) {
  const profile = getProfile();

  if (!profile.displayName) {
    window.location.replace(`join-room.html?token=${encodeURIComponent(inviteToken)}`);
    return { room: null, reason: null }; // redirecting, no error to show
  }

  const { data, error } = await window.db.rpc("join_room_safely", {
    p_invite_token: inviteToken,
    p_guest_id: currentGuestId,
    p_display_name: profile.displayName,
    p_profile_image_url: profile.profileImage || null
  });

  if (error) {
    console.error("join_room_safely error:", error);
    return { room: null, reason: "error" };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { room: null, reason: "error" };
  if (!row.accepted) return { room: null, reason: row.reason || "error" };

  const { data: roomData, error: roomErr } = await window.db
    .from("rooms")
    .select("id, name, maximum_members, is_active")
    .eq("id", row.room_id)
    .maybeSingle();

  if (roomErr || !roomData) return { room: null, reason: "error" };
  return { room: roomData, reason: null };
}

function showLoadingState() {
  document.getElementById("chat-app").style.display = "none";
  document.getElementById("error-state").style.display = "none";
  document.getElementById("loading-state").style.display = "flex";
}

function showChat() {
  document.getElementById("loading-state").style.display = "none";
  document.getElementById("error-state").style.display = "none";
  document.getElementById("chat-app").style.display = "flex";
}

function showErrorState(reason) {
  document.getElementById("loading-state").style.display = "none";
  document.getElementById("chat-app").style.display = "none";

  const messages = {
    room_full: "This room is full. Ask the host if a spot opens up.",
    invalid_room: "This invite link isn't valid. Double-check the link and try again.",
    not_member: "You're not a member of this room, or it no longer exists.",
    no_room_specified: "No room was specified. Go back and open a room from your recent chats.",
    error: "Something went wrong loading this room. Please try again."
  };

  document.getElementById("error-message").textContent =
    messages[reason] || messages.error;
  document.getElementById("error-state").style.display = "flex";
}

// ---------------------------------------------------------------------------
// HEADER + MEMBERS
// ---------------------------------------------------------------------------
async function loadRoomHeader() {
  document.getElementById("room-name").textContent = currentRoom.name;
  document.getElementById("room-icon").innerHTML = avatarHtml(currentRoom.name, null, "avatar-sm");
  updateMemberCountDisplay();
}

async function loadMembers() {
  const { data, error } = await window.db
    .from("room_members")
    .select("guest_id, display_name, profile_image_url, last_seen_at")
    .eq("room_id", currentRoom.id);

  if (error) {
    console.error("loadMembers error:", error);
    return;
  }
  roomMembers = data || [];
  updateMemberCountDisplay();
  renderMemberList();
}

function updateMemberCountDisplay() {
  const total = roomMembers.length || 0;
  const cutoff = Date.now() - 60 * 1000;
  const online = roomMembers.filter(m => new Date(m.last_seen_at).getTime() > cutoff).length;

  const el = document.getElementById("member-count-line");
  if (el) el.textContent = `${total} member${total === 1 ? "" : "s"} • ${online} online`;
}

function renderMemberList() {
  const list = document.getElementById("member-list");
  if (!list) return;

  const cutoff = Date.now() - 60 * 1000;

  list.innerHTML = roomMembers.map(m => {
    const isOnline = new Date(m.last_seen_at).getTime() > cutoff;
    const statusText = isOnline ? "Online" : `Last seen ${formatMessageTime(m.last_seen_at)}`;
    return `
      <div class="member-row">
        ${avatarHtml(m.display_name, m.profile_image_url, "avatar-sm")}
        <div class="member-row-info">
          <span class="member-row-name">${escapeHtml(m.display_name)}${m.guest_id === currentGuestId ? " (You)" : ""}</span>
          <span class="member-row-status ${isOnline ? "online" : ""}">${escapeHtml(statusText)}</span>
        </div>
      </div>
    `;
  }).join("");
}

// ---------------------------------------------------------------------------
// MESSAGE HISTORY
// ---------------------------------------------------------------------------
async function loadMessageHistory() {
  const { data, error } = await window.db
    .from("messages")
    .select("id, guest_id, sender_name, message_type, message_text, image_path, created_at")
    .eq("room_id", currentRoom.id)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("loadMessageHistory error:", error);
    showToast("Could not load messages.", true);
    return;
  }

  const container = document.getElementById("messages-container");
  container.innerHTML = "";
  lastRenderedDateLabel = null;
  renderedMessageIds.clear();

  for (const msg of data || []) {
    await renderMessage(msg, { scroll: false });
    renderedMessageIds.add(msg.id);
  }
  scrollToBottom();
}

// ---------------------------------------------------------------------------
// POLLING (replaces Realtime)
// ---------------------------------------------------------------------------
function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollForUpdates, POLL_INTERVAL_MS);
  touchLastSeen();
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function pollForUpdates() {
  if (!currentRoom) return;

  try {
    const { data: newMessages, error } = await window.db
      .from("messages")
      .select("id, guest_id, sender_name, message_type, message_text, image_path, created_at")
      .eq("room_id", currentRoom.id)
      .order("created_at", { ascending: true })
      .limit(500);

    if (!error && newMessages) {
      const wasAtBottom = isScrolledNearBottom();
      for (const msg of newMessages) {
        if (!renderedMessageIds.has(msg.id)) {
          await renderMessage(msg, { scroll: false });
          renderedMessageIds.add(msg.id);
        }
      }
      if (wasAtBottom) scrollToBottom();
    }

    await loadMembers();
    await touchLastSeen();
  } catch (err) {
    console.error("pollForUpdates error:", err);
  }
}

function isScrolledNearBottom() {
  const container = document.getElementById("messages-container");
  const threshold = 120;
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

async function touchLastSeen() {
  try {
    await window.db
      .from("room_members")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("room_id", currentRoom.id)
      .eq("guest_id", currentGuestId);
  } catch (err) {
    console.error("touchLastSeen error:", err);
  }
}

// ---------------------------------------------------------------------------
// RENDERING MESSAGES
// ---------------------------------------------------------------------------
async function renderMessage(msg, { scroll }) {
  const container = document.getElementById("messages-container");

  const dateLabel = formatDateSeparator(msg.created_at);
  if (dateLabel !== lastRenderedDateLabel) {
    const sep = document.createElement("div");
    sep.className = "date-separator";
    sep.innerHTML = `<span>${escapeHtml(dateLabel)}</span>`;
    container.appendChild(sep);
    lastRenderedDateLabel = dateLabel;
  }

  const isMine = msg.guest_id === currentGuestId;

  if (msg.message_type === "system") {
    const sysWrap = document.createElement("div");
    sysWrap.className = "system-message";
    sysWrap.textContent = msg.message_text || "";
    container.appendChild(sysWrap);
    if (scroll) scrollToBottom();
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = `message-row ${isMine ? "mine" : "theirs"}`;

  let bodyHtml = "";
  if (msg.message_type === "text") {
    bodyHtml = `<div class="bubble text-bubble">${escapeHtml(msg.message_text)}</div>`;
  } else if (msg.message_type === "image") {
    const url = await resolveImageUrl(msg.image_path);
    bodyHtml = `
      <div class="bubble image-bubble">
        <img src="${escapeHtml(url || "")}" alt="Shared image" class="chat-image"
             data-sender="${escapeHtml(msg.sender_name)}"
             data-time="${escapeHtml(msg.created_at)}" />
      </div>
    `;
  }

  wrapper.innerHTML = `
    ${!isMine ? `<div class="sender-name">${escapeHtml(msg.sender_name)}</div>` : ""}
    ${bodyHtml}
    <div class="message-time">${formatMessageTime(msg.created_at)}</div>
  `;

  container.appendChild(wrapper);
  if (scroll) scrollToBottom();
}

function scrollToBottom() {
  const container = document.getElementById("messages-container");
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// ---------------------------------------------------------------------------
// SIGNED URLS for images
// ---------------------------------------------------------------------------
const signedUrlCache = new Map();

async function resolveImageUrl(imagePath) {
  if (signedUrlCache.has(imagePath)) return signedUrlCache.get(imagePath);

  const { data, error } = await window.db
    .storage
    .from("chat-images")
    .createSignedUrl(imagePath, 60 * 60);

  if (error) {
    console.error("createSignedUrl error:", error);
    return "";
  }

  signedUrlCache.set(imagePath, data.signedUrl);
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// COMPOSER
// ---------------------------------------------------------------------------
function wireComposer() {
  const textInput = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");
  const imageBtn = document.getElementById("image-btn");
  const fileInput = document.getElementById("image-file-input");

  textInput.addEventListener("input", () => autoResizeTextarea(textInput));

  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  });

  sendBtn.addEventListener("click", handleSendText);
  imageBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    fileInput.value = "";
    if (!file) return;
    await handleImageSelected(file);
  });
}

async function handleSendText() {
  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  autoResizeTextarea(input);

  const profile = getProfile();

  const { data, error } = await window.db.from("messages").insert({
    room_id: currentRoom.id,
    guest_id: currentGuestId,
    sender_name: profile.displayName,
    message_type: "text",
    message_text: text
  }).select().single();

  if (error) {
    console.error("Send text error:", error);
    showToast("Message failed to send. Please try again.", true);
    input.value = text;
    return;
  }

  if (data && !renderedMessageIds.has(data.id)) {
    await renderMessage(data, { scroll: true });
    renderedMessageIds.add(data.id);
  }
}

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

// ---------------------------------------------------------------------------
// IMAGE SEND FLOW
// ---------------------------------------------------------------------------
async function handleImageSelected(file) {
  if (!isAllowedImageType(file)) {
    showToast("Please choose a JPG, PNG, WEBP, or GIF image.", true);
    return;
  }
  if (!isAllowedImageSize(file)) {
    showToast("This image is too large. Choose an image below 10MB.", true);
    return;
  }

  pendingImageFile = file;
  const dataUrl = await readFileAsDataUrl(file);
  openImagePreviewModal(dataUrl);
}

function openImagePreviewModal(dataUrl) {
  const modal = document.getElementById("image-preview-modal");
  const img = document.getElementById("image-preview-img");
  img.src = dataUrl;
  modal.style.display = "flex";

  document.getElementById("image-preview-cancel").onclick = () => {
    pendingImageFile = null;
    modal.style.display = "none";
  };

  document.getElementById("image-preview-send").onclick = () => {
    modal.style.display = "none";
    sendPendingImage();
  };
}

async function sendPendingImage() {
  if (!pendingImageFile) return;
  const file = pendingImageFile;
  pendingImageFile = null;

  const progressEl = document.getElementById("upload-progress");
  progressEl.style.display = "flex";
  progressEl.querySelector(".upload-progress-text").textContent = "Compressing…";

  try {
    const compressed = await compressImage(file);

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : "jpg";
    const path = `${currentRoom.id}/${crypto.randomUUID()}.${safeExt}`;

    progressEl.querySelector(".upload-progress-text").textContent = "Uploading…";

    const { error: uploadError } = await window.db.storage
      .from("chat-images")
      .upload(path, compressed, {
        contentType: compressed.type || file.type,
        upsert: false
      });

    if (uploadError) throw uploadError;

    const profile = getProfile();
    const { data, error: insertError } = await window.db.from("messages").insert({
      room_id: currentRoom.id,
      guest_id: currentGuestId,
      sender_name: profile.displayName,
      message_type: "image",
      image_path: path
    }).select().single();

    if (insertError) throw insertError;

    if (data && !renderedMessageIds.has(data.id)) {
      await renderMessage(data, { scroll: true });
      renderedMessageIds.add(data.id);
    }
  } catch (err) {
    console.error("Image send failed:", err);
    showToast("Image failed to send. Please try again.", true);
  } finally {
    progressEl.style.display = "none";
  }
}

// ---------------------------------------------------------------------------
// FULL-SCREEN IMAGE VIEWER
// ---------------------------------------------------------------------------
function wireImageViewer() {
  document.getElementById("messages-container").addEventListener("click", (e) => {
    const img = e.target.closest(".chat-image");
    if (!img) return;
    openImageViewer(img.src, img.dataset.sender, img.dataset.time);
  });

  document.getElementById("viewer-close").addEventListener("click", closeImageViewer);
  document.getElementById("image-viewer").addEventListener("click", (e) => {
    if (e.target.id === "image-viewer") closeImageViewer();
  });
}

function openImageViewer(src, sender, isoTime) {
  const viewer = document.getElementById("image-viewer");
  document.getElementById("viewer-img").src = src;
  document.getElementById("viewer-sender").textContent = sender || "";
  document.getElementById("viewer-time").textContent = isoTime ? formatMessageTime(isoTime) : "";
  document.getElementById("viewer-download").href = src;
  viewer.style.display = "flex";
}

function closeImageViewer() {
  document.getElementById("image-viewer").style.display = "none";
  document.getElementById("viewer-img").src = "";
}

// ---------------------------------------------------------------------------
// HEADER: back button + three-dot menu + member panel
// ---------------------------------------------------------------------------
function wireHeaderAndMenu() {
  document.getElementById("back-btn").addEventListener("click", () => {
    stopPolling();
    window.location.href = "index.html";
  });

  const menuBtn = document.getElementById("menu-btn");
  const menuDropdown = document.getElementById("menu-dropdown");

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle("open");
  });

  document.addEventListener("click", () => menuDropdown.classList.remove("open"));

  const memberPanel = document.getElementById("member-list-panel");

  document.getElementById("menu-view-members").addEventListener("click", () => {
    memberPanel.classList.add("open");
    menuDropdown.classList.remove("open");
  });

  function closeMemberPanel() {
    memberPanel.classList.remove("open");
  }

  document.getElementById("member-panel-close").addEventListener("click", closeMemberPanel);
  memberPanel.addEventListener("click", (e) => {
    if (e.target === memberPanel) closeMemberPanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMemberPanel();
  });

  document.getElementById("menu-copy-link").addEventListener("click", async () => {
    const recent = getRecentRooms().find(r => r.room_id === currentRoom.id);
    if (recent && recent.invite_token) {
      const link = `${window.location.origin}${window.location.pathname.replace(/chat\.html$/, "")}join-room.html?token=${encodeURIComponent(recent.invite_token)}`;
      try {
        await navigator.clipboard.writeText(link);
        showToast("Invite link copied.");
      } catch {
        showToast("Could not copy link.", true);
      }
    } else {
      showToast("Invite link not available on this device.", true);
    }
    menuDropdown.classList.remove("open");
  });
}

// ---------------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", initChatPage);