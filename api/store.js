const { get, put } = require("@vercel/blob");
const { handleUpload } = require("@vercel/blob/client");
const crypto = require("crypto");

const DATA_PATH = "sample-store/store-data.json";
const COLOGNE_DATA_PATH = "cologne-store/store-data.json";
const COLOGNE_CONFIG_PATH = "cologne-store/admin-config.json";
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
  shipping:{standard:5.99,priority:10.99,freeOver:250},
  coupons:[],activity:[],settings:{homeVideoUrl:"sample-website.mp4?v=1",homeVideoLabel:"THEY home video",lowStockThreshold:3}
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
    data.shipping={...defaults.shipping,...(data.shipping||{})};
    data.coupons=Array.isArray(data.coupons)?data.coupons:[];
    data.activity=Array.isArray(data.activity)?data.activity:[];
    data.settings={homeVideoUrl:"sample-website.mp4?v=1",homeVideoLabel:"THEY home video",lowStockThreshold:3,...(data.settings||{})};
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
function effectivePrice(p){const now=Date.now(),start=p.saleStartsAt?Date.parse(p.saleStartsAt):0,end=p.saleEndsAt?Date.parse(p.saleEndsAt):Infinity;const sale=Number(p.salePrice);return Number.isFinite(sale)&&sale>0&&sale<Number(p.price)&&now>=start&&now<=end?sale:Number(p.price)||0}
function logActivity(data,action,details){data.activity=Array.isArray(data.activity)?data.activity:[];data.activity.unshift({id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),at:new Date().toISOString(),action:String(action),details:String(details||"").slice(0,500)});data.activity=data.activity.slice(0,500)}
async function sendCustomerEmail(order,subject,html){
  if(!process.env.RESEND_API_KEY||!order?.customer?.email)return false;
  const from=process.env.STORE_EMAIL_FROM||"THEY Cologne Store <orders@omniaihub.net>";
  try{const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from,to:[order.customer.email],subject,html})});if(!r.ok)console.error("Customer email failed:",await r.text());return r.ok}catch(e){console.error("Customer email failed:",e);return false}
}
function isAdmin(req){return Boolean(process.env.STORE_ADMIN_PASSWORD)&&req.headers["x-admin-password"]===process.env.STORE_ADMIN_PASSWORD}
async function notifyOrder(order){
  const url=process.env.STORE_ORDER_WEBHOOK_URL;
  if(!url)return false;
  try{
    const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event:"store.order.created",order})});
    return response.ok;
  }catch(error){console.error("Order notification failed:",error);return false}
}


