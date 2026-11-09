import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

// =====================================================
// 1. DATA APLIKASI
// =====================================================

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

let currentUser = null;
let currentProfile = null;
let products = [];
let cart = [];
let shippingData = null;
let pendingOrderId = null;
let pendingOrder = null;
let holdTimer = null;
let currentTotal = 0;
let isRegisterMode = false;
let isProcessingOrder = false;

let paymentCodes = {};
let currentPaymentCode = null;
let currentPaymentProvider = null;

// =====================================================
// 2. PANDUAN UKURAN PAKAIAN (per jenis produk)
// =====================================================

// Angka di bawah hanya CONTOH. Ganti dengan ukuran asli produkmu.
// Jenis produk dideteksi dari nama produk (lihat getProductCategory).

const SIZE_GUIDES = {
    kaos: {
        title: "Kaos / Atasan",
        rows: [
            ["Lingkar Dada (LD)", { S: "96 cm", M: "100 cm", L: "106 cm", XL: "112 cm" }],
            ["Panjang Baju", { S: "65 cm", M: "68 cm", L: "71 cm", XL: "74 cm" }],
            ["Panjang Lengan", { S: "19 cm", M: "20 cm", L: "21 cm", XL: "22 cm" }]
        ]
    },

    lengan_panjang: {
        title: "Hoodie / Kemeja / Jaket",
        rows: [
            ["Lingkar Dada (LD)", { S: "100 cm", M: "104 cm", L: "110 cm", XL: "116 cm" }],
            ["Panjang Baju", { S: "66 cm", M: "69 cm", L: "72 cm", XL: "75 cm" }],
            ["Panjang Lengan", { S: "58 cm", M: "60 cm", L: "62 cm", XL: "63 cm" }]
        ]
    },

    sepatu: {
        title: "Sepatu",
        sizes: ["38", "39", "40", "41", "42", "43", "44"],
        rows: [
            ["Panjang Telapak", {
                "38": "24,0 cm", "39": "24,6 cm", "40": "25,3 cm", "41": "26,0 cm",
                "42": "26,6 cm", "43": "27,3 cm", "44": "28,0 cm"
            }],
            ["Perkiraan Ukuran UK", {
                "38": "5", "39": "6", "40": "6,5", "41": "7,5",
                "42": "8", "43": "9", "44": "9,5"
            }]
        ]
    },

    celana: {
        title: "Celana",
        rows: [
            ["Lingkar Pinggang", { S: "70 cm", M: "74 cm", L: "78 cm", XL: "82 cm" }],
            ["Lingkar Pinggul", { S: "96 cm", M: "100 cm", L: "104 cm", XL: "108 cm" }],
            ["Panjang Celana", { S: "98 cm", M: "100 cm", L: "102 cm", XL: "104 cm" }],
            ["Lebar Paha", { S: "27 cm", M: "28 cm", L: "29 cm", XL: "30 cm" }]
        ]
    }
};

// Menentukan jenis produk. Jika nanti tabel products punya kolom
// "category", nilainya (kaos / lengan_panjang / celana) dipakai lebih dulu.
function getProductCategory(product) {
    if (product?.category && SIZE_GUIDES[product.category]) {
        return product.category;
    }

    const name = String(product?.name || "").toLowerCase();

    if (/sepatu|shoe|sneaker|sandal|sendal|boots?\b|loafer|heels?\b|slip.?on/.test(name)) {
        return "sepatu";
    }

    if (/celana|pants|jeans|jean|chino|cargo|trouser|short|rok|skirt/.test(name)) {
        return "celana";
    }

    if (/t-shirt|tshirt|kaos|tee\b/.test(name)) {
        return "kaos";
    }

    if (/hoodie|jaket|jacket|sweater|crewneck|kemeja|shirt|blouse|cardigan|flannel/.test(name)) {
        return "lengan_panjang";
    }

    return "kaos";
}

// Daftar ukuran yang bisa dipilih untuk sebuah produk
function getSizeOptions(product) {
    const guide = SIZE_GUIDES[getProductCategory(product)];

    return guide?.sizes || ["S", "M", "L", "XL"];
}

function renderSizeGuide(size, productId) {
    const container = $("sizeGuide-" + productId);

    if (!container) return;

    const product = products.find(
        item => String(item.id) === String(productId)
    );

    const guide = SIZE_GUIDES[getProductCategory(product)];

    if (!size || !guide) {
        container.hidden = true;
        container.innerHTML = "";
        return;
    }

    container.hidden = false;

    container.innerHTML = `
        <div class="size-guide-card">
            <h4>Detail Ukuran ${escapeHTML(size)} - ${escapeHTML(guide.title)}</h4>

            ${guide.rows.map(([label, values]) => `
                <div class="size-guide-row">
                    <span>${escapeHTML(label)}</span>
                    <strong>${escapeHTML(values[size] || "-")}</strong>
                </div>
            `).join("")}
        </div>
    `;
}

