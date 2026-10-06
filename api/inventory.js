const { readData, writeData } = require("./_store");
const { requireAdmin } = require("./_auth");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const data = await readData();
      return res.status(200).json({ products: data.products, shipping: data.shipping });
    }
    if (req.method === "PATCH") {
      if (!requireAdmin(req, res)) return;
      const body = req.body || {};
      const data = await readData();
      if (body.shipping) {
        data.shipping = {
          standard: Number(body.shipping.standard ?? data.shipping.standard),
          priority: Number(body.shipping.priority ?? data.shipping.priority),
          freeOver: Number(body.shipping.freeOver ?? data.shipping.freeOver)
        };
      }
      if (Array.isArray(body.products)) {
        for (const incoming of body.products) {
          const product = data.products.find(p => p.id === incoming.id);
          if (!product) continue;
          if (incoming.name !== undefined) product.name = String(incoming.name);
          if (incoming.price !== undefined) product.price = Number(incoming.price);
          if (incoming.inventory !== undefined) product.inventory = Math.max(0, Math.floor(Number(incoming.inventory)));
          if (incoming.notes !== undefined) product.notes = String(incoming.notes);
        }
      }
      await writeData(data);
      return res.status(200).json({ products: data.products, shipping: data.shipping });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Store backend is not connected yet. Connect the Vercel Blob store to this project." });
  }
};