async function ensureRequestBody(req){
  if(req.body!==undefined&&req.body!==null){
    if(Buffer.isBuffer(req.body)){req.rawBody=req.body;try{req.body=JSON.parse(req.rawBody.toString("utf8"))}catch{req.body={}}}
    else if(typeof req.body==="string"){req.rawBody=Buffer.from(req.body);try{req.body=JSON.parse(req.body)}catch{req.body={}}}
    return;
  }
  const chunks=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
  req.rawBody=Buffer.concat(chunks);
  if(req.rawBody.length){try{req.body=JSON.parse(req.rawBody.toString("utf8"))}catch{req.body={}}}else req.body={};
}
function validStripeSignature(raw,header,secret){
  const parts=String(header||"").split(",").map(x=>x.split("=")),timestamp=parts.find(x=>x[0]==="t")?.[1],signatures=parts.filter(x=>x[0]==="v1").map(x=>x[1]);
  if(!timestamp||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const expected=crypto.createHmac("sha256",secret).update(timestamp+".").update(raw).digest("hex");
  return signatures.some(sig=>{try{return crypto.timingSafeEqual(Buffer.from(sig,"hex"),Buffer.from(expected,"hex"))}catch{return false}});
}
async function handleStripeWebhook(req,res){
  if(req.method!=="POST")return res.status(405).send("Method not allowed");
  try{
    const config=await readData("cologne"),secret=config.stripeWebhook?.signingSecret||"";
    if(!secret)return res.status(503).send("Stripe webhook is not configured");
    const raw=req.rawBody||Buffer.from("");
    if(!validStripeSignature(raw,req.headers["stripe-signature"],secret))return res.status(400).send("Invalid Stripe signature");
    const event=JSON.parse(raw.toString("utf8")),obj=event.data?.object||{};
    if(event.type==="checkout.session.completed"||event.type==="checkout.session.async_payment_succeeded"){
      if(obj.payment_status!=="paid")return res.status(200).json({received:true,ignored:"payment not yet paid"});
      const store=obj.metadata?.store==="cologne"?"cologne":"default",data=await readData(store);
      const order=data.orders.find(o=>o.stripeSessionId===obj.id||o.id===obj.metadata?.orderId);
      if(!order)return res.status(200).json({received:true,ignored:"order not found"});
      order.stripePaymentIntentId=typeof obj.payment_intent==="string"?obj.payment_intent:(obj.payment_intent?.id||order.stripePaymentIntentId||"");
      if(order.paymentStatus!=="Paid"){
        for(const item of order.items||[]){const p=data.products.find(x=>x.id===item.id);if(!p)continue;p.inventory=Math.max(0,Number(p.inventory||0)-Number(item.quantity||0));const key=String(item.color||"")+"|"+String(item.size||"");if(p.variantInventory&&Object.prototype.hasOwnProperty.call(p.variantInventory,key))p.variantInventory[key]=Math.max(0,Number(p.variantInventory[key]||0)-Number(item.quantity||0));}
        order.status="Paid";order.paymentStatus="Paid";order.paidAt=new Date().toISOString();logActivity(data,"Payment confirmed",order.id+" through Stripe webhook");await writeData(data,store);
        await sendCustomerEmail(order,"Order confirmed — "+order.id,"<p>Thank you, "+String(order.customer?.name||"there")+".</p><p>Your payment for order <strong>"+order.id+"</strong> is confirmed.</p><p>Order total: $"+Number(order.total||0).toFixed(2)+".</p>");
      }else await writeData(data,store);
    }else if(event.type==="charge.refunded"||event.type==="refund.updated"){
      const charge=event.type==="charge.refunded"?obj:(obj.charge?obj:null),intent=charge?.payment_intent||obj.payment_intent;
      if(intent)for(const store of ["cologne","default"]){const data=await readData(store),order=data.orders.find(o=>o.stripePaymentIntentId===intent);if(!order)continue;const fully=event.type==="charge.refunded"&&Number(obj.amount_refunded)>=Number(obj.amount||0);if(event.type==="charge.refunded")order.refundedAmount=Number(obj.amount_refunded||0)/100;order.paymentStatus=fully?"Refunded":"Partially refunded";if(fully)order.status="Refunded";logActivity(data,"Stripe refund event",order.id+" — "+order.paymentStatus);await writeData(data,store);await sendCustomerEmail(order,"Refund update — "+order.id,"<p>Your order <strong>"+order.id+"</strong> has a Stripe refund update. Current payment status: "+order.paymentStatus+".</p>");break}
    }else if(event.type==="payment_intent.payment_failed"){
      for(const store of ["cologne","default"]){const data=await readData(store),order=data.orders.find(o=>o.stripePaymentIntentId===obj.id);if(!order)continue;order.paymentStatus="Payment failed";order.status="Payment failed";logActivity(data,"Payment failed",order.id);await writeData(data,store);break}
    }
    return res.status(200).json({received:true});
  }catch(error){console.error("Stripe webhook error:",error);return res.status(500).send("Webhook processing failed")}
}
async function handleBlobUpload(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  try{
    const result=await handleUpload({body:req.body,request:req,onBeforeGenerateToken:async(pathname,clientPayload)=>{
      if(!process.env.STORE_ADMIN_PASSWORD||typeof clientPayload!=="string")throw new Error("Upload authorization expired. Sign in and try again.");
      const parts=clientPayload.split(".");if(parts.length!==3)throw new Error("Invalid upload authorization.");
      const timestamp=Number(parts[0]),nonce=parts[1],signature=parts[2];
      if(!Number.isFinite(timestamp)||Math.abs(Date.now()/1000-timestamp)>300||!/^[a-f0-9]{24}$/.test(nonce))throw new Error("Upload authorization expired.");
      const expected=crypto.createHmac("sha256",process.env.STORE_ADMIN_PASSWORD).update("media-upload|"+timestamp+"|"+nonce).digest("hex");
      let valid=false;try{valid=crypto.timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(expected,"hex"))}catch{}
      if(!valid)throw new Error("Invalid upload authorization.");
      return {allowedContentTypes:["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"],maximumSizeInBytes:209715200,addRandomSuffix:true,tokenPayload:JSON.stringify({fileName:String(pathname||"upload").split("/").pop().replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120)})};
    }});
    return res.status(200).json(result);
  }catch(error){console.error("Media upload token error:",error);return res.status(400).json({error:error.message||"Media upload failed"})}
}

