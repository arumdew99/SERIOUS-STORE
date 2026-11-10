
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient("https://uuztcgziqbeabgurwqtn.supabase.co", "sb_publishable_7wTjieqF-m0ZHYlzQXjMfw_8R6mQw8S");

const $ = (id) => document.getElementById(id);

const rupiah = (value) =>
    new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0
    }).format(Number(value) || 0);

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

const statusLabels = {
    menunggu_pembayaran: "Menunggu Pembayaran",
    menunggu_verifikasi: "Menunggu Verifikasi",
    diproses: "Diproses",
    qc: "Quality Control",
    packing: "Packing",
    dikirim: "Dikirim",
    selesai: "Selesai",
    kedaluwarsa: "Kedaluwarsa",
    dibatalkan: "Dibatalkan"
};

const refundLabels = {
    requested: "Menunggu keputusan admin",
    approved: "Disetujui",
    rejected: "Ditolak"
};

/* =========================================
   LOGOUT
========================================= */

async function logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
        alert("Logout gagal: " + error.message);
        return;
    }

    window.location.href = "index.html";
}

$("logoutButton")?.addEventListener("click", logout);
$("sidebarLogoutButton")?.addEventListener("click", logout);

/* =========================================
   CEK AKSES ADMIN
========================================= */

async function checkAdmin() {
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
        alert("Halaman ini hanya dapat diakses oleh admin.");
        window.location.href = "index.html";
        return false;
    }

    $("adminEmail").textContent = user.email;

    return true;
}

/* =========================================
   STATISTIK DASHBOARD
========================================= */

function updateStatistics(orders) {
    const list = orders || [];

    const waiting = list.filter(order => {
        const paymentStatus = String(order.payment_status || "").toLowerCase();
        const orderStatus = String(order.status || "").toLowerCase();

        return [
            "waiting_verification",
            "menunggu_verifikasi"
        ].includes(paymentStatus) ||
        orderStatus === "menunggu_verifikasi";
    });

    const processing = list.filter(order => {
        const status = String(order.status || "").toLowerCase();

        return [
            "diproses",
            "qc",
            "packing",
            "dikirim"
        ].includes(status);
    });

    const completed = list.filter(order =>
        String(order.status || "").toLowerCase() === "selesai"
    );

    $("totalOrders").textContent = list.length;
    $("waitingOrders").textContent = waiting.length;
    $("processingOrders").textContent = processing.length;
    $("completedOrders").textContent = completed.length;
}

/* =========================================
   MEMUAT DATA PESANAN
========================================= */

