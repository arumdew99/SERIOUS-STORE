import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

async function loadOrders() {
    $("message").textContent = "Memuat data pesanan...";

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
        $("message").textContent = "Gagal memuat pesanan: " + error.message;
        console.error(error);
        return;
    }

    const list = orders || [];

    $("totalOrders").textContent = list.length;

    $("waitingOrders").textContent = list.filter(order =>
        ["waiting_verification", "menunggu_verifikasi"].includes(
            order.payment_status
        )
    ).length;

    $("processingOrders").textContent = list.filter(order =>
        ["diproses", "qc", "packing", "dikirim"].includes(order.status)
    ).length;

    $("completedOrders").textContent = list.filter(
        order => order.status === "selesai"
    ).length;

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
                - ${item.quantity} buah
                - ${rupiah(Number(item.price) * Number(item.quantity))}
            </p>
        `).join("");

        const shipping = [
            order.shipping_address,
            order.shipping_city,
            order.shipping_postal_code
        ].filter(Boolean).join(", ");

        const needsVerification = [
            "waiting_verification",
            "menunggu_verifikasi"
        ].includes(order.payment_status);

        const canUpdateStatus =
            order.payment_status === "verified" &&
            !["selesai", "kedaluwarsa", "dibatalkan"].includes(order.status);

        const hasRefund =
            order.refund_status && order.refund_status !== "none";

        const refundPending = order.refund_status === "requested";

        return `
            <article class="order-card">
                <h3>Pesanan #${order.id}</h3>

                <p><b>Nomor Struk:</b>
                    ${escapeHTML(order.receipt_number || "-")}
                </p>

                <p><b>ID Pemesan:</b>
                    ${escapeHTML(order.user_id)}
                </p>

                <p><b>Tanggal:</b>
                    ${escapeHTML(new Date(order.created_at).toLocaleString("id-ID"))}
                </p>

                <hr>

                <h4>Detail Produk</h4>
                ${items || "<p>Tidak ada detail produk.</p>"}

                <p><b>Total:</b> ${rupiah(order.total)}</p>

                <hr>

                <h4>Alamat Pengiriman</h4>
                <p><b>Penerima:</b> ${escapeHTML(order.shipping_name || "-")}</p>
                <p><b>No. HP:</b> ${escapeHTML(order.shipping_phone || "-")}</p>
                <p><b>Alamat:</b> ${escapeHTML(shipping || "Belum diisi")}</p>
                <p><b>Catatan:</b> ${escapeHTML(order.shipping_notes || "-")}</p>

                <hr>

                <h4>Pembayaran</h4>
                <p><b>Metode:</b> ${escapeHTML(order.payment_method || "-")}</p>
                <p><b>Referensi:</b> ${escapeHTML(order.payment_reference || "-")}</p>
                <p><b>Status Pembayaran:</b> ${escapeHTML(order.payment_status || "-")}</p>
                <p><b>Status Pesanan:</b>
                    ${escapeHTML(statusLabels[order.status] || order.status)}
                </p>

                ${
                    needsVerification ? `
                        <div class="admin-verification">
                            <p>Periksa pembayaran pelanggan sebelum menyetujui.</p>

                            <button class="verify-button"
                                data-verify="${order.id}"
                                data-approved="true">
                                Verifikasi Pembayaran
                            </button>

                            <button class="reject-button"
                                data-verify="${order.id}"
                                data-approved="false">
                                Tolak Pembayaran
                            </button>
                        </div>
                    ` : ""
                }

                ${
                    canUpdateStatus ? `
                        <div class="order-status">
                            <select id="status-${order.id}">
                                <option value="diproses">Diproses</option>
                                <option value="qc">Quality Control</option>
                                <option value="packing">Packing</option>
                                <option value="dikirim">Dikirim</option>
                                <option value="selesai">Selesai</option>
                            </select>

                            <button class="update-button"
                                data-update="${order.id}">
                                Update Status
                            </button>
                        </div>
                    ` : ""
                }

                ${
                    hasRefund ? `
                        <hr>
                        <h4>Pengajuan Refund</h4>
                        <p><b>Status:</b>
                            <span class="refund-badge refund-${escapeHTML(order.refund_status)}">
                                ${escapeHTML(refundLabels[order.refund_status] || order.refund_status)}
                            </span>
                        </p>
                        <p><b>Alasan:</b> ${escapeHTML(order.refund_reason || "-")}</p>
                    ` : ""
                }

                ${
                    refundPending ? `
                        <div class="admin-verification">
                            <p>Pelanggan mengajukan refund. Setujui untuk membatalkan pesanan dan mengembalikan stok.</p>

                            <button class="verify-button"
                                data-refund-admin="${order.id}"
                                data-approved="true">
                                Setujui Refund
                            </button>

                            <button class="reject-button"
                                data-refund-admin="${order.id}"
                                data-approved="false">
                                Tolak Refund
                            </button>
                        </div>
                    ` : ""
                }
            </article>
        `;
    }).join("");

    document.querySelectorAll("[data-verify]").forEach(button => {
        button.addEventListener("click", async () => {
            const orderId = Number(button.dataset.verify);
            const approved = button.dataset.approved === "true";

            if (!confirm(
                approved
                    ? "Setujui pembayaran pesanan ini?"
                    : "Tolak pembayaran pesanan ini?"
            )) return;

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

    document.querySelectorAll("[data-refund-admin]").forEach(button => {
        button.addEventListener("click", async () => {
            const orderId = Number(button.dataset.refundAdmin);
            const approved = button.dataset.approved === "true";

            if (!confirm(
                approved
                    ? "Setujui refund? Pesanan akan dibatalkan dan stok dikembalikan."
                    : "Tolak pengajuan refund ini?"
            )) return;

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

    document.querySelectorAll("[data-update]").forEach(button => {
        button.addEventListener("click", async () => {
            const orderId = Number(button.dataset.update);
            const status = $(`status-${orderId}`).value;

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

$("refreshButton")?.addEventListener("click", loadOrders);

const authorized = await checkAdmin();

if (authorized) {
    await loadOrders();
}