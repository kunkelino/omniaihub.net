const { get, put } = require("@vercel/blob");

const DATA_PATH = "sample-store/store-data.json";
const COLOGNE_DATA_PATH = "cologne-store/store-data.json";
const DEFAULT_DATA = {
  products: [
    { id:"bikini", name:"Bikini", price:50, cost:0, inventory:42, image:"bikini-model-black-yellow.jpg", description:"", colors:["Black / Yellow","White / Black","Red / White","Royal Blue","Pink / Black","Purple / White"], sizes:["XS","S","M","L","XL","XXL"], notes:"Available in six colors", variantInventory:{} },
    { id:"tracksuit", name:"Tracksuit", price:50, cost:0, inventory:28, image:"tracksuit-black-front (1).jpg", description:"", colors:["Black","Grey"], sizes:["XS","S","M","L","XL","XXL"], notes:"Available in black and grey", variantInventory:{} }
  ],
  orders: [],
  shipping:{standard:5.99,priority:10.99,freeOver:250}
};
const COLOGNE_DEFAULT_DATA = {
  products: [
    {id:"noir-entree",name:"Noir Entree",price:195,cost:0,inventory:15,image:"bottle-noir.jpg",description:"",colors:[],sizes:[],notes:"Woody · Smoky · Magnetic",variantInventory:{}},
    {id:"velvet-vice",name:"Velvet Vice",price:195,cost:0,inventory:15,image:"bottle-velvet.jpg",description:"",colors:[],sizes:[],notes:"Spicy · Amber · Bold · Warm",variantInventory:{}},
    {id:"midnight-saint",name:"Midnight Saint",price:195,cost:0,inventory:15,image:"bottle-saint.jpg",description:"",colors:[],sizes:[],notes:"Aromatic · Leather · Smooth",variantInventory:{}}
  ],
  orders: [],
  shipping:{standard:5.99,priority:10.99,freeOver:250}
};

