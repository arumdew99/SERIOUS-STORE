import { supabase } from "./SupabaseClient.js";

const $ = (id) => document.getElementById(id);

let userId = null;
let messages = [];
let channel = null;
let isOpen = false;

function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function formatTime(value) {
    return new Date(value).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function setBadge(count) {
    const badge = $("chatBadge");

    if (!badge) return;

    badge.textContent = count > 9 ? "9+" : String(count);
    badge.hidden = count <= 0;
}

function render() {
    const box = $("chatMessages");

    if (!box) return;

    if (!userId) {
        box.innerHTML =
            '<p class="chat-empty">Silakan login untuk chat dengan admin.</p>';
        return;
    }

    if (messages.length === 0) {
        box.innerHTML =
            '<p class="chat-empty">Belum ada pesan. Tulis pertanyaanmu, admin akan membalas di sini.</p>';
        return;
    }

    box.innerHTML = messages.map(message => `
        <div class="chat-bubble ${message.sender_role === "admin" ? "chat-admin" : "chat-user"}">
            ${esc(message.body)}
            <time>${esc(formatTime(message.created_at))}</time>
        </div>
    `).join("");

    box.scrollTop = box.scrollHeight;
}

function addMessage(message) {
    if (messages.some(item => item.id === message.id)) return;

    messages.push(message);
    render();
}

async function loadMessages() {
    const { data, error } = await supabase
        .from("chat_messages")
        .select("id, sender_role, body, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(200);

    if (error) {
        console.error("Gagal memuat chat:", error);
        $("chatMessages").innerHTML =
            '<p class="chat-empty">Chat belum aktif: ' + esc(error.message) + "</p>";
        return;
    }

    messages = data || [];
    render();
}

async function refreshUnread() {
    const { count, error } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("sender_role", "admin")
        .eq("read_by_user", false);

    if (!error) setBadge(isOpen ? 0 : count || 0);
}

async function markRead() {
    await supabase.rpc("user_mark_chat_read");
}

function unsubscribe() {
    if (channel) {
        supabase.removeChannel(channel);
        channel = null;
    }
}

function subscribe() {
    unsubscribe();

    channel = supabase
        .channel("chat-" + userId)
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "chat_messages",
                filter: "user_id=eq." + userId
            },
            payload => {
                const message = payload.new;

                addMessage(message);

                if (message.sender_role === "admin") {
                    if (isOpen) {
                        markRead();
                    } else {
                        refreshUnread();
                    }
                }
            }
        )
        .subscribe();
}

async function setUser(id) {
    if (id === userId) return;

    unsubscribe();

    userId = id;
    messages = [];
    isOpen = false;

    if ($("chatPanel")) $("chatPanel").hidden = true;

    setBadge(0);
    render();

    if (!userId) return;

    await loadMessages();
    subscribe();
    await refreshUnread();
}

async function openChat() {
    if (!userId) {
        alert("Silakan login terlebih dahulu untuk chat dengan admin.");
        $("openLoginButton")?.click();
        return;
    }

    isOpen = true;
    $("chatPanel").hidden = false;
    setBadge(0);
    render();
    $("chatInput").focus();

    await markRead();
}

function closeChat() {
    isOpen = false;
    $("chatPanel").hidden = true;
}

$("chatToggleButton")?.addEventListener("click", () => {
    if (!$("chatPanel").hidden) {
        closeChat();
    } else {
        openChat();
    }
});

$("chatCloseButton")?.addEventListener("click", closeChat);

$("chatForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    if (!userId) return;

    const input = $("chatInput");
    const body = input.value.trim();

    if (!body) return;

    const button = $("chatSendButton");
    button.disabled = true;

    const { data, error } = await supabase
        .from("chat_messages")
        .insert({ user_id: userId, sender_role: "user", body })
        .select("id, sender_role, body, created_at")
        .single();

    button.disabled = false;

    if (error) {
        alert("Pesan gagal terkirim: " + error.message);
        return;
    }

    input.value = "";
    addMessage(data);
});

// Mengikuti status login
const { data: sessionData } = await supabase.auth.getSession();
await setUser(sessionData.session?.user?.id ?? null);

supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => setUser(session?.user?.id ?? null), 0);
});

render();