module.exports=async function handler(req,res){
  try{
    if(req.method!=="GET"&&req.method!=="HEAD")await ensureRequestBody(req);
    if(req.query?.route==="stripe-webhook")return await handleStripeWebhook(req,res);
    if(req.query?.route==="blob-upload")return await handleBlobUpload(req,res);
    const action=String(req.query?.action||"");
    const storeKey=req.query?.store==="cologne"?"cologne":"default";
    if(action==="login"&&req.method==="POST"){
      if(!process.env.STORE_ADMIN_PASSWORD)return res.status(503).json({error:"Admin password is not configured in Vercel."});
      if(String(req.body?.password||"")!==process.env.STORE_ADMIN_PASSWORD)return res.status(401).json({error:"Incorrect password."});
      return res.status(200).json({ok:true});
    }
    const adminOnly=(action==="inventory"&&req.method==="PATCH")||(action==="orders"&&(req.method==="GET"||req.method==="PATCH"))||(action==="settings"&&(req.method==="GET"||req.method==="PATCH"))||(action==="sales"&&req.method==="GET")||(action==="connect-stripe-webhook"&&req.method==="POST")||(action==="upload-ticket"&&req.method==="POST")||(action==="upload-image"&&req.method==="POST")||(action==="refund-order"&&req.method==="POST");
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
          const p={...old,...incoming,id,name:String(incoming.name).trim(),price:money(incoming.price),salePrice:money(incoming.salePrice||0),saleStartsAt:String(incoming.saleStartsAt||""),saleEndsAt:String(incoming.saleEndsAt||""),cost:money(incoming.cost||0),inventory:Math.max(0,Math.floor(Number(incoming.inventory)||0)),image:String(incoming.image||''),description:String(incoming.description||''),notes:String(incoming.notes||''),colors:Array.isArray(incoming.colors)?incoming.colors:[],sizes:Array.isArray(incoming.sizes)?incoming.sizes:[],variantInventory:incoming.variantInventory&&typeof incoming.variantInventory==='object'?incoming.variantInventory:{}};
          if(p.price<0||p.salePrice<0||p.cost<0)return res.status(400).json({error:'Prices and costs cannot be negative.'});
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
      logActivity(data,"Inventory saved","Updated "+(body.products||[]).length+" product records.");
      await writeData(data,storeKey);
      return res.status(200).json({products:data.products.map(p=>({...p,displayPrice:effectivePrice(p)})),shipping:data.shipping});
    }
    if(action==="orders"&&req.method==="GET"){
      const data=await readData(storeKey);
      return res.status(200).json({orders:data.orders});
    }
    if(action==="orders"&&req.method==="PATCH"){
      const data=await readData(storeKey),id=String(req.body?.id||"");
      const order=data.orders.find(o=>o.id===id);
      if(!order)return res.status(404).json({error:"Order not found."});
      const oldStatus=order.status,oldTracking=order.tracking||"";
      if(req.body.status)order.status=String(req.body.status);
      if(req.body.tracking!==undefined)order.tracking=String(req.body.tracking||"").slice(0,200);
      logActivity(data,"Order updated",order.id+": "+oldStatus+" → "+order.status+(order.tracking?" (tracking updated)":""));
      await writeData(data,storeKey);
      if(order.customer?.email&&(order.status!==oldStatus||order.tracking!==oldTracking)){
        const safeName=String(order.customer.name||"there").replace(/[&<>]/g,c=>({"&":"&","<":"<",">":">"}[c]));
        const subject=order.status==="Shipped"?"Your order "+order.id+" has shipped":"Update on your order "+order.id;
        const html="<p>Hello "+safeName+",</p><p>Your order <strong>"+order.id+"</strong> is now <strong>"+order.status+"</strong>.</p>"+(order.tracking?"<p>Tracking number: <strong>"+order.tracking+"</strong></p>":"")+"<p>Thank you for shopping with THEY.</p>";
        await sendCustomerEmail(order,subject,html);
      }
      return res.status(200).json({order});
    }

    if(action==="upload-image"&&req.method==="POST"){
      if(!process.env.STORE_ADMIN_PASSWORD)return res.status(503).json({error:"Admin password is not configured."});
      const body = req.body || {};
      const dataUrl = String(body.dataUrl || "");
      const fileName = String(body.fileName || "product.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if(!match)return res.status(400).json({error:"Invalid image data."});
      const contentType = match[1];
      const buffer = Buffer.from(match[2], "base64");
      if(buffer.length > 8 * 1024 * 1024)return res.status(400).json({error:"Image is too large (max 8 MB)."});
      const pathname = "cologne-products/" + Date.now().toString(36) + "-" + fileName;
      const blob = await put(pathname, buffer, { access: "public", contentType, addRandomSuffix: true });
      return res.status(200).json({ url: blob.url });
    }
    if(action==="upload-ticket"&&req.method==="POST"){
      if(!process.env.STORE_ADMIN_PASSWORD)return res.status(503).json({error:"Admin password is not configured."});
      const timestamp=Math.floor(Date.now()/1000),nonce=crypto.randomBytes(12).toString("hex"),payload="media-upload|"+timestamp+"|"+nonce;
      const signature=crypto.createHmac("sha256",process.env.STORE_ADMIN_PASSWORD).update(payload).digest("hex");
      return res.status(200).json({ticket:timestamp+"."+nonce+"."+signature});
    }
    if(action==="settings"&&req.method==="GET"){
      const data=await readData(storeKey);
      return res.status(200).json({settings:data.settings,shipping:data.shipping,coupons:data.coupons,activity:data.activity,webhookConnected:Boolean(data.stripeWebhook?.endpointId),emailConfigured:Boolean(process.env.RESEND_API_KEY)});
    }
    if(action==="settings"&&req.method==="PATCH"){
      const data=await readData(storeKey),body=req.body||{};
      if(body.settings)data.settings={...data.settings,...body.settings};
      if(body.shipping)data.shipping={...data.shipping,...body.shipping};
      if(Array.isArray(body.coupons))data.coupons=body.coupons;
      logActivity(data,"Settings updated","Website, shipping, or coupons changed.");
      await writeData(data,storeKey);
      return res.status(200).json({ok:true});
    }
    if(action==="sales"&&req.method==="GET"){
      const data=await readData(storeKey);
      const paid=data.orders.filter(o=>["Paid","Processing","Shipped","Completed","Partially refunded"].includes(o.status)||o.paymentStatus==="Paid");
      const confirmedRevenue=paid.reduce((s,o)=>s+Number(o.total||0),0);
      return res.status(200).json({confirmedRevenue,orderCount:paid.length});
    }
    if(action==="site-settings"&&req.method==="GET"){
      const data=await readData(storeKey);
      return res.status(200).json({homeVideoUrl:data.settings?.homeVideoUrl||""});
    }
    return res.status(400).json({error:"Unknown store action."});
  }catch(error){
    console.error(error);
    return res.status(500).json({error:error.message||"Store backend error. Check the Vercel function logs and Blob connection."});
  }
};

module.exports.config = { api: { bodyParser: false } };