// =====================================================
// 3. PILIHAN METODE PEMBAYARAN
// =====================================================

const PAYMENT_OPTIONS = {
    "Transfer Bank": {
        providerLabel: "Pilih Bank",
        codeTitle: "Nomor Virtual Account",
        providers: [
            { id: "BCA", name: "BCA", prefix: "39358" },
            { id: "BNI", name: "BNI", prefix: "8808" },
            { id: "BRI", name: "BRI", prefix: "26215" },
            { id: "Mandiri", name: "Mandiri", prefix: "88608" },
            { id: "BSI", name: "BSI", prefix: "9002" }
        ]
    },

    "E-Wallet": {
        providerLabel: "Pilih E-Wallet",
        codeTitle: "Nomor Tagihan",
        providers: [
            { id: "GoPay", name: "GoPay", prefix: "GP" },
            { id: "OVO", name: "OVO", prefix: "OV" },
            { id: "DANA", name: "DANA", prefix: "DN" },
            { id: "ShopeePay", name: "ShopeePay", prefix: "SP" },
            { id: "LinkAja", name: "LinkAja", prefix: "LA" }
        ]
    }
};

const modalIds = [
    "authModal",
    "cartModal",
    "checkoutModal",
    "paymentModal",
    "historyModal",
    "receiptModal"
];

const orderStatusLabels = {
    menunggu_pembayaran: "Menunggu Pembayaran",
    menunggu_verifikasi: "Menunggu Verifikasi Admin",
    waiting_verification: "Menunggu Verifikasi Admin",
    diproses: "Pesanan Diproses",
    qc: "Quality Control",
    packing: "Sedang Dikemas",
    dikirim: "Pesanan Dikirim",
    selesai: "Pesanan Selesai",
    kedaluwarsa: "Pesanan Kedaluwarsa",
    dibatalkan: "Pesanan Dibatalkan"
};

// =====================================================
// 4. MODAL
// =====================================================

function hideAllModals() {
    modalIds.forEach(id => {
        const modal = $(id);

        if (id === "paymentModal" && modal && !modal.hidden && pendingOrder) {
            releasePendingOrder();
        }

        if (modal) {
            modal.hidden = true;
            modal.style.display = "none";
        }
    });
}

function showModal(id) {
    hideAllModals();

    const modal = $(id);

    if (!modal) {
        console.error("Modal tidak ditemukan:", id);
        return;
    }

    modal.hidden = false;
    modal.style.display = "flex";
}

function hideModal(id) {
    const modal = $(id);

    if (!modal) return;

    if (id === "paymentModal" && pendingOrder) {
        releasePendingOrder();
    }

    modal.hidden = true;
    modal.style.display = "none";
}

modalIds.forEach(id => {
    const modal = $(id);

    if (!modal) return;

    modal.addEventListener("click", event => {
        if (event.target === modal) {
            hideModal(id);
        }
    });
});

// Semua tombol X menutup modal terdekat
document.addEventListener("click", event => {
    const closeButton = event.target.closest(".close-button");

    if (!closeButton) return;

    const modal = closeButton.closest(".modal");

    if (modal) {
        hideModal(modal.id);
    }
});

// Tombol Esc menutup semua modal
document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        modalIds.forEach(hideModal);
    }
});

// =====================================================
// 5. LOGIN DAN REGISTER
// =====================================================

function openLogin() {
    isRegisterMode = false;
    updateAuthForm();
    showModal("authModal");
}

function updateAuthForm() {
    $("authTitle").textContent = isRegisterMode ? "Daftar Akun" : "Login";
    $("authSubmitButton").textContent = isRegisterMode ? "Daftar" : "Login";
    $("registerNameField").hidden = !isRegisterMode;
    $("authSwitchText").textContent = isRegisterMode
        ? "Sudah punya akun?"
        : "Belum punya akun?";
    $("authSwitchButton").textContent = isRegisterMode ? "Login" : "Daftar";
    $("authMessage").textContent = "";
}

$("openLoginButton")?.addEventListener("click", openLogin);

$("authSwitchButton")?.addEventListener("click", () => {
    isRegisterMode = !isRegisterMode;
    updateAuthForm();
});

