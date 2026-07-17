// ============================================================================
// chat.js
// Powers chat.html: membership verification, message history, realtime
// messages, presence (online/offline), and image sending/viewing.
// Requires: app.js, supabase.js loaded first.
// ============================================================================

let currentRoom = null;       // { id, name, maximum_members }
let currentGuestId = null;
let messageChannel = null;
let presenceChannel = null;
let memberChannel = null;
let onlineGuestIds = new Set();
let roomMembers = [];         // cached member list
let lastRenderedDateLabel = null;
let pendingImageFile = null;

// ---------------------------------------------------------------------------
// ENTRY POINT
// ---------------------------------------------------------------------------
async function initChatPage() {
  currentGuestId = getGuestId();

  const params = new URLSearchParams(window.location.search);
  const roomIdParam = params.get("room");     // internal navigation (recent chats)
  const tokenParam = params.get("token");     // direct invite link

  showSpinnerOnly(); // Per spec: while verifying, show ONLY a spinner, nothing else.

  let roomRow = null;

  try {
    if (roomIdParam) {
      roomRow = await fetchRoomIfMember(roomIdParam);
    } else if (tokenParam) {
      roomRow = await fetchRoomByTokenIfMember(tokenParam);
    }
  } catch (err) {
    console.error("Room verification failed:", err);
    roomRow = null;
  }

  if (!roomRow) {
    // Per spec: never reveal WHY. Keep spinner running forever, no message,
    // no redirect that would leak information via URL/history either.
    return;
  }

  currentRoom = roomRow;
  touchRecentRoom(currentRoom.id);
  hideSpinnerShowChat();

  await loadRoomHeader();
  await loadMembers();
  await loadMessageHistory();
  subscribeToMessages();
  subscribeToPresence();
  subscribeToMemberChanges();
  wireComposer();
  wireHeaderAndMenu();
  wireImageViewer();

  window.addEventListener("beforeunload", cleanupRealtimeSubscriptions);
}

// ---------------------------------------------------------------------------
// MEMBERSHIP VERIFICATION (server-enforced, not just visual)
// ---------------------------------------------------------------------------

// Case 1: navigated from homepage with ?room=<id>. We rely on RLS: if the
// guest is NOT a member, this select returns zero rows regardless of what
// the client asks for.
async function fetchRoomIfMember(roomId) {
  const { data, error } = await window.db
    .from("rooms")
    .select("id, name, maximum_members, is_active")
    .eq("id", roomId)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;
  return data;
}

// Case 2: opened an invite link with ?token=<token>. First resolve the token
// to a room via the safe preview RPC, then attempt to join (join_room_safely
// is idempotent for existing members and enforces capacity atomically for
// new ones). Only on "accepted" do we proceed.
async function fetchRoomByTokenIfMember(inviteToken) {
  const profile = getProfile();

  // If we don't have a display name yet, we can't join silently — but per
  // spec the join form for NEW visitors lives on join-room.html, not here.
  // If someone lands directly on chat.html with a token and no profile,
  // send them to the proper join form (this is not a security leak: the
  // join form itself reveals nothing until join_room_safely succeeds).
  if (!profile.displayName) {
    window.location.replace(`join-room.html?token=${encodeURIComponent(inviteToken)}`);
    return null;
  }

  const { data, error } = await window.db.rpc("join_room_safely", {
    p_invite_token: inviteToken,
    p_guest_id: currentGuestId,
    p_display_name: profile.displayName,
    p_profile_image_url: profile.profileImage || null
  });

  if (error) {
    console.error("join_room_safely error:", error);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.accepted || !row.room_id) return null;

  const { data: roomData, error: roomErr } = await window.db
    .from("rooms")
    .select("id, name, maximum_members, is_active")
    .eq("id", row.room_id)
    .maybeSingle();

  if (roomErr || !roomData) return null;
  return roomData;
}

function showSpinnerOnly() {
  document.getElementById("chat-app").style.display = "none";
  document.getElementById("access-spinner").style.display = "flex";
}

function hideSpinnerShowChat() {
  document.getElementById("access-spinner").style.display = "none";
  document.getElementById("chat-app").style.display = "flex";
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
  const online = onlineGuestIds.size;
  const el = document.getElementById("member-count-line");
  if (el) el.textContent = `${total} member${total === 1 ? "" : "s"} • ${online} online`;
}

