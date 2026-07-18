const ROOM_PASSWORD = "Blessing";
const VAPID_PUBLIC_KEY = "BGRGktvo0O2YvlrUaYwyPpbvCtkRiTuvqcSZCtDDdnaonT5eMPVKBg26Ef-J3u-iWr8fDk5Ce9H6277_Hq3CfWI";

const STORAGE_KEYS = {
  GUEST_ID: "simplechat_guest_id",
  DISPLAY_NAME: "simplechat_display_name",
  UNLOCKED: "simplechat_unlocked"
};

let renderedMessageIds = new Set();
let lastRenderedDateLabel = null;
let pendingImageFile = null;
let messagesChannel = null;
let typingChannel = null;
let typingStopTimer = null;
let typingBroadcastThrottle = null;
let lastQuestionIndex = -1;
let selectedRandomQuestion = "";
let questionChangesUsed = 0;

const MAX_QUESTION_CHANGES = 3;


if ("serviceWorker" in navigator) {
  window.addEventListener(
    "load",
    async () => {
      try {
        const registration =
          await navigator.serviceWorker.register(
            "/sw.js"
          );
        
        console.log(
          "Service Worker registered:",
          registration.scope
        );
        
      } catch (error) {
        console.error(
          "Service Worker registration failed:",
          error
        );
      }
    }
  );
}




const notifyBtn = document.getElementById(
  "enable-notifications-btn"
);

notifyBtn?.addEventListener(
  "click",
  enablePushNotifications
);


async function enablePushNotifications() {
  try {

    // Check notification support
    if (!("Notification" in window)) {
      showToast(
        "Notifications are not supported on this device.",
        true
      );
      return;
    }


    // Ask for permission
    let permission =
      Notification.permission;

    if (permission !== "granted") {
      permission =
        await Notification.requestPermission();
    }


    if (permission !== "granted") {
      showToast(
        "Notification permission was not granted.",
        true
      );
      return;
    }


    // Wait for Service Worker
    const registration =
      await navigator.serviceWorker.ready;


    // Check for existing push subscription
    let subscription =
      await registration.pushManager
        .getSubscription();


    // Create a new subscription
    if (!subscription) {

      subscription =
        await registration.pushManager
          .subscribe({

            userVisibleOnly: true,

            applicationServerKey:
              urlBase64ToUint8Array(
                VAPID_PUBLIC_KEY
              )

          });
    }


    console.log(
      "Push subscription:",
      subscription.toJSON()
    );


    // Save subscription to Supabase
    const { data, error } =
      await db
        .from("push_subscriptions")
        .upsert(

          {
            guest_id: getGuestId(),

            subscription:
              subscription.toJSON()
          },

          {
            onConflict: "guest_id"
          }

        )
        .select();


    if (error) {

      console.error(
        "Supabase save error:",
        error
      );

      showToast(
        "Subscription could not be saved.",
        true
      );

      return;
    }


    console.log(
      "Subscription saved:",
      data
    );


    showToast(
      "Notifications enabled successfully."
    );


  } catch (error) {

    console.error(
      "Notification setup error:",
      error
    );

    showToast(
      "Could not enable notifications.",
      true
    );

  }
}


function urlBase64ToUint8Array(
  base64String
) {

  const padding =
    "=".repeat(
      (4 -
        base64String.length % 4) %
        4
    );


  const base64 =
    (
      base64String + padding
    )
      .replace(/-/g, "+")
      .replace(/_/g, "/");


  const rawData =
    window.atob(base64);


  return Uint8Array.from(

    [...rawData].map(
      char =>
        char.charCodeAt(0)
    )

  );

}





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
  document.getElementById("chat-app").style.display =
    "flex";
  
  await loadMessageHistory();
  
  wireComposer();
  wireImageViewer();
  
  startMessagesRealtime();
  startTypingRealtime();
  
  window.addEventListener("beforeunload", () => {
    clearMyTypingStatus();
    
    if (messagesChannel) {
      db.removeChannel(messagesChannel);
    }
    
    if (typingChannel) {
      db.removeChannel(typingChannel);
    }
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


// ---------------------------------------------------------------------------
// REALTIME MESSAGES
// ---------------------------------------------------------------------------
function startMessagesRealtime() {
  if (messagesChannel) {
    db.removeChannel(messagesChannel);
  }
  
  messagesChannel = db
    .channel("threadline-messages")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      async (payload) => {
        const message = payload.new;
        
        if (!message?.id || renderedMessageIds.has(message.id)) {
          return;
        }
        
        const shouldScroll =
          message.guest_id === getGuestId() ||
          isScrolledNearBottom();
        
        await renderMessage(message, {
          scroll: shouldScroll
        });
        
        renderedMessageIds.add(message.id);
        
        showMessageNotification(message);
      }
    )
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        console.log("Messages Realtime connected");
      }
      
      if (status === "CHANNEL_ERROR") {
        console.error(
          "Messages Realtime channel error:",
          error
        );
        
      }
      
      if (status === "TIMED_OUT") {
        console.error("Messages Realtime timed out");
      }
    });
}