$("authForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const name = $("registerName").value.trim();
    const button = $("authSubmitButton");

    button.disabled = true;
    $("authMessage").textContent = "Sedang memproses...";

    try {
        if (isRegisterMode) {
            if (!name) {
                throw new Error("Nama lengkap harus diisi.");
            }

            if (password.length < 6) {
                throw new Error("Password minimal 6 karakter.");
            }

            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: { data: { full_name: name } }
            });

            if (error) throw error;

            if (data.session) {
                await refreshSession();
                hideModal("authModal");
                alert("Pendaftaran berhasil.");
            } else {
                isRegisterMode = false;
                updateAuthForm();
                alert("Pendaftaran berhasil. Silakan login.");
            }

        } else {
            const { data, error } =
                await supabase.auth.signInWithPassword({ email, password });

            if (error) throw error;

            currentUser = data.user;

            await refreshSession();
            hideModal("authModal");

            if (currentProfile?.role === "admin") {
                window.location.href = "admin.html";
                return;
            }

            alert("Login berhasil. Selamat berbelanja!");
        }

    } catch (error) {
        $("authMessage").textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

// =====================================================
// 6. SESSION DAN PROFIL
// =====================================================

async function refreshSession() {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
        console.error("Session error:", error);
        return;
    }

    currentUser = data.session?.user || null;

    if (!currentUser) {
        currentProfile = null;
        updateProfileDisplay();
        return;
    }

    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .maybeSingle();

    if (profileError) {
        console.error("Gagal mengambil profil:", profileError);
    }

    currentProfile = profile || { role: "user" };

    updateProfileDisplay();
}

function updateProfileDisplay() {
    const loggedIn = Boolean(currentUser);

    $("loginButton").hidden = loggedIn;
    $("userProfile").hidden = !loggedIn;

    const adminLink = $("adminDashboardLink");

    if (adminLink) {
        adminLink.hidden = !loggedIn || currentProfile?.role !== "admin";
    }

    if (!loggedIn) return;

    const name =
        currentProfile?.full_name ||
        currentUser.user_metadata?.full_name ||
        currentUser.email.split("@")[0];

    const initial = name.charAt(0).toUpperCase();

    $("userName").textContent = name;
    $("profileName").textContent = name;
    $("profileEmail").textContent = currentUser.email;
    $("userInitial").textContent = initial;
    $("userInitialLarge").textContent = initial;

    $("profileRole").textContent =
        currentProfile?.role === "admin" ? "Administrator" : "Pelanggan";
}

// =====================================================
// 7. DROPDOWN DAN LOGOUT
// =====================================================

$("profileButton")?.addEventListener("click", () => {
    const dropdown = $("profileDropdown");
    dropdown.hidden = !dropdown.hidden;
});

document.addEventListener("click", event => {
    const profile = $("userProfile");
    const dropdown = $("profileDropdown");

    if (profile && dropdown && !profile.contains(event.target)) {
        dropdown.hidden = true;
    }
});

$("userLogoutButton")?.addEventListener("click", async () => {
    if (!confirm("Apakah kamu yakin ingin logout?")) return;

    const { error } = await supabase.auth.signOut();

    if (error) {
        alert("Logout gagal: " + error.message);
        return;
    }

    window.location.href = "index.html";
});

// =====================================================
// 8. MEMUAT PRODUK DAN PANDUAN UKURAN
// =====================================================

