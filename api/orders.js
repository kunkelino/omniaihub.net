const { readData, writeData } = require("./_store");
const { requireAdmin } = require("./_auth");

function money(n) { return Math.round(Number(n) * 100) / 100; }

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      const data = await readData();
      return res.status(200).json({ orders: data.orders });
    }

    if (req.method === "PATCH") {
      if (!requireAdmin(req, res)) return;
      const data = await readData();
      const id = String(req.body?.id || "");
      const order = data.orders.find(o => o.id === id);
      if (!order) return res.status(404).json({ error: "Order not found." });
      if (req.body.status) order.status = String(req.body.status);
      if (req.body.tracking !== undefined) order.tracking = String(req.body.tracking || "");
      await writeData(data);
      return res.status(200).json({ order });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items : [];
      const customer = body.customer || {};
      if (!items.length) return res.status(400).json({ error: "Cart is empty." });
      if (!customer.name || !customer.address || !customer.city || !customer.state || !customer.zip) {
        return res.status(400).json({ error: "Shipping information is required." });
      }

      const data = await readData();
      const normalized = [];
      let subtotal = 0;

      for (const item of items) {
        const product = data.products.find(p => p.id === item.id);
        const qty = Math.max(1, Math.floor(Number(item.quantity)));
        if (!product) return res.status(400).json({ error: "Product not found." });
        if (product.inventory < qty) return res.status(409).json({ error: product.name + " does not have enough inventory." });
        normalized.push({ id: product.id, name: product.name, price: product.price, quantity: qty });
        subtotal += product.price * qty;
      }

      const shippingMethod = body.shippingMethod === "priority" ? "priority" : "standard";
      const shipping = subtotal >= data.shipping.freeOver ? 0 : data.shipping[shippingMethod];
      const total = money(subtotal + shipping);

      for (const item of normalized) {
        const product = data.products.find(p => p.id === item.id);
        product.inventory -= item.quantity;
      }

      const order = {
        id: "TEST-" + Date.now().toString(36).toUpperCase(),
        createdAt: new Date().toISOString(),
        status: "Test order",
        paymentStatus: "Practice — not a real payment",
        items: normalized,
        subtotal: money(subtotal),
        shipping: money(shipping),
        shippingMethod,
        total,
        customer: {
          name: String(customer.name),
          email: String(customer.email || ""),
          phone: String(customer.phone || ""),
          address: String(customer.address),
          city: String(customer.city),
          state: String(customer.state),
          zip: String(customer.zip)
        },
        tracking: ""
      };

      data.orders.unshift(order);
      await writeData(data);
      return res.status(201).json({ order, products: data.products });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Could not process the order. Connect the Vercel Blob store first." });
  }
};