async function readData(storeKey="default"){
  const dataPath=storeKey==="cologne"?COLOGNE_DATA_PATH:DATA_PATH;
  const defaults=storeKey==="cologne"?COLOGNE_DEFAULT_DATA:DEFAULT_DATA;
  try{
    const result=await get(dataPath,{access:"private",useCache:false});
    if(!result)return structuredClone(defaults);
    const data=JSON.parse(await new Response(result.stream).text());
    const currentProducts=Array.isArray(data.products)?data.products:[];
    data.products=currentProducts.map(p=>({...{cost:0,description:"",colors:[],sizes:[],variantInventory:{}},...p,colors:Array.isArray(p.colors)?p.colors:[],sizes:Array.isArray(p.sizes)?p.sizes:[],variantInventory:p.variantInventory&&typeof p.variantInventory==="object"?p.variantInventory:{}}));
    data.orders=Array.isArray(data.orders)?data.orders:[];
    data.shipping={...defaults.shipping,...(data.shipping||{}),standard:5.99,priority:10.99};
    return data;
  }catch(error){
    const msg=String(error?.message||"").toLowerCase();
    if(error?.status===404||error?.code==="BLOB_NOT_FOUND"||msg.includes("not found"))return structuredClone(defaults);
    throw error;
  }
}
async function writeData(data,storeKey="default"){
  const dataPath=storeKey==="cologne"?COLOGNE_DATA_PATH:DATA_PATH;
  await put(dataPath,JSON.stringify(data,null,2),{access:"private",allowOverwrite:true,contentType:"application/json"});
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
    const storeKey=req.query?.store==="cologne"?"cologne":"default";
    if(action==="login"&&req.method==="POST"){
      if(!process.env.STORE_ADMIN_PASSWORD)return res.status(503).json({error:"Admin password is not configured in Vercel."});
      if(String(req.body?.password||"")!==process.env.STORE_ADMIN_PASSWORD)return res.status(401).json({error:"Incorrect password."});
      return res.status(200).json({ok:true});
    }
    const adminOnly=(action==="inventory"&&req.method==="PATCH")||(action==="orders"&&(req.method==="GET"||req.method==="PATCH"));
    if(adminOnly&&!isAdmin(req))return res.status(401).json({error:"Admin login required."});

    if(action==="inventory"&&req.method==="GET"){
      const data=await readData(storeKey);
      return res.status(200).json({products:data.products,shipping:data.shipping});
    }
    if(action==="inventory"&&req.method==="PATCH"){
      const data=await readData(storeKey),body=req.body||{};
      if(body.shipping){
        data.shipping.freeOver=Math.max(0,Number(body.shipping.freeOver??data.shipping.freeOver??250));
      }
      if(Array.isArray(body.products)&&body.replaceProducts===true){
        const seen=new Set(),next=[];
        for(const incoming of body.products){
          const id=String(incoming.id||'').trim();
          if(!id||/\\s/.test(id)||seen.has(id)||!String(incoming.name||'').trim())return res.status(400).json({error:'Products need names and unique IDs without spaces.'});
          seen.add(id);
          const old=data.products.find(p=>p.id===id)||{};
          const p={...old,...incoming,id,name:String(incoming.name).trim(),price:money(incoming.price),cost:money(incoming.cost||0),inventory:Math.max(0,Math.floor(Number(incoming.inventory)||0)),image:String(incoming.image||''),description:String(incoming.description||''),notes:String(incoming.notes||''),colors:Array.isArray(incoming.colors)?incoming.colors:[],sizes:Array.isArray(incoming.sizes)?incoming.sizes:[],variantInventory:incoming.variantInventory&&typeof incoming.variantInventory==='object'?incoming.variantInventory:{}};
          if(p.price<0||p.cost<0)return res.status(400).json({error:'Prices and costs cannot be negative.'});
          next.push(p);
        }
        data.products=next;
      }
      if(Array.isArray(body.restoreOrders))data.orders=body.restoreOrders;
      if(Array.isArray(body.products)&&body.replaceProducts!==true){
        for(const incoming of body.products){
          const p=data.products.find(x=>x.id===incoming.id);if(!p)continue;
          if(incoming.name!==undefined)p.name=String(incoming.name);
          if(incoming.cost!==undefined&&Number.isFinite(Number(incoming.cost))&&Number(incoming.cost)>=0)p.cost=money(incoming.cost);
          if(incoming.image!==undefined)p.image=String(incoming.image).slice(0,2000);
          if(incoming.description!==undefined)p.description=String(incoming.description).slice(0,5000);
          if(incoming.colors!==undefined)p.colors=Array.isArray(incoming.colors)?incoming.colors.map(String):[];
          if(incoming.sizes!==undefined)p.sizes=Array.isArray(incoming.sizes)?incoming.sizes.map(String):[];
          if(incoming.price!==undefined&&Number.isFinite(Number(incoming.price))&&Number(incoming.price)>=0)p.price=money(incoming.price);
          if(incoming.inventory!==undefined&&Number.isFinite(Number(incoming.inventory)))p.inventory=Math.max(0,Math.floor(Number(incoming.inventory)));
          if(incoming.notes!==undefined)p.notes=String(incoming.notes);
          if(incoming.variantInventory&&typeof incoming.variantInventory==="object"&&!Array.isArray(incoming.variantInventory)){
            p.variantInventory=Object.fromEntries(Object.entries(incoming.variantInventory).map(([k,v])=>[String(k),Math.max(0,Math.floor(Number(v)||0))]));
          }
        }
      }
      await writeData(data,storeKey);
      return res.status(200).json({products:data.products,shipping:data.shipping});
    }
    if(action==="orders"&&req.method==="GET"){
      const data=await readData(storeKey);
      return res.status(200).json({orders:data.orders});
    }
    if(action==="orders"&&req.method==="PATCH"){
      const data=await readData(storeKey),id=String(req.body?.id||"");
      const order=data.orders.find(o=>o.id===id);
      if(!order)return res.status(404).json({error:"Order not found."});
      if(req.body.status)order.status=String(req.body.status);
      if(req.body.tracking!==undefined)order.tracking=String(req.body.tracking||"").slice(0,200);
      await writeData(data,storeKey);
      return res.status(200).json({order});
    }
    if(action==="create-checkout-session"&&req.method==="POST"){
      if(!process.env.STRIPE_SECRET_KEY)return res.status(503).json({error:"Online payments are not configured yet. The store owner must add STRIPE_SECRET_KEY in Vercel."});
      const body=req.body||{},items=Array.isArray(body.items)?body.items:[],customer=body.customer||{};
      if(!items.length)return res.status(400).json({error:"Cart is empty."});
      if(!customer.name||!customer.email||!customer.address||!customer.city||!customer.state||!customer.zip)return res.status(400).json({error:"Complete the customer and shipping form first."});
      const data=await readData(storeKey),normalized=[];let subtotal=0;
      for(const item of items){const p=data.products.find(x=>x.id===item.id),qty=Math.max(1,Math.floor(Number(item.quantity)||1));if(!p)return res.status(400).json({error:"Product not found."});const key=String(item.color||"")+"|"+String(item.size||"");if(Object.prototype.hasOwnProperty.call(p.variantInventory||{},key)&&p.variantInventory[key]<qty)return res.status(409).json({error:p.name+" in "+key.replace("|"," / ")+" is out of stock."});if(p.inventory<qty)return res.status(409).json({error:p.name+" does not have enough inventory."});normalized.push({id:p.id,name:p.name,color:String(item.color||""),size:String(item.size||""),price:p.price,quantity:qty});subtotal+=p.price*qty;}
      const shippingMethod=body.shippingMethod==="priority"?"priority":"standard",shipping=money(data.shipping[shippingMethod]||0),orderId=(storeKey==="cologne"?"COL-":"R4R-")+Date.now().toString(36).toUpperCase(),origin="https://"+String(req.headers.host||"omniaihub.net").replace(/[^a-zA-Z0-9.:-]/g,"");
      const isCologneStore=storeKey==="cologne"||body.returnPath==="/sample-website.html";
      const successPath=isCologneStore?"/checkout.html":"/real4real-store.html";
      const cancelPath=isCologneStore?"/checkout.html":"/real4real-store.html";
      const params=new URLSearchParams();params.set("mode","payment");params.set("success_url",origin+successPath+"?payment=success&session_id={CHECKOUT_SESSION_ID}");params.set("cancel_url",origin+cancelPath+"?payment=cancel");params.set("customer_email",String(customer.email));params.set("client_reference_id",orderId);params.set("metadata[orderId]",orderId);params.set("payment_intent_data[metadata][orderId]",orderId);params.set("shipping_address_collection[allowed_countries][0]","US");
      normalized.forEach((item,i)=>{params.set("line_items["+i+"][quantity]",String(item.quantity));params.set("line_items["+i+"][price_data][currency]","usd");params.set("line_items["+i+"][price_data][unit_amount]",String(Math.round(item.price*100)));params.set("line_items["+i+"][price_data][product_data][name]",item.name+" — "+item.color+" / "+item.size);});
      const shipIndex=normalized.length;params.set("line_items["+shipIndex+"][quantity]","1");params.set("line_items["+shipIndex+"][price_data][currency]","usd");params.set("line_items["+shipIndex+"][price_data][unit_amount]",String(Math.round(shipping*100)));params.set("line_items["+shipIndex+"][price_data][product_data][name]",shippingMethod==="priority"?"Priority shipping":"Standard shipping");
      const stripeRes=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{"Authorization":"Bearer "+process.env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded"},body:params.toString()});const session=await stripeRes.json();if(!stripeRes.ok)return res.status(502).json({error:session.error?.message||"Could not start secure checkout."});
      data.orders.unshift({id:orderId,createdAt:new Date().toISOString(),status:"Pending payment",paymentStatus:"Unpaid",paymentMethod:"Stripe Checkout",stripeSessionId:session.id,items:normalized,subtotal:money(subtotal),shipping,shippingMethod,total:money(subtotal+shipping),customer:{name:String(customer.name).slice(0,160),email:String(customer.email).slice(0,200),phone:String(customer.phone||"").slice(0,80),address:String(customer.address).slice(0,250),city:String(customer.city).slice(0,120),state:String(customer.state).slice(0,80),zip:String(customer.zip).slice(0,30)},tracking:""});await writeData(data,storeKey);
      return res.status(200).json({url:session.url,orderId});
    }
    if(action==="verify-payment"&&req.method==="POST"){
      if(!process.env.STRIPE_SECRET_KEY)return res.status(503).json({error:"Online payments are not configured."});
      const sessionId=String(req.body?.sessionId||"");if(!sessionId.startsWith("cs_"))return res.status(400).json({error:"Invalid checkout session."});
      const stripeRes=await fetch("https://api.stripe.com/v1/checkout/sessions/"+encodeURIComponent(sessionId),{headers:{"Authorization":"Bearer "+process.env.STRIPE_SECRET_KEY}});const session=await stripeRes.json();if(!stripeRes.ok)return res.status(502).json({error:"Unable to verify payment with Stripe."});if(session.payment_status!=="paid")return res.status(402).json({error:"Payment is not marked paid yet."});
      const data=await readData(storeKey),order=data.orders.find(o=>o.stripeSessionId===session.id);if(!order)return res.status(404).json({error:"Order record not found."});
      if(order.status!=="Paid"){for(const item of order.items){const p=data.products.find(x=>x.id===item.id);if(!p||p.inventory<item.quantity)return res.status(409).json({error:"Payment received but inventory needs manual review for order "+order.id+"."});const key=item.color+"|"+item.size;if(Object.prototype.hasOwnProperty.call(p.variantInventory||{},key)&&p.variantInventory[key]<item.quantity)return res.status(409).json({error:"Payment received but variant stock needs manual review for order "+order.id+"."});}for(const item of order.items){const p=data.products.find(x=>x.id===item.id);p.inventory-=item.quantity;const key=item.color+"|"+item.size;if(Object.prototype.hasOwnProperty.call(p.variantInventory||{},key))p.variantInventory[key]-=item.quantity;}order.status="Paid";order.paymentStatus="Paid";order.paidAt=new Date().toISOString();await writeData(data,storeKey);await notifyOrder(order);}
      return res.status(200).json({ok:true,orderId:order.id});
    }
    if(action==="order"&&req.method==="POST"){
      const body=req.body||{},items=Array.isArray(body.items)?body.items:[],customer=body.customer||{};
      if(!items.length)return res.status(400).json({error:"Cart is empty."});
      if(!customer.name||!customer.email||!customer.address||!customer.city||!customer.state||!customer.zip)
        return res.status(400).json({error:"Name, email, and shipping address are required."});
      const data=await readData(storeKey),normalized=[];let subtotal=0;
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
      data.orders.unshift(order);await writeData(data,storeKey);
      const notificationSent=await notifyOrder(order);
      return res.status(201).json({order,notificationSent,products:data.products});
    }
    return res.status(404).json({error:"Unknown store action."});
  }catch(error){
    console.error(error);
    return res.status(500).json({error:"Store backend error. Check the Vercel function logs and Blob connection."});
  }
};