async function loadProducts() {
    $("productList").innerHTML = "<p>Memuat produk...</p>";

    const { data, error } = await supabase
        .from("products_public")
        .select("id, name, description, price, image_url, in_stock, created_at")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Gagal memuat produk:", error);

        $("productList").innerHTML =
            "<p>Gagal memuat produk: " + escapeHTML(error.message) + "</p>";

        return;
    }

    products = data || [];

    if (products.length === 0) {
        $("productList").innerHTML = "<p>Belum ada produk tersedia.</p>";
        return;
    }

    $("productList").innerHTML = products.map(product => {
        const image = product.image_url || "";
        const soldOut = !product.in_stock;
        const productId = escapeHTML(product.id);

        return `
            <article class="product-card">

                ${
                    image
                    ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(product.name)}">`
                    : `<div class="product-placeholder">SERIOUS STORE</div>`
                }

                <div class="product-info">
                    <h3>${escapeHTML(product.name)}</h3>

                    <p>${escapeHTML(product.description || "")}</p>

                    <strong>${rupiah(product.price)}</strong>

                    <label for="size-${productId}">Pilih Ukuran</label>

                    <select
                        id="size-${productId}"
                        class="product-size"
                        ${soldOut ? "disabled" : ""}
                    >
                        <option value="">Pilih ukuran</option>
                        ${getSizeOptions(product).map(size => `
                            <option value="${escapeHTML(size)}">${escapeHTML(size)}</option>
                        `).join("")}
                    </select>

                    <div id="sizeGuide-${productId}" class="size-guide" hidden></div>

                    <button
                        class="primary-button"
                        data-product="${productId}"
                        ${soldOut ? "disabled" : ""}
                    >
                        ${soldOut ? "Habis" : "Tambah ke Keranjang"}
                    </button>
                </div>
            </article>
        `;
    }).join("");

    document.querySelectorAll(".product-size").forEach(select => {
        select.addEventListener("change", () => {
            const productId = select.id.replace("size-", "");
            renderSizeGuide(select.value, productId);
        });
    });

    document.querySelectorAll("[data-product]").forEach(button => {
        button.addEventListener("click", () => {
            const product = products.find(
                item => String(item.id) === button.dataset.product
            );

            if (!product) return;

            const sizeSelect = $("size-" + button.dataset.product);
            const size = sizeSelect?.value;

            if (!size) {
                alert("Silakan pilih ukuran produk terlebih dahulu.");
                return;
            }

            addToCart(product, size);
        });
    });
}

// =====================================================
// 9. KERANJANG BELANJA
// =====================================================

function addToCart(product, size) {
    if (!product.in_stock) {
        alert("Maaf, produk ini sudah habis.");
        return;
    }

    const existing = cart.find(item =>
        String(item.product_id) === String(product.id) &&
        item.size === size
    );

    if (existing) {
        existing.quantity++;
    } else {
        cart.push({
            product_id: product.id,
            name: product.name,
            price: Number(product.price),
            quantity: 1,
            size
        });
    }

    updateCartDisplay();

    alert("Produk berhasil ditambahkan ke keranjang.");
}

function updateCartDisplay() {
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);

    currentTotal = cart.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
    );

    $("cartCount").textContent = count;
    $("cartTotal").textContent = rupiah(currentTotal);

    if (cart.length === 0) {
        $("cartItems").innerHTML = "<p>Keranjang masih kosong.</p>";
        $("checkoutButton").disabled = true;
        return;
    }

    $("checkoutButton").disabled = false;

    $("cartItems").innerHTML = cart.map(item => `
        <div class="cart-item">
            <div>
                <strong>${escapeHTML(item.name)}</strong>
                <p>Ukuran: ${escapeHTML(item.size)}</p>
                <p>${rupiah(item.price)} x ${item.quantity}</p>
            </div>

            <div class="cart-actions">
                <button data-minus="${escapeHTML(item.product_id)}"
                    data-size="${escapeHTML(item.size)}">-</button>

                <span>${item.quantity}</span>

                <button data-plus="${escapeHTML(item.product_id)}"
                    data-size="${escapeHTML(item.size)}">+</button>

                <button data-remove="${escapeHTML(item.product_id)}"
                    data-size="${escapeHTML(item.size)}">Hapus</button>
            </div>
        </div>
    `).join("");

    document.querySelectorAll("[data-minus]").forEach(button => {
        button.addEventListener("click", () => {
            changeCartQuantity(button.dataset.minus, button.dataset.size, -1);
        });
    });

    document.querySelectorAll("[data-plus]").forEach(button => {
        button.addEventListener("click", () => {
            changeCartQuantity(button.dataset.plus, button.dataset.size, 1);
        });
    });

    document.querySelectorAll("[data-remove]").forEach(button => {
        button.addEventListener("click", () => {
            cart = cart.filter(item =>
                !(
                    String(item.product_id) === button.dataset.remove &&
                    item.size === button.dataset.size
                )
            );

            updateCartDisplay();
        });
    });
}

function changeCartQuantity(productId, size, change) {
    const item = cart.find(product =>
        String(product.product_id) === String(productId) &&
        product.size === size
    );

    if (!item) return;

    const newQuantity = item.quantity + change;

    if (newQuantity <= 0) {
        cart = cart.filter(product =>
            !(
                String(product.product_id) === String(productId) &&
                product.size === size
            )
        );
    } else {
        item.quantity = newQuantity;
    }

    updateCartDisplay();
}

$("cartButton")?.addEventListener("click", () => {
    updateCartDisplay();
    showModal("cartModal");
});

// =====================================================
// 10. CHECKOUT DAN ALAMAT PENGIRIMAN
// =====================================================

$("checkoutButton")?.addEventListener("click", () => {
    if (!currentUser) {
        hideModal("cartModal");
        openLogin();
        alert("Silakan login terlebih dahulu.");
        return;
    }

    if (cart.length === 0) {
        alert("Keranjang masih kosong.");
        return;
    }

    showModal("checkoutModal");
});

$("shippingForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    if (!currentUser) {
        alert("Silakan login terlebih dahulu.");
        return;
    }

    if (cart.length === 0) {
        alert("Keranjang belanja kosong.");
        return;
    }

    shippingData = {
        shipping_name: $("shippingName").value.trim(),
        shipping_phone: $("shippingPhone").value.trim(),
        shipping_address: $("shippingAddress").value.trim(),
        shipping_city: $("shippingCity").value.trim(),
        shipping_postal_code: $("shippingPostalCode").value.trim(),
        shipping_notes: $("shippingNotes").value.trim()
    };

    const requiredFields = [
        shippingData.shipping_name,
        shippingData.shipping_phone,
        shippingData.shipping_address,
        shippingData.shipping_city,
        shippingData.shipping_postal_code
    ];

    if (requiredFields.some(value => !value)) {
        alert("Lengkapi data alamat pengiriman.");
        return;
    }

    const submitButton =
        $("shippingForm").querySelector("button[type='submit']");

    if (pendingOrder) {
        await releasePendingOrder();
    }

    submitButton.disabled = true;
    submitButton.textContent = "Menyiapkan pesanan...";

    try {
        pendingOrder = await createNewOrder();
        pendingOrderId = pendingOrder.id;
    } catch (error) {
        console.error("Gagal menyiapkan pesanan:", error);
        alert("Gagal menyiapkan pesanan: " + error.message);
        await loadProducts();
        return;
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Lanjut ke Pembayaran";
    }

    $("paymentTotal").textContent =
        rupiah(pendingOrder.total ?? currentTotal);
    $("paymentMethod").value = "";
    $("paymentReference").value = "";
    $("paymentMessage").textContent = "";

    paymentCodes = {};
    currentPaymentCode = null;
    currentPaymentProvider = null;

    updatePaymentUI();

    hideModal("checkoutModal");
    showModal("paymentModal");
    startHoldTimer(pendingOrder.holdSeconds);
});

// =====================================================
// 11. METODE PEMBAYARAN
// =====================================================

function randomDigits(length) {
    const bytes = new Uint32Array(length);
    crypto.getRandomValues(bytes);

    return Array.from(bytes, number => number % 10).join("");
}

function getPaymentCode(method, provider) {
    const key = method + "|" + provider.id;

    if (!paymentCodes[key]) {
        paymentCodes[key] = method === "Transfer Bank"
            ? provider.prefix + randomDigits(11)
            : provider.prefix +
              Date.now().toString().slice(-8) +
              randomDigits(4);
    }

    return paymentCodes[key];
}

function showPaymentCode() {
    const method = $("paymentMethod").value;
    const cfg = PAYMENT_OPTIONS[method];
    const box = $("paymentCodeBox");

    if (!cfg || !box) return;

    const provider = cfg.providers.find(
        item => item.id === $("paymentProvider").value
    );

    if (!provider) {
        box.hidden = true;
        currentPaymentCode = null;
        currentPaymentProvider = null;
        return;
    }

    currentPaymentProvider = provider.name;
    currentPaymentCode = getPaymentCode(method, provider);

    $("paymentCodeTitle").textContent =
        method === "Transfer Bank"
            ? provider.name + " Virtual Account"
            : provider.name;

    $("paymentCodeLabel").textContent = cfg.codeTitle;
    $("paymentCode").value = currentPaymentCode;

    box.hidden = false;
}

function updatePaymentUI() {
    const method = $("paymentMethod").value;
    const cfg = PAYMENT_OPTIONS[method];

    $("qrisContainer").hidden = method !== "QRIS";
    $("transferInfo").hidden = method !== "Transfer Bank";
    $("ewalletInfo").hidden = method !== "E-Wallet";

    const providerField = $("providerField");
    const codeBox = $("paymentCodeBox");

    if (!cfg) {
        providerField.hidden = true;
        codeBox.hidden = true;

        currentPaymentCode = null;
        currentPaymentProvider = null;

        return;
    }

    $("providerLabel").textContent = cfg.providerLabel;

    $("paymentProvider").innerHTML = `
        <option value="">Pilih penyedia pembayaran</option>
        ${cfg.providers.map(item => `
            <option value="${escapeHTML(item.id)}">
                ${escapeHTML(item.name)}
            </option>
        `).join("")}
    `;

    providerField.hidden = false;
    codeBox.hidden = true;

    currentPaymentCode = null;
    currentPaymentProvider = null;
}

$("paymentMethod")?.addEventListener("change", updatePaymentUI);

$("paymentProvider")?.addEventListener("change", showPaymentCode);

$("copyCodeButton")?.addEventListener("click", async () => {
    if (!currentPaymentCode) return;

    try {
        await navigator.clipboard.writeText(currentPaymentCode);
        $("copyCodeButton").textContent = "Tersalin";
    } catch {
        $("paymentCode").select();
        document.execCommand("copy");
        $("copyCodeButton").textContent = "Tersalin";
    }

    setTimeout(() => {
        $("copyCodeButton").textContent = "Salin";
    }, 1500);
});

// =====================================================
// 11B. HOLD PEMBAYARAN 15 MENIT
// =====================================================

function stopHoldTimer() {
    if (holdTimer) {
        clearInterval(holdTimer);
        holdTimer = null;
    }

    const el = $("paymentCountdown");
    if (el) el.textContent = "";
}

function startHoldTimer(seconds) {
    stopHoldTimer();

    const deadline = Date.now() + seconds * 1000;
    const el = $("paymentCountdown");

    const tick = () => {
        const left = deadline - Date.now();

        if (left <= 0) {
            stopHoldTimer();
            handleHoldExpired();
            return;
        }

        const minutes = Math.floor(left / 60000);
        const secs = Math.floor((left % 60000) / 1000);

        el.textContent =
            "Selesaikan pembayaran dalam " +
            String(minutes).padStart(2, "0") + ":" +
            String(secs).padStart(2, "0");
    };

    tick();
    holdTimer = setInterval(tick, 1000);
}

function handleHoldExpired() {
    alert(
        "Waktu pembayaran 15 menit sudah habis. " +
        "Pesanan dibatalkan, silakan checkout ulang."
    );

    hideModal("paymentModal");
}

async function releasePendingOrder() {
    const order = pendingOrder;

    pendingOrder = null;
    pendingOrderId = null;
    stopHoldTimer();

    if (!order) return;

    const { error } = await supabase.rpc("cancel_order", {
        p_order_id: order.id,
        p_reason: "Dibatalkan sebelum pembayaran"
    });

    if (error) {
        console.error("Gagal melepas pesanan:", error);
    }

    await loadProducts();
}

// =====================================================
// 12. MEMBUAT PESANAN
// =====================================================

async function createNewOrder() {
    const items = cart.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
        size: item.size
    }));

    const { data, error } = await supabase.rpc("create_order", {
        p_items: items
    });

    if (error) throw error;

    const order = Array.isArray(data) ? data[0] : data;

    if (!order?.order_id && !order?.id) {
        throw new Error(
            "Nomor pesanan tidak ditemukan. Periksa fungsi create_order di Supabase."
        );
    }

    const orderId = order.order_id || order.id;

    const { error: shippingError } = await supabase
        .from("orders")
        .update(shippingData)
        .eq("id", orderId)
        .eq("user_id", currentUser.id);

    if (shippingError) {
        await supabase.rpc("cancel_order", {
            p_order_id: orderId,
            p_reason: "Gagal menyimpan alamat"
        });

        throw new Error(
            "Pesanan sudah dibuat, tetapi alamat gagal disimpan: " +
            shippingError.message
        );
    }

    return {
        id: orderId,
        total: order.total,
        receipt: order.receipt_number || null,
        holdSeconds: order.hold_seconds || 900
    };
}

// =====================================================
// 13. KONFIRMASI PEMBAYARAN
// =====================================================

$("confirmPaymentButton")?.addEventListener("click", async () => {
    if (isProcessingOrder) return;

    const method = $("paymentMethod").value;

    if (!method) {
        alert("Pilih metode pembayaran terlebih dahulu.");
        return;
    }

    const needsProvider = Boolean(PAYMENT_OPTIONS[method]);

    if (needsProvider && (!currentPaymentProvider || !currentPaymentCode)) {
        alert("Pilih bank / e-wallet terlebih dahulu.");
        return;
    }

    if (!currentUser || !shippingData || cart.length === 0) {
        alert("Data checkout tidak lengkap.");
        return;
    }

    if (method === "QRIS") {
        currentPaymentCode = "QRIS DEMO";
    }

    const button = $("confirmPaymentButton");

    isProcessingOrder = true;
    button.disabled = true;
    button.textContent = "Memproses...";

    try {
        const order = pendingOrder;

        if (!order) {
            throw new Error(
                "Pesanan belum disiapkan atau sudah kedaluwarsa. " +
                "Silakan ulangi checkout."
            );
        }

        pendingOrderId = order.id;

        const paymentReference = $("paymentReference").value.trim();

        const { data: paymentData, error: paymentError } =
            await supabase.rpc("confirm_order_payment", {
                p_order_id: pendingOrderId,
                p_payment_method: method,
                p_payment_reference: paymentReference || null
            });

        if (paymentError) {
            throw new Error(
                "Konfirmasi pembayaran gagal: " + paymentError.message
            );
        }

        if (!paymentData || !paymentData.success) {
            throw new Error(
                paymentData?.message || "Pembayaran gagal dikonfirmasi."
            );
        }

        stopHoldTimer();
        pendingOrder = null;
        pendingOrderId = null;

        showReceipt({
            orderId: order.id,
            receiptNumber: paymentData?.receipt_number || order.receipt || "-",
            name: shippingData.shipping_name,
            method,
            provider: needsProvider ? currentPaymentProvider : null,
            code: currentPaymentCode,
            codeLabel: needsProvider
                ? PAYMENT_OPTIONS[method].codeTitle
                : "Pembayaran QRIS Demo",
            total: order.total ?? currentTotal
        });

        cart = [];
        shippingData = null;
        paymentCodes = {};
        currentPaymentCode = null;
        currentPaymentProvider = null;

        updateCartDisplay();
        await loadProducts();

    } catch (error) {
        console.error("Checkout error:", error);

        alert("Pesanan gagal diproses: " + error.message);

        if (/waktu pembayaran/i.test(error.message)) {
            stopHoldTimer();
            pendingOrder = null;
            pendingOrderId = null;
            hideModal("paymentModal");
        }

        await loadProducts();

    } finally {
        isProcessingOrder = false;
        button.disabled = false;
        button.textContent = "Saya Sudah Membayar";
    }
});

// =====================================================
// 14. STRUK PEMESANAN
// =====================================================

function showReceipt(order) {
    const methodText = order.provider
        ? order.method + " - " + order.provider
        : order.method;

    $("receiptContent").innerHTML = `
        <div class="receipt">
            <h2>SERIOUS STORE</h2>
            <p>BUKTI PEMESANAN</p>
            <hr>

            <p><b>Nomor Pesanan:</b> ${escapeHTML(order.orderId)}</p>
            <p><b>Nomor Struk:</b> ${escapeHTML(order.receiptNumber)}</p>
            <p><b>Nama Penerima:</b> ${escapeHTML(order.name)}</p>
            <p><b>Metode Pembayaran:</b> ${escapeHTML(methodText)}</p>
            <p><b>Kode Pembayaran:</b> ${escapeHTML(order.code || "-")}</p>
            <p><b>Total:</b> ${rupiah(order.total)}</p>
            <p><b>Status:</b> Menunggu Verifikasi Admin</p>

            <hr>

            <p>Terima kasih telah berbelanja di SERIOUS STORE.</p>

            <small>
                Struk ini merupakan bukti pemesanan simulasi,
                bukan bukti pembayaran lunas.
            </small>
        </div>
    `;

    showModal("receiptModal");
}

// =====================================================
// 15. CETAK STRUK
// =====================================================

$("printReceiptButton")?.addEventListener("click", () => {
    const content = $("receiptContent").innerHTML;

    // Cetak lewat iframe tersembunyi (tidak membuka tab baru)
    const frame = document.createElement("iframe");
    frame.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);

    const doc = frame.contentWindow.document;

    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <title>Struk SERIOUS STORE</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 30px;
                    max-width: 500px;
                    margin: auto;
                }
                .receipt {
                    line-height: 1.7;
                    border: 1px dashed #888;
                    padding: 20px;
                }
                .receipt h2 {
                    color: #176b42;
                    text-align: center;
                }
                .receipt > p:first-of-type {
                    text-align: center;
                }
            </style>
        </head>
        <body>${content}</body>
        </html>
    `);
    doc.close();

    setTimeout(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();

        setTimeout(() => frame.remove(), 1000);
    }, 300);
});