// ---------------------------------------------------------------------------
// REALTIME TYPING INDICATOR
// ---------------------------------------------------------------------------
const TYPING_STOP_DELAY_MS = 1800;
const TYPING_SEND_THROTTLE_MS = 700;

const typingUsers = new Map();

function startTypingRealtime() {
  if (typingChannel) {
    db.removeChannel(typingChannel);
  }
  
  typingChannel = db
    .channel("threadline-typing", {
      config: {
        broadcast: {
          self: false
        }
      }
    })
    .on(
      "broadcast",
      {
        event: "typing"
      },
      ({ payload }) => {
        handleTypingBroadcast(payload);
      }
    )
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        console.log("Typing Realtime connected");
      }
      
      if (status === "CHANNEL_ERROR") {
        console.error(
          "Typing Realtime channel error:",
          error
        );
      }
    });
}

function handleTypingBroadcast(payload) {
  if (!payload?.guestId) return;
  if (payload.guestId === getGuestId()) return;
  
  if (payload.isTyping) {
    typingUsers.set(payload.guestId, {
      name: payload.displayName || "Someone",
      expiresAt: Date.now() + 3000
    });
  } else {
    typingUsers.delete(payload.guestId);
  }
  
  updateTypingIndicator();
}

function updateTypingIndicator() {
  const now = Date.now();
  
  for (const [guestId, user] of typingUsers) {
    if (user.expiresAt <= now) {
      typingUsers.delete(guestId);
    }
  }
  
  const names = Array.from(
    typingUsers.values(),
    (user) => user.name
  );
  
  renderTypingIndicator(names);
}

async function sendTypingBroadcast(isTyping) {
  if (!typingChannel) return;
  
  try {
    await typingChannel.send({
      type: "broadcast",
      event: "typing",
      payload: {
        guestId: getGuestId(),
        displayName: getDisplayName(),
        isTyping,
        sentAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Typing broadcast failed:", error);
  }
}

function notifyTyping() {
  clearTimeout(typingStopTimer);
  
  if (!typingBroadcastThrottle) {
    sendTypingBroadcast(true);
    
    typingBroadcastThrottle = setTimeout(() => {
      typingBroadcastThrottle = null;
    }, TYPING_SEND_THROTTLE_MS);
  }
  
  typingStopTimer = setTimeout(() => {
    sendTypingBroadcast(false);
  }, TYPING_STOP_DELAY_MS);
}

function clearMyTypingStatus() {
  clearTimeout(typingStopTimer);
  clearTimeout(typingBroadcastThrottle);
  
  typingStopTimer = null;
  typingBroadcastThrottle = null;
  
  sendTypingBroadcast(false);
}

function renderTypingIndicator(names) {
  const element =
    document.getElementById("typing-indicator");
  
  if (!element) return;
  
  if (!names.length) {
    element.style.display = "none";
    element.textContent = "";
    return;
  }
  
  const uniqueNames = [...new Set(names)];
  
  if (uniqueNames.length === 1) {
    element.textContent =
      `${uniqueNames[0]} is typing…`;
  } else if (uniqueNames.length === 2) {
    element.textContent =
      `${uniqueNames[0]} and ${uniqueNames[1]} are typing…`;
  } else {
    element.textContent =
      "Several people are typing…";
  }
  
  element.style.display = "block";
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
// BROWSER NOTIFICATIONS
// ---------------------------------------------------------------------------
async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    showToast(
      "Notifications are not supported on this device.",
      true
    );
    return;
  }
  
  const permission =
    await Notification.requestPermission();
  
  if (permission !== "granted") {
    showToast(
      "Notification permission was not granted.",
      true
    );
    return;
  }
  
  await subscribeToPush();
  
  showToast(
    "Notifications enabled."
  );
}

function showMessageNotification(message) {
  if (!message) return;
  
  // Do not notify the sender about their own message.
  if (message.guest_id === getGuestId()) return;
  
  // Only notify when the user is not currently viewing the page.
  if (!document.hidden) return;
  
  if (
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  
  const senderName = message.sender_name || "New message";
  
  let notificationBody = "Sent an image";
  
  if (message.message_type === "text") {
    notificationBody =
      message.message_text?.slice(0, 120) || "New message";
  }
  
  const notification = new Notification(senderName, {
    body: notificationBody,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: `message-${message.id}`
  });
  
  notification.onclick = () => {
    window.focus();
    notification.close();
    
    const container =
      document.getElementById("messages-container");
    
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  };
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
    
    const notificationBtn =
  document.getElementById("enable-notifications-btn");

notificationBtn?.addEventListener(
  "click",
  requestNotificationPermission
);
  
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

textInput.addEventListener("blur", () => {
  clearMyTypingStatus();
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