function renderMemberList() {
  const list = document.getElementById("member-list");
  if (!list) return;

  list.innerHTML = roomMembers.map(m => {
    const isOnline = onlineGuestIds.has(m.guest_id);
    const statusText = isOnline
      ? "Online"
      : `Last seen ${formatMessageTime(m.last_seen_at)}`;
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

function getMemberInfo(guestId) {
  return roomMembers.find(m => m.guest_id === guestId) || null;
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

  for (const msg of data || []) {
    await renderMessage(msg, { scroll: false });
  }
  scrollToBottom();
}

// ---------------------------------------------------------------------------
// REALTIME: messages
// ---------------------------------------------------------------------------
function subscribeToMessages() {
  messageChannel = window.db
    .channel(`room-messages-${currentRoom.id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `room_id=eq.${currentRoom.id}`
      },
      async (payload) => {
        await renderMessage(payload.new, { scroll: true });
      }
    )
    .subscribe();
}

// ---------------------------------------------------------------------------
// REALTIME: presence (online/offline)
// ---------------------------------------------------------------------------
function subscribeToPresence() {
  const profile = getProfile();

  presenceChannel = window.db.channel(`room-presence-${currentRoom.id}`, {
    config: { presence: { key: currentGuestId } }
  });

  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      onlineGuestIds = new Set(Object.keys(state));
      updateMemberCountDisplay();
      renderMemberList();
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({
          guest_id: currentGuestId,
          display_name: profile.displayName,
          online_at: new Date().toISOString()
        });
        touchLastSeen();
      }
    });
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
// REALTIME: member list changes (someone new joins while chat is open)
// ---------------------------------------------------------------------------
function subscribeToMemberChanges() {
  memberChannel = window.db
    .channel(`room-members-${currentRoom.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_members",
        filter: `room_id=eq.${currentRoom.id}`
      },
      () => {
        loadMembers();
      }
    )
    .subscribe();
}

// ---------------------------------------------------------------------------
// CLEANUP
// ---------------------------------------------------------------------------
function cleanupRealtimeSubscriptions() {
  if (messageChannel) window.db.removeChannel(messageChannel);
  if (presenceChannel) window.db.removeChannel(presenceChannel);
  if (memberChannel) window.db.removeChannel(memberChannel);
  messageChannel = null;
  presenceChannel = null;
  memberChannel = null;
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
             data-time="${escapeHtml(msg.created_at)}"
             data-image-path="${escapeHtml(msg.image_path)}" />
      </div>
    `;
  } else if (msg.message_type === "system") {
    const sysWrap = document.createElement("div");
    sysWrap.className = "system-message";
    sysWrap.textContent = msg.message_text || "";
    container.appendChild(sysWrap);
    if (scroll) scrollToBottom();
    return;
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
// SIGNED URLS for images (bucket is private)
// ---------------------------------------------------------------------------
const signedUrlCache = new Map();

async function resolveImageUrl(imagePath) {
  if (signedUrlCache.has(imagePath)) return signedUrlCache.get(imagePath);

  const { data, error } = await window.db
    .storage
    .from("chat-images")
    .createSignedUrl(imagePath, 60 * 60); // 1 hour

  if (error) {
    console.error("createSignedUrl error:", error);
    return "";
  }

  signedUrlCache.set(imagePath, data.signedUrl);
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// COMPOSER: sending text + images
// ---------------------------------------------------------------------------
function wireComposer() {
  const textInput = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");
  const imageBtn = document.getElementById("image-btn");
  const fileInput = document.getElementById("image-file-input");

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
    fileInput.value = ""; // allow re-selecting the same file later
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

  const { error } = await window.db.from("messages").insert({
    room_id: currentRoom.id,
    guest_id: currentGuestId,
    sender_name: profile.displayName,
    message_type: "text",
    message_text: text
  });

  if (error) {
    console.error("Send text error:", error);
    showToast("Message failed to send. Please try again.", true);
    input.value = text; // restore so user doesn't lose it
  }
}

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

// ---------------------------------------------------------------------------
// IMAGE SEND FLOW: preview → confirm → upload → insert message
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
    const { error: insertError } = await window.db.from("messages").insert({
      room_id: currentRoom.id,
      guest_id: currentGuestId,
      sender_name: profile.displayName,
      message_type: "image",
      image_path: path
    });

    if (insertError) throw insertError;
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
// HEADER: back button + three-dot menu
// ---------------------------------------------------------------------------
function wireHeaderAndMenu() {
  document.getElementById("back-btn").addEventListener("click", () => {
    cleanupRealtimeSubscriptions();
    window.location.href = "index.html";
  });

  const menuBtn = document.getElementById("menu-btn");
  const menuDropdown = document.getElementById("menu-dropdown");

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle("open");
  });

  document.addEventListener("click", () => menuDropdown.classList.remove("open"));

  document.getElementById("menu-view-members").addEventListener("click", () => {
    document.getElementById("member-list-panel").classList.add("open");
    menuDropdown.classList.remove("open");
  });

  document.getElementById("member-panel-close").addEventListener("click", () => {
    document.getElementById("member-list-panel").classList.remove("open");
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