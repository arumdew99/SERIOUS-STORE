
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

let activeUserId = null;
let isSending = false;

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function formatTime(value) {
    return new Date(value).toLocaleString("id-ID", {
        dateStyle: "short",
        timeStyle: "short"
    });
}

/* =========================================
   CEK ADMIN
========================================= */

async function checkAdminChat() {
    const { data, error } = await supabase.auth.getSession();

    if (error || !data.session) {
        window.location.href = "index.html";
        return false;
    }

    const user = data.session.user;

    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    if (profileError || profile?.role !== "admin") {
        alert("Chat ini hanya dapat diakses oleh admin.");
        window.location.href = "index.html";
        return false;
    }

    return true;
}

/* =========================================
   MEMUAT DAFTAR PERCAKAPAN
========================================= */

async function loadThreads() {
    $("chatThreads").innerHTML =
        '<p class="empty-message">Memuat percakapan...</p>';

    const { data: messages, error } = await supabase
        .from("chat_messages")
        .select(`
            id,
            user_id,
            sender_role,
            body,
            read_by_admin,
            created_at
        `)
        .order("created_at", { ascending: false });

    if (error) {
        $("chatThreads").innerHTML =
            '<p class="empty-message">Gagal memuat chat: ' +
            escapeHTML(error.message) +
            "</p>";

        console.error("Gagal memuat daftar chat:", error);
        return;
    }

    if (!messages || messages.length === 0) {
        $("chatThreads").innerHTML =
            '<p class="empty-message">Belum ada percakapan.</p>';

        $("chatUnreadBadge").hidden = true;
        $("chatUnreadBadge").textContent = "0";
        return;
    }

    const threads = new Map();

    messages.forEach(message => {
        const userId = message.user_id;

        if (!threads.has(userId)) {
            threads.set(userId, {
                userId,
                lastMessage: message,
                unread: 0
            });
        }

        if (
            message.sender_role === "user" &&
            message.read_by_admin === false
        ) {
            threads.get(userId).unread++;
        }
    });

    const userIds = [...threads.keys()];

    // Ambil email pelanggan dari tabel profiles.
    // Jika tidak dapat dibaca, tampilan tetap memakai ID pelanggan.
    const profileMap = new Map();

    const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", userIds);

    if (!profileError && profiles) {
        profiles.forEach(profile => {
            profileMap.set(profile.id, profile.email);
        });
    }

    let totalUnread = 0;

    const threadHTML = [...threads.values()].map(thread => {
        totalUnread += thread.unread;

        const email =
            profileMap.get(thread.userId) ||
            "Pelanggan " + thread.userId.slice(0, 8);

        const preview = thread.lastMessage.body || "";

        return `
            <button
                type="button"
                class="chat-thread ${
                    activeUserId === thread.userId ? "active" : ""
                }"
                data-user-id="${escapeHTML(thread.userId)}">

                ${
                    thread.unread > 0
                        ? `<span class="thread-unread">${thread.unread}</span>`
                        : ""
                }

                <strong>${escapeHTML(email)}</strong>

                <small>${escapeHTML(preview.slice(0, 55))}</small>

                <small>${formatTime(thread.lastMessage.created_at)}</small>

            </button>
        `;
    }).join("");

    $("chatThreads").innerHTML = threadHTML;

    $("chatUnreadBadge").textContent = totalUnread;
    $("chatUnreadBadge").hidden = totalUnread === 0;

    document.querySelectorAll("[data-user-id]").forEach(button => {
        button.addEventListener("click", async () => {
            activeUserId = button.dataset.userId;

            document.querySelectorAll(".chat-thread").forEach(item => {
                item.classList.remove("active");
            });

            button.classList.add("active");

            const email =
                profileMap.get(activeUserId) ||
                "Pelanggan " + activeUserId.slice(0, 8);

            $("chatConversationHeader").textContent = email;
            $("adminChatForm").hidden = false;

            await loadMessages();
        });
    });
}

/* =========================================
   MEMUAT ISI PERCAKAPAN
========================================= */

async function loadMessages() {
    if (!activeUserId) return;

    $("adminChatMessages").innerHTML =
        '<p class="empty-message">Memuat pesan...</p>';

    const { data: messages, error } = await supabase
        .from("chat_messages")
        .select(`
            id,
            user_id,
            sender_role,
            body,
            read_by_admin,
            read_by_user,
            created_at
        `)
        .eq("user_id", activeUserId)
        .order("created_at", { ascending: true });

    if (error) {
        $("adminChatMessages").innerHTML =
            '<p class="empty-message">Gagal memuat pesan: ' +
            escapeHTML(error.message) +
            "</p>";

        console.error("Gagal memuat isi chat:", error);
        return;
    }

    if (!messages || messages.length === 0) {
        $("adminChatMessages").innerHTML =
            '<p class="empty-message">Belum ada pesan.</p>';
        return;
    }

    $("adminChatMessages").innerHTML = messages.map(message => {
        const fromAdmin = message.sender_role === "admin";

        return `
            <div class="admin-chat-message ${
                fromAdmin ? "chat-from-admin" : "chat-from-user"
            }">

                <p>${escapeHTML(message.body)}</p>

                <small>
                    ${fromAdmin ? "Admin" : "Pelanggan"}
                    · ${formatTime(message.created_at)}
                </small>

            </div>
        `;
    }).join("");

    $("adminChatMessages").scrollTop =
        $("adminChatMessages").scrollHeight;

    // Tandai pesan pelanggan sebagai sudah dibaca admin.
    const unreadIds = messages
        .filter(message =>
            message.sender_role === "user" &&
            message.read_by_admin === false
        )
        .map(message => message.id);

    if (unreadIds.length > 0) {
        const { error: updateError } = await supabase
            .from("chat_messages")
            .update({ read_by_admin: true })
            .in("id", unreadIds);

        if (updateError) {
            console.error("Gagal menandai pesan dibaca:", updateError);
        }

        await loadThreads();
    }
}

/* =========================================
   ADMIN MENGIRIM BALASAN
========================================= */

$("adminChatForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    if (isSending || !activeUserId) return;

    const input = $("adminChatInput");
    const button = $("adminChatSendButton");
    const body = input.value.trim();

    if (!body) return;

    isSending = true;
    button.disabled = true;
    button.textContent = "Mengirim...";

    const { error } = await supabase
        .from("chat_messages")
        .insert({
            user_id: activeUserId,
            sender_role: "admin",
            body: body,
            read_by_admin: true,
            read_by_user: false
        });

    if (error) {
        alert("Pesan gagal dikirim: " + error.message);
        console.error("Gagal mengirim balasan:", error);
    } else {
        input.value = "";
        await loadMessages();
        await loadThreads();
    }

    isSending = false;
    button.disabled = false;
    button.textContent = "Kirim Balasan";
});

/* =========================================
   REALTIME CHAT
========================================= */

function startChatRealtime() {
    supabase
        .channel("admin-chat-realtime")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "chat_messages"
            },
            async () => {
                await loadThreads();

                if (activeUserId) {
                    await loadMessages();
                }
            }
        )
        .subscribe();
}

/* =========================================
   JALANKAN CHAT ADMIN
========================================= */

const authorized = await checkAdminChat();

if (authorized) {
    await loadThreads();
    startChatRealtime();
}
