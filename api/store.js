const { get, put } = require("@vercel/blob");
const crypto = require("crypto");

const DATA_PATH = "sample-store/store-data.json";
const DEFAULT_DATA = {
  products: [
    { id:"noir-entree", name:"Noir Entree", price:195, inventory:15, image:"bottle-noir.jpg", notes:"Woody · Smoky · Magnetic" },
    { id:"velvet-vice", name:"Velvet Vice", price:195, inventory:15, image:"bottle-velvet.jpg", notes:"Spicy · Amber · Bold · Warm" },
    { id:"midnight-saint", name:"Midnight Saint", price:195, inventory:15, image:"bottle-saint.jpg", notes:"Aromatic · Leather · Smooth" }
  ],
  orders: [],
  shipping:{standard:9.95,priority:19.95,freeOver:250}
};

async function readData(){
  try{
    const result=await get(DATA_PATH,{access:"private",useCache:false});
    if(!result)return DEFAULT_DATA;
    return JSON.parse(await new Response(result.stream).text());
  }catch(error){
    const msg=String(error?.message||"").toLowerCase();
    if(error?.status===404||error?.code==="BLOB_NOT_FOUND"||msg.includes("not found"))return DEFAULT_DATA;
    throw error;
  }
}
async function writeData(data){
  await put(DATA_PATH,JSON.stringify(data,null,2),{access:"private",allowOverwrite:true,contentType:"application/json"});
  return data;
}
function sessionToken(username){
  const secret=process.env.ADMIN_SESSION_SECRET||"";
  const payload=Buffer.from(JSON.stringify({u:username,exp:Date.now()+8*60*60*1000})).toString("base64url");
  const sig=crypto.createHmac("sha256",secret).update(payload).digest("base64url");
  return payload+"."+sig;
}
function validSession(req){
  const secret=process.env.ADMIN_SESSION_SECRET||"";
  const match=(req.headers.cookie||"").match(/(?:^|;\s*)store_session=([^;]+)/);
  if(!match||!secret)return false;
  const parts=match[1].split(".");
  if(parts.length!==2)return false;
  const expected=crypto.createHmac("sha256",secret).update(parts[0]).digest("base64url");
  if(parts[1].length!==expected.length)return false;
  if(!crypto.timingSafeEqual(Buffer.from(parts[1]),Buffer.from(expected)))return false;
  try{return JSON.parse(Buffer.from(parts[0],"base64url").toString()).exp>Date.now()}catch{return false}
}
function admin(req,res){
  if(!validSession(req)){res.status(401).json({error:"Not signed in."});return false}
  return true;
}
function money(n){return Math.round(Number(n)*100)/100}

module.exports=async function handler(req,res){
  try{
    const action=String(req.query?.action||"");

    if(action==="login"&&req.method==="POST"){
      if(!process.env.ADMIN_USERNAME||!process.env.ADMIN_PASSWORD||!process.env.ADMIN_SESSION_SECRET)
        return res.status(503).json({error:"Admin login is not configured yet."});
      const username=String(req.body?.username||"");
      const password=String(req.body?.password||"");
      if(username!==process.env.ADMIN_USERNAME||password!==process.env.ADMIN_PASSWORD)
        return res.status(401).json({error:"Incorrect username or password."});
      res.setHeader("Set-Cookie","store_session="+sessionToken(username)+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800");
      return res.status(200).json({ok:true});
    }

    if(action==="inventory"&&req.method==="GET"){
      const data=await readData();
      return res.status(200).json({products:data.products,shipping:data.shipping});
    }

    if(action==="inventory"&&req.method==="PATCH"){
      if(!admin(req,res))return;
      const data=await readData(),body=req.body||{};
      if(body.shipping)data.shipping={standard:Number(body.shipping.standard??data.shipping.standard),priority:Number(body.shipping.priority??data.shipping.priority),freeOver:Number(body.shipping.freeOver??data.shipping.freeOver)};
      if(Array.isArray(body.products)){
        for(const incoming of body.products){
          const p=data.products.find(x=>x.id===incoming.id);if(!p)continue;
          if(incoming.name!==undefined)p.name=String(incoming.name);
          if(incoming.price!==undefined)p.price=Number(incoming.price);
          if(incoming.inventory!==undefined)p.inventory=Math.max(0,Math.floor(Number(incoming.inventory)));
          if(incoming.notes!==undefined)p.notes=String(incoming.notes);
        }
      }
      await writeData(data);
      return res.status(200).json({products:data.products,shipping:data.shipping});
    }

    if(action==="orders"&&req.method==="GET"){
      if(!admin(req,res))return;
      const data=await readData();
      return res.status(200).json({orders:data.orders});
    }

    if(action==="orders"&&req.method==="PATCH"){
      if(!admin(req,res))return;
      const data=await readData(),id=String(req.body?.id||"");
      const order=data.orders.find(o=>o.id===id);
      if(!order)return res.status(404).json({error:"Order not found."});
      if(req.body.status)order.status=String(req.body.status);
      if(req.body.tracking!==undefined)order.tracking=String(req.body.tracking||"");
      await writeData(data);
      return res.status(200).json({order});
    }

    if(action==="order"&&req.method==="POST"){
      const body=req.body||{},items=Array.isArray(body.items)?body.items:[],customer=body.customer||{};
      if(!items.length)return res.status(400).json({error:"Cart is empty."});
      if(!customer.name||!customer.address||!customer.city||!customer.state||!customer.zip)
        return res.status(400).json({error:"Shipping information is required."});
      const data=await readData(),normalized=[];let subtotal=0;
      for(const item of items){
        const p=data.products.find(x=>x.id===item.id),qty=Math.max(1,Math.floor(Number(item.quantity)));
        if(!p)return res.status(400).json({error:"Product not found."});
        if(p.inventory<qty)return res.status(409).json({error:p.name+" does not have enough inventory."});
        normalized.push({id:p.id,name:p.name,price:p.price,quantity:qty});subtotal+=p.price*qty;
      }
      const shippingMethod=body.shippingMethod==="priority"?"priority":"standard";
      const shipping=subtotal>=data.shipping.freeOver?0:data.shipping[shippingMethod];
      for(const item of normalized)data.products.find(p=>p.id===item.id).inventory-=item.quantity;
      const order={
        id:"TEST-"+Date.now().toString(36).toUpperCase(),createdAt:new Date().toISOString(),status:"Test order",
        paymentStatus:"Practice — not a real payment",items:normalized,subtotal:money(subtotal),shipping:money(shipping),
        shippingMethod,total:money(subtotal+shipping),
        customer:{name:String(customer.name),email:String(customer.email||""),phone:String(customer.phone||""),address:String(customer.address),city:String(customer.city),state:String(customer.state),zip:String(customer.zip)},
        tracking:""
      };
      data.orders.unshift(order);await writeData(data);
      return res.status(201).json({order,products:data.products});
    }

    return res.status(404).json({error:"Unknown store action."});
  }catch(error){
    console.error(error);
    return res.status(500).json({error:"Store backend is not connected yet. Connect the Vercel Blob store to this project."});
  }
};
