const { get, put } = require("@vercel/blob");

const DATA_PATH = "sample-store/store-data.json";
const DEFAULT_DATA = {
  products: [
    { id:"bikini", name:"Bikini", price:50, cost:0, inventory:42, image:"bikini-model-black-yellow.jpg", description:"", colors:["Black / Yellow","White / Black","Red / White","Royal Blue","Pink / Black","Purple / White"], sizes:["XS","S","M","L","XL","XXL"], notes:"Available in six colors", variantInventory:{} },
    { id:"tracksuit", name:"Tracksuit", price:50, cost:0, inventory:28, image:"tracksuit-black-front (1).jpg", description:"", colors:["Black","Grey"], sizes:["XS","S","M","L","XL","XXL"], notes:"Available in black and grey", variantInventory:{} }
  ],
  orders: [],
  shipping:{standard:5.99,priority:10.99,freeOver:250}
};

async function readData(){
  try{
    const result=await get(DATA_PATH,{access:"private",useCache:false});
    if(!result)return structuredClone(DEFAULT_DATA);
    const data=JSON.parse(await new Response(result.stream).text());
    const currentProducts=Array.isArray(data.products)?data.products:[];
    data.products=currentProducts.map(p=>({...{cost:0,description:"",colors:[],sizes:[],variantInventory:{}},...p,colors:Array.isArray(p.colors)?p.colors:[],sizes:Array.isArray(p.sizes)?p.sizes:[],variantInventory:p.variantInventory&&typeof p.variantInventory==="object"?p.variantInventory:{}}));
    data.orders=Array.isArray(data.orders)?data.orders:[];
    data.shipping={...DEFAULT_DATA.shipping,...(data.shipping||{}),standard:5.99,priority:10.99};
    return data;
  }catch(error){
    const msg=String(error?.message||"").toLowerCase();
    if(error?.status===404||error?.code==="BLOB_NOT_FOUND"||msg.includes("not found"))return structuredClone(DEFAULT_DATA);
    throw error;
  }
}
async function writeData(data){
  await put(DATA_PATH,JSON.stringify(data,null,2),{access:"private",allowOverwrite:true,contentType:"application/json"});
  return data;
}
function money(n){return Math.round(Number(n)*100)/100}
function isAdmin(req){return Boolean(process.env.STORE_ADMIN_PASSWORD)&&req.headers["x-admin-password"]===process.env.STORE_ADMIN_PASSWORD}
async function notifyOrder(order){
  const url=process.env.STORE_ORDER_WEBHOOK_URL;
  if(!url)return false;
  try{
    const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event:"store.order.created",order})});
    return response.ok;
  }catch(error){console.error("Order notification failed:",error);return false}
}