async function loadOrders() {
    $("message").textContent = "Memuat data pesanan...";
    $("ordersList").innerHTML = "<p>Memuat data pesanan...</p>";

    const { data: orders, error } = await supabase
        .from("orders")
        .select(`
            id,
            user_id,
            total,
            status,
            payment_status,
            payment_method,
            payment_reference,
            receipt_number,
            shipping_name,
            shipping_phone,
            shipping_address,
            shipping_city,
            shipping_postal_code,
            shipping_notes,
            refund_status,
            refund_reason,
            created_at,
            order_items (
                quantity,
                size,
                price,
                products (name)
            )
        `)
        .order("created_at", { ascending: false });

    if (error) {
        $("message").textContent =
            "Gagal memuat pesanan: " + error.message;

        $("ordersList").innerHTML =
            '<p class="empty-message">Data pesanan gagal dimuat.</p>';

        console.error("Load orders error:", error);
        return;
    }

    const list = orders || [];

    updateStatistics(list);

    $("message").textContent = "";

    if (list.length === 0) {
        $("ordersList").innerHTML =
            '<p class="empty-message">Belum ada pesanan masuk.</p>';
        return;
    }

    $("ordersList").innerHTML = list.map(order => {
        const items = (order.order_items || []).map(item => `
            <p>
                ${escapeHTML(item.products?.name || "Produk")}
                ${item.size ? "- Ukuran " + escapeHTML(item.size) : ""}
                - ${Number(item.quantity) || 0} buah
                - ${rupiah(Number(item.price) * Number(item.quantity))}
            </p>
        `).join("");

        const shipping = [
            order.shipping_address,
            order.shipping_city,
            order.shipping_postal_code
        ].filter(Boolean).join(", ");

        const paymentStatus = String(order.payment_status || "").toLowerCase();

        const needsVerification = [
            "waiting_verification",
            "menunggu_verifikasi"
        ].includes(paymentStatus) ||
        String(order.status || "").toLowerCase() === "menunggu_verifikasi";

        const canUpdateStatus =
            paymentStatus === "verified" &&
            ![
                "selesai",
                "kedaluwarsa",
                "dibatalkan"
            ].includes(String(order.status || "").toLowerCase());

        const hasRefund =
            order.refund_status &&
            order.refund_status !== "none";

        const refundPending = order.refund_status === "requested";

        const statusOptions = [
            ["diproses", "Diproses"],
            ["qc", "Quality Control"],
            ["packing", "Packing"],
            ["dikirim", "Dikirim"],
            ["selesai", "Selesai"]
        ];

        return `
            <article class="order-card">

                <h3>Pesanan #${escapeHTML(order.id)}</h3>

                <p>
                    <b>Nomor Struk:</b>
                    ${escapeHTML(order.receipt_number || "-")}
                </p>

                <p>
                    <b>Tanggal:</b>
                    ${escapeHTML(
                        new Date(order.created_at).toLocaleString("id-ID")
                    )}
                </p>

                <hr>

                <h4>Detail Produk</h4>

                ${items || "<p>Tidak ada detail produk.</p>"}

                <p><b>Total:</b> ${rupiah(order.total)}</p>

                <hr>

                <h4>Alamat Pengiriman</h4>

                <p>
                    <b>Penerima:</b>
                    ${escapeHTML(order.shipping_name || "-")}
                </p>

                <p>
                    <b>No. HP:</b>
                    ${escapeHTML(order.shipping_phone || "-")}
                </p>

                <p>
                    <b>Alamat:</b>
                    ${escapeHTML(shipping || "Belum diisi")}
                </p>

                <p>
                    <b>Catatan:</b>
                    ${escapeHTML(order.shipping_notes || "-")}
                </p>

                <hr>

                <h4>Pembayaran</h4>

                <p>
                    <b>Metode:</b>
                    ${escapeHTML(order.payment_method || "-")}
                </p>

                <p>
                    <b>Referensi:</b>
                    ${escapeHTML(order.payment_reference || "-")}
                </p>

                <p>
                    <b>Status Pembayaran:</b>
                    ${escapeHTML(order.payment_status || "-")}
                </p>

                <p>
                    <b>Status Pesanan:</b>
                    ${escapeHTML(
                        statusLabels[order.status] || order.status || "-"
                    )}
                </p>

                ${
                    needsVerification ? `
                        <div class="admin-verification">
                            <p>
                                Periksa pembayaran pelanggan sebelum menyetujui.
                            </p>

                            <button
                                class="verify-button"
                                data-verify="${escapeHTML(order.id)}"
                                data-approved="true">
                                Verifikasi Pembayaran
                            </button>

                            <button
                                class="reject-button"
                                data-verify="${escapeHTML(order.id)}"
                                data-approved="false">
                                Tolak Pembayaran
                            </button>
                        </div>
                    ` : ""
                }

                ${
                    canUpdateStatus ? `
                        <div class="order-status">

                            <select id="status-${escapeHTML(order.id)}">
                                ${statusOptions.map(([value, label]) => `
                                    <option
                                        value="${value}"
                                        ${order.status === value ? "selected" : ""}>
                                        ${label}
                                    </option>
                                `).join("")}
                            </select>

                            <button
                                class="update-button"
                                data-update="${escapeHTML(order.id)}">
                                Update Status
                            </button>

                        </div>
                    ` : ""
                }

                ${
                    hasRefund ? `
                        <hr>

                        <h4>Pengajuan Refund</h4>

                        <p>
                            <b>Status:</b>
                            ${escapeHTML(
                                refundLabels[order.refund_status] ||
                                order.refund_status
                            )}
                        </p>

                        <p>
                            <b>Alasan:</b>
                            ${escapeHTML(order.refund_reason || "-")}
                        </p>
                    ` : ""
                }

                ${
                    refundPending ? `
                        <div class="admin-verification">

                            <p>
                                Pelanggan mengajukan refund.
                                Periksa pengajuan sebelum mengambil keputusan.
                            </p>

                            <button
                                class="verify-button"
                                data-refund-admin="${escapeHTML(order.id)}"
                                data-approved="true">
                                Setujui Refund
                            </button>

                            <button
                                class="reject-button"
                                data-refund-admin="${escapeHTML(order.id)}"
                                data-approved="false">
                                Tolak Refund
                            </button>

                        </div>
                    ` : ""
                }

            </article>
        `;
    }).join("");

    attachOrderActions();
}