$("closeReceiptBottomButton")?.addEventListener("click", () => {
    hideModal("receiptModal");
});

// =====================================================
// 16. RIWAYAT TRANSAKSI
// =====================================================

$("historyButton")?.addEventListener("click", async () => {
    if (!currentUser) {
        openLogin();
        alert("Login terlebih dahulu untuk melihat riwayat.");
        return;
    }

    showModal("historyModal");
    await loadOrderHistory();
});

async function loadOrderHistory() {
    $("historyList").innerHTML = "<p>Memuat riwayat transaksi...</p>";

    const { data: orders, error } = await supabase
        .from("orders")
        .select(`
            id,
            total,
            status,
            payment_status,
            payment_method,
            payment_reference,
            receipt_number,
            created_at,
            refund_status,
            refund_reason,
            order_items (
                quantity,
                size,
                price,
                products (name)
            )
        `)
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false });

    if (error) {
        $("historyList").innerHTML =
            "<p>Gagal mengambil riwayat: " + escapeHTML(error.message) + "</p>";

        console.error(error);
        return;
    }

    if (!orders || orders.length === 0) {
        $("historyList").innerHTML = "<p>Belum ada transaksi.</p>";
        return;
    }

    $("historyList").innerHTML = orders.map(order => {
        const items = (order.order_items || []).map(item => `
            <p>
                ${escapeHTML(item.products?.name || "Produk")}
                - Ukuran ${escapeHTML(item.size || "-")}
                - ${item.quantity} buah
            </p>
        `).join("");

        const status =
            orderStatusLabels[order.status] || order.status || "-";

        const canCancel =
            ["unpaid", "waiting_verification"].includes(order.payment_status) &&
            ["menunggu_pembayaran", "menunggu_verifikasi"].includes(order.status);

        const canRefund =
            order.payment_status === "verified" &&
            ["diproses", "qc", "packing"].includes(order.status) &&
            (!order.refund_status || order.refund_status === "none");

        return `
            <article class="history-card">
                <h3>Pesanan #${escapeHTML(order.id)}</h3>

                <p><b>Nomor Struk:</b> ${escapeHTML(order.receipt_number || "-")}</p>

                <p>
                    <b>Tanggal:</b>
                    ${escapeHTML(new Date(order.created_at).toLocaleString("id-ID"))}
                </p>

                <h4>Produk</h4>
                ${items}

                <p><b>Total:</b> ${rupiah(order.total)}</p>
                <p><b>Pembayaran:</b> ${escapeHTML(order.payment_method || "-")}</p>
                <p><b>Status Pembayaran:</b> ${escapeHTML(order.payment_status || "-")}</p>

                <div class="tracking-line">
                    <strong>Pelacakan Pesanan</strong>
                    <p>${escapeHTML(status)}</p>
                </div>

                ${
                    canCancel
                    ? `<button class="cancel-button" data-cancel="${escapeHTML(order.id)}">
                            Batalkan Pesanan
                       </button>`
                    : ""
                }

                ${
                    canRefund
                    ? `<button class="refund-button" data-refund="${escapeHTML(order.id)}">
                            Ajukan Refund
                       </button>`
                    : ""
                }

                ${
                    order.refund_status && order.refund_status !== "none"
                    ? `<p><b>Status Refund:</b> ${escapeHTML(order.refund_status)}</p>`
                    : ""
                }
            </article>
        `;
    }).join("");

    document.querySelectorAll("[data-cancel]").forEach(button => {
        button.addEventListener("click", async () => {
            if (!confirm("Yakin ingin membatalkan pesanan ini?")) return;

            button.disabled = true;

            const { data, error } = await supabase.rpc("cancel_order", {
                p_order_id: Number(button.dataset.cancel),
                p_reason: "Dibatalkan oleh pelanggan"
            });

            if (error) {
                alert("Pembatalan gagal: " + error.message);
                button.disabled = false;
                return;
            }

            alert(data?.message || "Pesanan dibatalkan.");

            await loadOrderHistory();
            await loadProducts();
        });
    });

    document.querySelectorAll("[data-refund]").forEach(button => {
        button.addEventListener("click", async () => {
            const reason = prompt("Tuliskan alasan pengajuan refund.");

            if (!reason || !reason.trim()) return;

            button.disabled = true;

            const { data, error } = await supabase.rpc(
                "request_order_refund",
                {
                    p_order_id: Number(button.dataset.refund),
                    p_reason: reason.trim()
                }
            );

            if (error) {
                alert("Pengajuan refund gagal: " + error.message);
                button.disabled = false;
                return;
            }

            alert(data?.message || "Pengajuan refund berhasil dikirim.");

            await loadOrderHistory();
        });
    });
}

// =====================================================
// 17. MENJALANKAN APLIKASI
// =====================================================

async function initApp() {
    hideAllModals();

    await supabase.rpc("expire_unpaid_orders");

    await refreshSession();
    await loadProducts();

    updateCartDisplay();

    supabase.auth.onAuthStateChange(() => {
        setTimeout(async () => {
            await refreshSession();
        }, 0);
    });
}

await initApp();