// ============================================================================
// rooms.js
// Room creation, joining, and homepage "recent chats" logic.
// Requires: app.js, supabase.js loaded first.
// ============================================================================

// ---------------------------------------------------------------------------
// CREATE ROOM (used by create-room.html)
// ---------------------------------------------------------------------------
async function createRoom({ name, maximumMembers, displayName, profileImageDataUrl }) {
  const guestId = getGuestId();
  
  const { data, error } = await window.db.rpc("create_room_safely", {
    p_name: name.trim(),
    p_maximum_members: maximumMembers,
    p_guest_id: guestId,
    p_display_name: displayName.trim(),
    p_profile_image_url: profileImageDataUrl || null
  });
  
  if (error) {
    console.error("createRoom error:", error);
    throw new Error("Could not create the room. Please try again.");
  }
  
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.room_id) {
    throw new Error("Could not create the room. Please try again.");
  }
  
  saveProfile(displayName, profileImageDataUrl);
  
  saveRecentRoom({
    room_id: row.room_id,
    room_name: name.trim(),
    invite_token: row.invite_token
  });
  
  return {
    roomId: row.room_id,
    inviteToken: row.invite_token,
    inviteLink: buildInviteLink(row.invite_token)
  };
}

function buildInviteLink(inviteToken) {
  const base = window.location.origin + window.location.pathname.replace(/create-room\.html$/, "");
  return `${base}join-room.html?token=${encodeURIComponent(inviteToken)}`;
}

// ---------------------------------------------------------------------------
// JOIN ROOM (used by join-room.html)
// ---------------------------------------------------------------------------

// Fetches minimal, safe preview info (name + capacity) so the join form can
// show "Business Discussion — 1/2 members" without exposing anything private.
async function getRoomPreview(inviteToken) {
  const { data, error } = await window.db.rpc("get_room_preview", {
    p_invite_token: inviteToken
  });
  
  if (error) {
    console.error("getRoomPreview error:", error);
    return null;
  }
  
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.is_active) return null;
  return row;
}

async function joinRoom({ inviteToken, displayName, profileImageDataUrl }) {
  const guestId = getGuestId();
  
  const { data, error } = await window.db.rpc("join_room_safely", {
    p_invite_token: inviteToken,
    p_guest_id: guestId,
    p_display_name: displayName.trim(),
    p_profile_image_url: profileImageDataUrl || null
  });
  
  if (error) {
    console.error("joinRoom error:", error);
    return { accepted: false, reason: "error" };
  }
  
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { accepted: false, reason: "error" };
  
  if (row.accepted) {
    saveProfile(displayName, profileImageDataUrl);
  }
  
  return {
    accepted: row.accepted,
    roomId: row.room_id,
    reason: row.reason
  };
}



async function loadRecentChatsIntoDom(containerEl, emptyStateEl) {
  const rooms = getRecentRooms();
  
  if (!rooms.length) {
    containerEl.innerHTML = "";
    emptyStateEl.style.display = "flex";
    return;
  }
  emptyStateEl.style.display = "none";
  
  rooms.sort((a, b) => new Date(b.last_opened_at) - new Date(a.last_opened_at));
  
  containerEl.innerHTML = rooms.map(r => `
    <div class="chat-card" data-room-id="${escapeHtml(r.room_id)}" data-invite-token="${escapeHtml(r.invite_token)}">
      ${avatarHtml(r.room_name, null, "avatar-md")}
      <div class="chat-card-body">
        <div class="chat-card-top">
          <span class="chat-card-name">${escapeHtml(r.room_name)}</span>
          <span class="chat-card-time" data-field="time"></span>
        </div>
        <div class="chat-card-bottom">
          <span class="chat-card-last-message" data-field="last-message">Loading…</span>
          <span class="chat-card-online" data-field="online"></span>
        </div>
      </div>
    </div>
  `).join("");
  
  // Fetch last message + member/online info for each room in parallel.
  await Promise.all(rooms.map(async (r) => {
    const card = containerEl.querySelector(`[data-room-id="${cssEscape(r.room_id)}"]`);
    if (!card) return;
    
    try {
      const { data: lastMsg } = await window.db
        .from("messages")
        .select("message_type, message_text, created_at")
        .eq("room_id", r.room_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      const { count: memberCount } = await window.db
        .from("room_members")
        .select("id", { count: "exact", head: true })
        .eq("room_id", r.room_id);
      
      const timeEl = card.querySelector('[data-field="time"]');
      const lastMsgEl = card.querySelector('[data-field="last-message"]');
      const onlineEl = card.querySelector('[data-field="online"]');
      
      if (lastMsg) {
        timeEl.textContent = formatRelativeTime(lastMsg.created_at);
        lastMsgEl.textContent = lastMsg.message_type === "image" ? "📷 Photo" : (lastMsg.message_text || "");
      } else {
        timeEl.textContent = "";
        lastMsgEl.textContent = "No messages yet";
      }
      
      onlineEl.textContent = memberCount ? `${memberCount} member${memberCount === 1 ? "" : "s"}` : "";
    } catch (err) {
      console.error("Failed to load room preview for", r.room_id, err);
      const lastMsgEl = card.querySelector('[data-field="last-message"]');
      if (lastMsgEl) lastMsgEl.textContent = "";
    }
  }));
}

function cssEscape(str) {
  return String(str).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}