/* =========================================
   AKSI VERIFIKASI PEMBAYARAN
========================================= */

function attachOrderActions() {

    document.querySelectorAll("[data-verify]").forEach(button => {
        button.addEventListener("click", async () => {
            const orderId = button.dataset.verify;
            const approved = button.dataset.approved === "true";

            const confirmation = confirm(
                approved
                    ? "Setujui pembayaran pesanan ini?"
                    : "Tolak pembayaran pesanan ini?"
            );

            if (!confirmation) return;

            button.disabled = true;

            const { data, error } = await supabase.rpc(
                "admin_verify_payment",
                {
                    p_order_id: orderId,
                    p_approved: approved
                }
            );

            if (error) {
                alert("Gagal memproses pembayaran: " + error.message);
                button.disabled = false;
                return;
            }

            alert(data?.message || "Pembayaran berhasil diproses.");

            await loadOrders();
        });
    });

    /* =====================================
       AKSI REFUND
    ===================================== */

    document.querySelectorAll("[data-refund-admin]").forEach(button => {
        button.addEventListener("click", async () => {
            const orderId = button.dataset.refundAdmin;
            const approved = button.dataset.approved === "true";

            const confirmation = confirm(
                approved
                    ? "Setujui refund pesanan ini?"
                    : "Tolak pengajuan refund ini?"
            );

            if (!confirmation) return;

            button.disabled = true;

            const { data, error } = await supabase.rpc(
                "admin_process_refund",
                {
                    p_order_id: orderId,
                    p_approved: approved
                }
            );

            if (error) {
                alert("Gagal memproses refund: " + error.message);
                button.disabled = false;
                return;
            }

            alert(data?.message || "Refund berhasil diproses.");

            await loadOrders();
        });
    });

    /* =====================================
       UPDATE STATUS PESANAN
    ===================================== */

    document.querySelectorAll("[data-update]").forEach(button => {
        button.addEventListener("click", async () => {
            const orderId = button.dataset.update;
            const select = $("status-" + orderId);

            if (!select) return;

            const status = select.value;

            button.disabled = true;

            const { data, error } = await supabase.rpc(
                "admin_update_order_status",
                {
                    p_order_id: orderId,
                    p_status: status
                }
            );

            if (error) {
                alert("Gagal memperbarui status: " + error.message);
                button.disabled = false;
                return;
            }

            alert(data?.message || "Status berhasil diperbarui.");

            await loadOrders();
        });
    });
}

/* =========================================
   REFRESH DASHBOARD
========================================= */

$("refreshButton")?.addEventListener("click", loadOrders);

/* =========================================
   JALANKAN DASHBOARD
========================================= */

const authorized = await checkAdmin();

if (authorized) {
    await loadOrders();
}
