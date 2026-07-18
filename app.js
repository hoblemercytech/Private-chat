const ROOM_PASSWORD = "Blessing";
const POLL_INTERVAL_MS = 2000;

const STORAGE_KEYS = {
  GUEST_ID: "simplechat_guest_id",
  DISPLAY_NAME: "simplechat_display_name",
  UNLOCKED: "simplechat_unlocked"
};

let renderedMessageIds = new Set();
let lastRenderedDateLabel = null;
let pollTimer = null;
let typingPollTimer = null;
let pendingImageFile = null;
let typingUpdateThrottle = null;
let lastQuestionIndex = -1;
let selectedRandomQuestion = "";
let questionChangesUsed = 0;

const MAX_QUESTION_CHANGES = 3;
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

function getDisplayName() {
  return localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME) || "";
}

function saveDisplayName(name) {
  localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, name.trim());
}

// ---------------------------------------------------------------------------
// HTML escaping (prevent script injection from message text/names)
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// File validation + compression
// ---------------------------------------------------------------------------
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function isAllowedImageType(file) { return ALLOWED_IMAGE_TYPES.includes(file.type); }
function isAllowedImageSize(file) { return file.size <= MAX_IMAGE_BYTES; }

async function compressImage(file, maxDimension = 1600, quality = 0.8) {
  try {
    if (file.type === "image/gif") return file;
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
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);

    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, file.type === "image/png" ? "image/png" : "image/jpeg", quality)
    );
    if (!blob) return file;
    return new File([blob], file.name, { type: blob.type });
  } catch (err) {
    console.error("Image compression failed, using original:", err);
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

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function formatMessageTime(isoString) {
  return new Date(isoString).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateSeparator(isoString) {
  const d = new Date(isoString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
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
  toast._hideTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

// ---------------------------------------------------------------------------
// PASSWORD GATE
// ---------------------------------------------------------------------------
function initGate() {
  const alreadyUnlocked = sessionStorage.getItem(STORAGE_KEYS.UNLOCKED) === "true";

  document.getElementById("gate-loading").style.display = "none";

  if (alreadyUnlocked) {
    promptForNameIfNeededThenStart();
    return;
  }

  document.getElementById("gate-password").style.display = "flex";

  const form = document.getElementById("password-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("password-input");
    const errorEl = document.getElementById("password-error");

    if (input.value === ROOM_PASSWORD) {
      sessionStorage.setItem(STORAGE_KEYS.UNLOCKED, "true");
      document.getElementById("gate-password").style.display = "none";
      promptForNameIfNeededThenStart();
    } else {
      errorEl.classList.add("show");
      input.value = "";
      input.focus();
    }
  });
}

function promptForNameIfNeededThenStart() {
  if (!getDisplayName()) {
    const name = (window.prompt("Enter your display name") || "").trim();
    saveDisplayName(name || "Guest");
  }
  startChat();
}

// ---------------------------------------------------------------------------
// CHAT
// ---------------------------------------------------------------------------
async function startChat() {
  document.getElementById("chat-app").style.display = "flex";

  await loadMessageHistory();
  wireComposer();
  wireImageViewer();
  startPolling();
  startTypingPolling();

  window.addEventListener("beforeunload", () => {
    if (pollTimer) clearInterval(pollTimer);
    if (typingPollTimer) clearInterval(typingPollTimer);
    clearMyTypingStatus();
  });
}

async function loadMessageHistory() {
  const { data, error } = await db
    .from("messages")
    .select("id, guest_id, sender_name, message_type, message_text, image_path, created_at")
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

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollForNewMessages, POLL_INTERVAL_MS);
}

async function pollForNewMessages() {
  try {
    const { data, error } = await db
      .from("messages")
      .select("id, guest_id, sender_name, message_type, message_text, image_path, created_at")
      .order("created_at", { ascending: true })
      .limit(500);

    if (error || !data) return;

    const wasAtBottom = isScrolledNearBottom();
    for (const msg of data) {
      if (!renderedMessageIds.has(msg.id)) {
        await renderMessage(msg, { scroll: false });
        renderedMessageIds.add(msg.id);
      }
    }
    if (wasAtBottom) scrollToBottom();
  } catch (err) {
    console.error("pollForNewMessages error:", err);
  }
}

function isScrolledNearBottom() {
  const container = document.getElementById("messages-container");
  const threshold = 120;
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

// ---------------------------------------------------------------------------
// RANDOM QUESTIONS
// ---------------------------------------------------------------------------


function getRandomQuestion() {
  if (
    typeof QUESTIONS === "undefined" ||
    !Array.isArray(QUESTIONS) ||
    QUESTIONS.length === 0
  ) {
    console.error("QUESTIONS is missing or empty.");
    return "";
  }
  
  let index;
  
  do {
    index = Math.floor(Math.random() * QUESTIONS.length);
  } while (
    QUESTIONS.length > 1 &&
    index === lastQuestionIndex
  );
  
  lastQuestionIndex = index;
  
  return QUESTIONS[index];
}



// ---------------------------------------------------------------------------
// TYPING INDICATOR
// ---------------------------------------------------------------------------
const TYPING_STALE_MS = 4000; // if no update in 4s, treat as "stopped typing"

function startTypingPolling() {
  if (typingPollTimer) clearInterval(typingPollTimer);
  typingPollTimer = setInterval(pollTypingStatus, 1500);
}

async function notifyTyping() {
  // Throttle writes to at most once per second while actively typing.
  if (typingUpdateThrottle) return;
  typingUpdateThrottle = setTimeout(() => { typingUpdateThrottle = null; }, 1000);

  try {
    await db.from("typing_status").upsert({
      guest_id: getGuestId(),
      display_name: getDisplayName(),
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error("notifyTyping error:", err);
  }
}

async function clearMyTypingStatus() {
  try {
    await db.from("typing_status").delete().eq("guest_id", getGuestId());
  } catch (err) {
    console.error("clearMyTypingStatus error:", err);
  }
}

async function pollTypingStatus() {
  try {
    const { data, error } = await db.from("typing_status").select("guest_id, display_name, updated_at");
    if (error || !data) return;

    const myId = getGuestId();
    const cutoff = Date.now() - TYPING_STALE_MS;
    const othersTyping = data.filter(t => t.guest_id !== myId && new Date(t.updated_at).getTime() > cutoff);

    renderTypingIndicator(othersTyping.map(t => t.display_name));
  } catch (err) {
    console.error("pollTypingStatus error:", err);
  }
}

function renderTypingIndicator(names) {
  const el = document.getElementById("typing-indicator");
  if (!names.length) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }

  let text;
  if (names.length === 1) {
    text = `${names[0]} is typing…`;
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are typing…`;
  } else {
    text = "Several people are typing…";
  }

  el.textContent = text;
  el.style.display = "block";
}

async function renderMessage(msg, { scroll }) {
  const container = document.getElementById("messages-container");
  const currentGuestId = getGuestId();

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
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

// ---------------------------------------------------------------------------
// Signed URLs for images (bucket is private)
// ---------------------------------------------------------------------------
const signedUrlCache = new Map();

async function resolveImageUrl(imagePath) {
  if (signedUrlCache.has(imagePath)) return signedUrlCache.get(imagePath);

  const { data, error } = await db.storage
    .from("chat-images")
    .createSignedUrl(imagePath, 60 * 60);

  if (error) {
    console.error("createSignedUrl error:", error);
    return "";
  }
  signedUrlCache.set(imagePath, data.signedUrl);
  return data.signedUrl;
}


function updateQuestionPreview() {
  const preview = document.getElementById("question-preview");
  const previewText = document.getElementById("question-preview-text");
  const changesLeft = document.getElementById("question-changes-left");
  const againBtn = document.getElementById("question-again-btn");
  
  const remaining = Math.max(
    0,
    MAX_QUESTION_CHANGES - questionChangesUsed
  );
  
  previewText.textContent = selectedRandomQuestion;
  changesLeft.textContent = remaining;
  
  againBtn.disabled = remaining === 0;
  againBtn.textContent =
    remaining === 0 ? "No changes left" : "Try another";
  
  preview.style.display = "block";
}

function openQuestionPreview() {
  const question = getRandomQuestion();
  
  if (!question) {
    showToast("No random questions are available.", true);
    return;
  }
  
  selectedRandomQuestion = question;
  questionChangesUsed = 0;
  
  updateQuestionPreview();
}

function chooseAnotherQuestion() {
  if (questionChangesUsed >= MAX_QUESTION_CHANGES) {
    return;
  }
  
  const question = getRandomQuestion();
  
  if (!question) return;
  
  selectedRandomQuestion = question;
  questionChangesUsed += 1;
  
  updateQuestionPreview();
}

function closeQuestionPreview() {
  selectedRandomQuestion = "";
  questionChangesUsed = 0;
  
  document.getElementById("question-preview").style.display = "none";
}

function sendPreviewedQuestion() {
  if (!selectedRandomQuestion) return;
  
  const textInput = document.getElementById("message-input");
  
  textInput.value = selectedRandomQuestion;
  
  textInput.dispatchEvent(
    new Event("input", {
      bubbles: true
    })
  );
  
  closeQuestionPreview();
  handleSendText();
}

// ---------------------------------------------------------------------------
// COMPOSER — Enter always inserts a newline; only the Send button sends.
// ---------------------------------------------------------------------------
function wireComposer() {
  const textInput = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");
  const imageBtn = document.getElementById("image-btn");
  const fileInput = document.getElementById("image-file-input");
  
  const randomQuestionBtn =
    document.getElementById("random-question-btn");
  
  const questionAgainBtn =
    document.getElementById("question-again-btn");
  
  const questionSendBtn =
    document.getElementById("question-send-btn");
  
  const questionCancelBtn =
    document.getElementById("question-cancel-btn");
  
  if (!textInput || !sendBtn || !imageBtn || !fileInput) {
    console.error("One or more composer elements are missing.");
    return;
  }
  
  textInput.addEventListener("input", () => {
    autoResizeTextarea(textInput);
    
    if (textInput.value.trim()) {
      notifyTyping();
    } else {
      clearMyTypingStatus();
    }
  });
  
  sendBtn.addEventListener("click", handleSendText);
  
  imageBtn.addEventListener("click", () => {
    fileInput.click();
  });
  
  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    
    fileInput.value = "";
    
    if (!file) return;
    
    await handleImageSelected(file);
  });
  
  randomQuestionBtn?.addEventListener(
    "click",
    openQuestionPreview
  );
  
  questionAgainBtn?.addEventListener(
    "click",
    chooseAnotherQuestion
  );
  
  questionSendBtn?.addEventListener(
    "click",
    sendPreviewedQuestion
  );
  
  questionCancelBtn?.addEventListener(
    "click",
    closeQuestionPreview
  );
}


async function handleSendText() {
  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  autoResizeTextarea(input);

  const { data, error } = await db.from("messages").insert({
    guest_id: getGuestId(),
    sender_name: getDisplayName(),
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

  clearMyTypingStatus();
}

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 140) + "px";
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
  document.getElementById("image-preview-img").src = dataUrl;
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
    const path = `${crypto.randomUUID()}.${safeExt}`;

    progressEl.querySelector(".upload-progress-text").textContent = "Uploading…";

    const { error: uploadError } = await db.storage
      .from("chat-images")
      .upload(path, compressed, { contentType: compressed.type || file.type, upsert: false });

    if (uploadError) throw uploadError;

    const { data, error: insertError } = await db.from("messages").insert({
      guest_id: getGuestId(),
      sender_name: getDisplayName(),
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
// BOOT
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", initGate);