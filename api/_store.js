const { get, put } = require("@vercel/blob");

const DATA_PATH = "sample-store/store-data.json";

const DEFAULT_DATA = {
  products: [
    { id: "noir-entree", name: "Noir Entree", price: 195, inventory: 15, image: "bottle-noir.jpg", notes: "Woody · Smoky · Magnetic" },
    { id: "velvet-vice", name: "Velvet Vice", price: 195, inventory: 15, image: "bottle-velvet.jpg", notes: "Spicy · Amber · Bold · Warm" },
    { id: "midnight-saint", name: "Midnight Saint", price: 195, inventory: 15, image: "bottle-saint.jpg", notes: "Aromatic · Leather · Smooth" }
  ],
  orders: [],
  shipping: { standard: 9.95, priority: 19.95, freeOver: 250 }
};

async function readData() {
  try {
    const result = await get(DATA_PATH, { access: "private", useCache: false });
    if (!result) return DEFAULT_DATA;
    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch (error) {
    if (error && (error.status === 404 || error.code === "BLOB_NOT_FOUND")) return DEFAULT_DATA;
    if (String(error?.message || "").toLowerCase().includes("not found")) return DEFAULT_DATA;
    throw error;
  }
}

async function writeData(data) {
  await put(DATA_PATH, JSON.stringify(data, null, 2), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json"
  });
  return data;
}

module.exports = { readData, writeData, DEFAULT_DATA };
