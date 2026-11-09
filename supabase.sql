
-- ==========================================
-- PERBAIKAN FUNGSI PEMBAYARAN SERIOUS STORE
-- ID PESANAN MENGGUNAKAN BIGINT
-- ==========================================

-- Pastikan kolom referensi tersedia
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS payment_reference text;

-- Hapus fungsi lama dengan berbagai tipe parameter
DROP FUNCTION IF EXISTS public.confirm_order_payment(uuid);
DROP FUNCTION IF EXISTS public.confirm_order_payment(bigint);
DROP FUNCTION IF EXISTS public.confirm_order_payment(uuid, text, text);
DROP FUNCTION IF EXISTS public.confirm_order_payment(bigint, text, text);

-- Buat fungsi konfirmasi pembayaran baru
CREATE FUNCTION public.confirm_order_payment(
    p_order_id bigint,
    p_payment_method text,
    p_payment_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_order public.orders%rowtype;
    v_item record;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Silakan login terlebih dahulu.'
        );
    END IF;

    IF p_payment_method IS NULL
       OR p_payment_method NOT IN (
           'Transfer Bank',
           'QRIS',
           'E-Wallet'
       ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Metode pembayaran tidak valid.'
        );
    END IF;

    -- Cari pesanan milik pelanggan
    SELECT *
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id
      AND user_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Pesanan tidak ditemukan.'
        );
    END IF;

    IF v_order.status <> 'menunggu_pembayaran'
       OR v_order.payment_status <> 'unpaid' THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Pesanan tidak dapat dikonfirmasi.'
        );
    END IF;

    -- Periksa batas waktu pembayaran
    IF v_order.hold_expires_at IS NULL
       OR v_order.hold_expires_at <= now() THEN

        -- Kembalikan stok jika belum pernah dikembalikan
        IF v_order.stock_released_at IS NULL THEN

            FOR v_item IN
                SELECT product_id, quantity
                FROM public.order_items
                WHERE order_id = p_order_id
            LOOP
                UPDATE public.products
                SET stock = stock + v_item.quantity
                WHERE id = v_item.product_id;
            END LOOP;

            UPDATE public.orders
            SET status = 'kedaluwarsa',
                payment_status = 'expired',
                stock_released_at = now()
            WHERE id = p_order_id;

        END IF;

        RETURN jsonb_build_object(
            'success', false,
            'message', 'Waktu pembayaran sudah habis. Silakan pesan ulang.'
        );
    END IF;

    -- Simpan konfirmasi pembayaran
    UPDATE public.orders
    SET payment_method = p_payment_method,
        payment_reference = NULLIF(
            BTRIM(p_payment_reference),
            ''
        ),
        payment_status = 'waiting_verification',
        status = 'menunggu_verifikasi'
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Pembayaran berhasil dikonfirmasi dan menunggu verifikasi admin.'
    );

END;
$$;

-- Berikan hak akses fungsi kepada pengguna login
GRANT EXECUTE ON FUNCTION
public.confirm_order_payment(bigint, text, text)
TO authenticated;