module.exports=async function handler(req,res){
  try{
    const action=String(req.query?.action||"");
    if(action==="login"&&req.method==="POST"){
      if(!process.env.STORE_ADMIN_PASSWORD)return res.status(503).json({error:"Admin password is not configured in Vercel."});
      if(String(req.body?.password||"")!==process.env.STORE_ADMIN_PASSWORD)return res.status(401).json({error:"Incorrect password."});
      return res.status(200).json({ok:true});
    }
    const adminOnly=(action==="inventory"&&req.method==="PATCH")||(action==="orders"&&(req.method==="GET"||req.method==="PATCH"));
    if(adminOnly&&!isAdmin(req))return res.status(401).json({error:"Admin login required."});

    if(action==="inventory"&&req.method==="GET"){
      const data=await readData();
      return res.status(200).json({products:data.products,shipping:data.shipping});
    }
    if(action==="inventory"&&req.method==="PATCH"){
      const data=await readData(),body=req.body||{};
      if(body.shipping){
        data.shipping.freeOver=Math.max(0,Number(body.shipping.freeOver??data.shipping.freeOver??250));
      }
      if(Array.isArray(body.products)){
        for(const incoming of body.products){
          const p=data.products.find(x=>x.id===incoming.id);if(!p)continue;
          if(incoming.name!==undefined)p.name=String(incoming.name);
          if(incoming.price!==undefined&&Number.isFinite(Number(incoming.price))&&Number(incoming.price)>=0)p.price=money(incoming.price);
          if(incoming.inventory!==undefined&&Number.isFinite(Number(incoming.inventory)))p.inventory=Math.max(0,Math.floor(Number(incoming.inventory)));
          if(incoming.notes!==undefined)p.notes=String(incoming.notes);
          if(incoming.variantInventory&&typeof incoming.variantInventory==="object"&&!Array.isArray(incoming.variantInventory)){
            p.variantInventory=Object.fromEntries(Object.entries(incoming.variantInventory).map(([k,v])=>[String(k),Math.max(0,Math.floor(Number(v)||0))]));
          }
        }
      }
      await writeData(data);
      return res.status(200).json({products:data.products,shipping:data.shipping});
    }
    if(action==="orders"&&req.method==="GET"){
      const data=await readData();
      return res.status(200).json({orders:data.orders});
    }
    if(action==="orders"&&req.method==="PATCH"){
      const data=await readData(),id=String(req.body?.id||"");
      const order=data.orders.find(o=>o.id===id);
      if(!order)return res.status(404).json({error:"Order not found."});
      if(req.body.status)order.status=String(req.body.status);
      if(req.body.tracking!==undefined)order.tracking=String(req.body.tracking||"").slice(0,200);
      await writeData(data);
      return res.status(200).json({order});
    }
    if(action==="order"&&req.method==="POST"){
      const body=req.body||{},items=Array.isArray(body.items)?body.items:[],customer=body.customer||{};
      if(!items.length)return res.status(400).json({error:"Cart is empty."});
      if(!customer.name||!customer.email||!customer.address||!customer.city||!customer.state||!customer.zip)
        return res.status(400).json({error:"Name, email, and shipping address are required."});
      const data=await readData(),normalized=[];let subtotal=0;
      for(const item of items){
        const p=data.products.find(x=>x.id===item.id),qty=Math.max(1,Math.floor(Number(item.quantity)));
        if(!p)return res.status(400).json({error:"Product not found."});
        const variantKey=String(item.color||"")+"|"+String(item.size||"");
        const variantConfigured=Object.prototype.hasOwnProperty.call(p.variantInventory||{},variantKey);
        if(variantConfigured&&p.variantInventory[variantKey]<qty)return res.status(409).json({error:p.name+" in "+variantKey.replace("|"," / ")+" does not have enough stock."});
        if(p.inventory<qty)return res.status(409).json({error:p.name+" does not have enough inventory."});
        normalized.push({id:p.id,name:p.name,color:String(item.color||""),size:String(item.size||""),price:p.price,quantity:qty});
        subtotal+=p.price*qty;
      }
      const shippingMethod=body.shippingMethod==="priority"?"priority":"standard";
      const shipping=Number(data.shipping[shippingMethod]||0);
      for(const item of normalized){
        const p=data.products.find(x=>x.id===item.id);p.inventory-=item.quantity;
        const key=item.color+"|"+item.size;
        if(Object.prototype.hasOwnProperty.call(p.variantInventory||{},key))p.variantInventory[key]-=item.quantity;
      }
      const order={
        id:"TEST-"+Date.now().toString(36).toUpperCase(),createdAt:new Date().toISOString(),status:"Test order",
        paymentStatus:"Practice — not a real payment",paymentMethod:String(body.paymentMethod||"practice"),items:normalized,
        subtotal:money(subtotal),shipping:money(shipping),shippingMethod,total:money(subtotal+shipping),
        customer:{name:String(customer.name).slice(0,160),email:String(customer.email).slice(0,200),phone:String(customer.phone||"").slice(0,80),address:String(customer.address).slice(0,250),city:String(customer.city).slice(0,120),state:String(customer.state).slice(0,80),zip:String(customer.zip).slice(0,30)},
        tracking:""
      };
      data.orders.unshift(order);await writeData(data);
      const notificationSent=await notifyOrder(order);
      return res.status(201).json({order,notificationSent,products:data.products});
    }
    return res.status(404).json({error:"Unknown store action."});
  }catch(error){
    console.error(error);
    return res.status(500).json({error:"Store backend error. Check the Vercel function logs and Blob connection."});
  }
};
