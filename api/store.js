const { get, put } = require("@vercel/blob");
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

module.exports=async function handler(req,res){
  try{
    const action=String(req.query?.action||"");
    const storeKey=req.query?.store==="cologne"?"cologne":"default";
    if(action==="login"&&req.method==="POST"){
      if(!process.env.STORE_ADMIN_PASSWORD)return res.status(503).json({error:"Admin password is not configured in Vercel."});
      if(String(req.body?.password||"")!==process.env.STORE_ADMIN_PASSWORD)return res.status(401).json({error:"Incorrect password."});
      return res.status(200).json({ok:true});
    }
    const adminOnly=(action==="inventory"&&req.method==="PATCH")||(action==="orders"&&(req.method==="GET"||req.method==="PATCH"))||(action==="settings"&&(req.method==="GET"||req.method==="PATCH"))||(action==="sales"&&req.method==="GET")||(action==="connect-stripe-webhook"&&req.method==="POST")||(action==="upload-ticket"&&req.method==="POST")||(action==="refund-order"&&req.method==="POST");
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
        const safeName=String(order.customer.name||"there").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
        const subject=order.status==="Shipped"?"Your order "+order.id+" has shipped":"Update on your order "+order.id;
        const html="<p>Hello "+safeName+",</p><p>Your order <strong>"+order.id+"</strong> is now <strong>"+order.status+"</strong>.</p>"+(order.tracking?"<p>Tracking number: <strong>"+order.tracking+"</strong></p>":"")+"<p>Thank you for shopping with THEY.</p>";
        await sendCustomerEmail(order,subject,html);
      }
      return res.status(200).json({order});
    }

    if(action==="upload-ticket"&&req.method==="POST"){
      if(!process.env.STORE_ADMIN_PASSWORD)return res.status(503).json({error:"Admin password is not configured."});
      const timestamp=Math.floor(Date.now()/1000),nonce=crypto.randomBytes(12).toString("hex"),payload="media-upload|"+timestamp+"|"+nonce;
      const signature=crypto.createHmac("sha256",process.env.STORE_ADMIN_PASSWORD).update(payload).digest("hex");
      return res.status(200).json({ticket:timestamp+"."+nonce+"."+signature});
    }
    if(action==="site-settings"&&req.method==="GET"){
      const data=await readData("cologne");
      return res.status(200).json({homeVideoUrl:data.settings?.homeVideoUrl||"sample-website.mp4?v=1",homeVideoLabel:data.settings?.homeVideoLabel||"THEY home video"});
    }
    if(action==="validate-coupon"&&req.method==="POST"){
      const data=await readData(storeKey),code=String(req.body?.code||"").trim().toUpperCase(),subtotal=Math.max(0,money(req.body?.subtotal||0));
      const coupon=(data.coupons||[]).find(c=>String(c.code||"").toUpperCase()===code&&c.active!==false&&(!c.startsAt||Date.now()>=Date.parse(c.startsAt))&&(!c.endsAt||Date.now()<=Date.parse(c.endsAt)));
      if(!coupon)return res.status(400).json({error:"That coupon code is invalid or expired."});
      const discount=Number(coupon.percentOff)>0?money(subtotal*Math.min(100,Number(coupon.percentOff))/100):Math.min(subtotal,money(coupon.amountOff||0));
      return res.status(200).json({code:coupon.code,discount,percentOff:Number(coupon.percentOff)||0,amountOff:Number(coupon.amountOff)||0});
    }
    if(action==="settings"&&req.method==="GET"){
      const data=await readData(storeKey);
      return res.status(200).json({settings:data.settings||{},shipping:data.shipping||{},coupons:data.coupons||[],activity:data.activity||[],products:data.products||[],orders:data.orders||[],webhookConnected:Boolean(data.stripeWebhook?.endpointId&&data.stripeWebhook?.signingSecret),emailConfigured:Boolean(process.env.RESEND_API_KEY)});
    }
    if(action==="settings"&&req.method==="PATCH"){
      const data=await readData(storeKey),body=req.body||{};
      if(body.settings){const s=body.settings;data.settings={...data.settings,homeVideoUrl:String(s.homeVideoUrl??data.settings.homeVideoUrl).slice(0,2000),homeVideoLabel:String(s.homeVideoLabel??data.settings.homeVideoLabel).slice(0,160),lowStockThreshold:Math.max(0,Math.floor(Number(s.lowStockThreshold??data.settings.lowStockThreshold)||0))};}
      if(body.shipping){data.shipping={...data.shipping,standard:Math.max(0,money(body.shipping.standard??data.shipping.standard)),priority:Math.max(0,money(body.shipping.priority??data.shipping.priority)),freeOver:Math.max(0,money(body.shipping.freeOver??data.shipping.freeOver))};}
      if(Array.isArray(body.coupons)){const seen=new Set();data.coupons=body.coupons.map(c=>{const code=String(c.code||"").trim().toUpperCase();if(!/^[A-Z0-9_-]{3,30}$/.test(code)||seen.has(code))throw new Error("Coupon codes must be unique and use 3–30 letters, numbers, underscores, or hyphens.");seen.add(code);const percentOff=Math.min(100,Math.max(0,Number(c.percentOff)||0)),amountOff=Math.max(0,money(c.amountOff||0));if((percentOff>0)===(amountOff>0))throw new Error("Each coupon must have either a percentage or fixed discount, not both.");return {code,percentOff,amountOff,active:c.active!==false,startsAt:String(c.startsAt||""),endsAt:String(c.endsAt||"")};});}
      logActivity(data,"Store settings saved","Updated store settings, shipping, or coupons.");await writeData(data,storeKey);
      return res.status(200).json({settings:data.settings,shipping:data.shipping,coupons:data.coupons});
    }
    if(action==="sales"&&req.method==="GET"){
      const data=await readData(storeKey),paid=data.orders.filter(o=>["Paid","Processing","Shipped","Completed","Partially refunded"].includes(o.status)&&["Paid","Partially refunded"].includes(o.paymentStatus));
      const total=paid.reduce((n,o)=>n+Math.max(0,Number(o.total||0)-Number(o.refundedAmount||0)),0),units=paid.reduce((n,o)=>n+(o.items||[]).reduce((m,i)=>m+Number(i.quantity||0),0),0);
      const byDay={};for(const o of paid){const day=String(o.paidAt||o.createdAt||"").slice(0,10);byDay[day]=(byDay[day]||0)+Math.max(0,Number(o.total||0)-Number(o.refundedAmount||0));}
      const lowStock=(data.products||[]).filter(p=>Number(p.inventory||0)<=Number(data.settings?.lowStockThreshold??3)).map(p=>({id:p.id,name:p.name,inventory:p.inventory}));
      return res.status(200).json({paidOrders:paid.length,revenue:money(total),units,averageOrder:paid.length?money(total/paid.length):0,byDay:Object.entries(byDay).sort((a,b)=>a[0].localeCompare(b[0])).slice(-30),lowStock});
    }
    if(action==="connect-stripe-webhook"&&req.method==="POST"){
      if(!process.env.STRIPE_SECRET_KEY)return res.status(503).json({error:"STRIPE_SECRET_KEY is missing."});
      const data=await readData("cologne");
      if(data.stripeWebhook?.endpointId&&data.stripeWebhook?.signingSecret)return res.status(200).json({connected:true,endpointUrl:data.stripeWebhook.url});
      const url="https://api.stripe.com/v1/webhook_endpoints",params=new URLSearchParams();
      params.set("url","https://omniaihub.net/api/stripe-webhook");
      ["checkout.session.completed","checkout.session.async_payment_succeeded","charge.refunded","refund.updated","payment_intent.payment_failed"].forEach((e,i)=>params.set("enabled_events["+i+"]",e));
      params.set("description","OmniAIHub Cologne Store automatic order synchronization");
      const response=await fetch(url,{method:"POST",headers:{"Authorization":"Bearer "+process.env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded"},body:params.toString()});
      const result=await response.json();if(!response.ok)return res.status(502).json({error:result.error?.message||"Stripe could not create the webhook endpoint."});
      data.stripeWebhook={endpointId:result.id,signingSecret:result.secret,url:result.url,createdAt:new Date().toISOString()};
      logActivity(data,"Stripe webhook connected",result.url);await writeData(data,"cologne");
      return res.status(200).json({connected:true,endpointUrl:result.url,message:"Stripe webhook created and signing secret stored in private server-side storage."});
    }
    if(action==="refund-order"&&req.method==="POST"){
      if(!process.env.STRIPE_SECRET_KEY)return res.status(503).json({error:"Stripe secret key is not configured."});
      const data=await readData(storeKey),orderId=String(req.body?.orderId||""),order=data.orders.find(o=>o.id===orderId);
      if(!order)return res.status(404).json({error:"Order not found."});
      if(!["Paid","Processing","Shipped","Completed","Partially refunded"].includes(order.status))return res.status(409).json({error:"Only paid orders can be refunded."});
      let intent=order.stripePaymentIntentId||"";
      if(!intent&&order.stripeSessionId){const sr=await fetch("https://api.stripe.com/v1/checkout/sessions/"+encodeURIComponent(order.stripeSessionId),{headers:{"Authorization":"Bearer "+process.env.STRIPE_SECRET_KEY}});const sd=await sr.json();if(!sr.ok)return res.status(502).json({error:sd.error?.message||"Could not retrieve the Stripe payment."});intent=typeof sd.payment_intent==="string"?sd.payment_intent:(sd.payment_intent?.id||"");if(intent)order.stripePaymentIntentId=intent;}
      if(!intent)return res.status(409).json({error:"Stripe payment intent is not available for this order yet."});
      const remaining=Math.max(0,Math.round((Number(order.total||0)-Number(order.refundedAmount||0))*100));
      const requested=String(req.body?.amount||"").trim()===""?remaining:Math.round(Number(req.body.amount)*100);
      if(!Number.isFinite(requested)||requested<=0||requested>remaining)return res.status(400).json({error:"Refund amount must be greater than zero and no more than the remaining refundable total."});
      const params=new URLSearchParams();params.set("payment_intent",intent);params.set("amount",String(requested));params.set("metadata[orderId]",order.id);
      const response=await fetch("https://api.stripe.com/v1/refunds",{method:"POST",headers:{"Authorization":"Bearer "+process.env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":order.id+"-refund-"+Date.now().toString(36)},body:params.toString()});
      const refund=await response.json();if(!response.ok)return res.status(502).json({error:refund.error?.message||"Stripe could not issue the refund."});
      order.stripePaymentIntentId=intent;order.refundIds=Array.isArray(order.refundIds)?order.refundIds:[];order.refundIds.push(refund.id);order.lastRefundRequestedAt=new Date().toISOString();logActivity(data,"Refund requested",order.id+" — $"+(requested/100).toFixed(2)+" — "+refund.id);await writeData(data,storeKey);
      return res.status(200).json({ok:true,refundId:refund.id,status:refund.status,amount:requested/100,message:"Refund request sent to Stripe. The webhook will synchronize its final status."});
    }
    if(action==="create-checkout-session"&&req.method==="POST"){
      if(!process.env.STRIPE_SECRET_KEY)return res.status(503).json({error:"Online payments are not configured yet. The store owner must add STRIPE_SECRET_KEY in Vercel."});
      const body=req.body||{},items=Array.isArray(body.items)?body.items:[],customer=body.customer||{};
      if(!items.length)return res.status(400).json({error:"Cart is empty."});
      if(!customer.name||!customer.email||!customer.address||!customer.city||!customer.state||!customer.zip)return res.status(400).json({error:"Complete the customer and shipping form first."});
      const data=await readData(storeKey),normalized=[];let subtotal=0;
      for(const item of items){const p=data.products.find(x=>x.id===item.id),qty=Math.max(1,Math.floor(Number(item.quantity)||1));if(!p)return res.status(400).json({error:"Product not found."});const key=String(item.color||"")+"|"+String(item.size||"");if(Object.prototype.hasOwnProperty.call(p.variantInventory||{},key)&&p.variantInventory[key]<qty)return res.status(409).json({error:p.name+" in "+key.replace("|"," / ")+" is out of stock."});if(p.inventory<qty)return res.status(409).json({error:p.name+" does not have enough inventory."});const unitPrice=effectivePrice(p);normalized.push({id:p.id,name:p.name,color:String(item.color||""),size:String(item.size||""),price:unitPrice,regularPrice:p.price,quantity:qty});subtotal+=unitPrice*qty;}
      const couponCode=String(body.couponCode||"").trim().toUpperCase();let coupon=null,discount=0;
      if(couponCode){coupon=(data.coupons||[]).find(c=>String(c.code||"").toUpperCase()===couponCode&&c.active!==false&&(!c.startsAt||Date.now()>=Date.parse(c.startsAt))&&(!c.endsAt||Date.now()<=Date.parse(c.endsAt)));if(!coupon)return res.status(400).json({error:"That coupon code is invalid or expired."});if(Number(coupon.percentOff)>0)discount=money(subtotal*Math.min(100,Number(coupon.percentOff))/100);else if(Number(coupon.amountOff)>0)discount=Math.min(subtotal,money(coupon.amountOff));}
      const shippingMethod=body.shippingMethod==="priority"?"priority":"standard",baseShipping=money(data.shipping[shippingMethod]||0),shipping=Number(data.shipping.freeOver)>0&&subtotal-discount>=Number(data.shipping.freeOver)?0:baseShipping,orderId=(storeKey==="cologne"?"COL-":"R4R-")+Date.now().toString(36).toUpperCase(),origin="https://"+String(req.headers.host||"omniaihub.net").replace(/[^a-zA-Z0-9.:-]/g,"");
      const isCologneStore=storeKey==="cologne"||body.returnPath==="/sample-website.html";
      const successPath=isCologneStore?"/checkout.html":"/real4real-store.html";
      const cancelPath=isCologneStore?"/checkout.html":"/real4real-store.html";
      const params=new URLSearchParams();params.set("mode","payment");params.set("ui_mode","embedded_page");params.set("return_url",origin+successPath+"?payment=success&session_id={CHECKOUT_SESSION_ID}");params.set("redirect_on_completion","always");params.set("customer_email",String(customer.email));params.set("client_reference_id",orderId);params.set("metadata[orderId]",orderId);params.set("metadata[store]",storeKey);params.set("payment_intent_data[metadata][orderId]",orderId);params.set("payment_intent_data[metadata][store]",storeKey);params.set("shipping_address_collection[allowed_countries][0]","US");
      normalized.forEach((item,i)=>{let cents=Math.round(item.price*100);if(coupon){if(Number(coupon.percentOff)>0)cents=Math.round(cents*(1-Math.min(100,Number(coupon.percentOff))/100));else if(Number(coupon.amountOff)>0){const totalCents=Math.round(subtotal*100),discountCents=Math.round(discount*100),share=totalCents?Math.round(discountCents*(item.price*item.quantity)/subtotal/item.quantity):0;cents=Math.max(0,cents-share);}}params.set("line_items["+i+"][quantity]",String(item.quantity));params.set("line_items["+i+"][price_data][currency]","usd");params.set("line_items["+i+"][price_data][unit_amount]",String(Math.max(0,cents)));params.set("line_items["+i+"][price_data][product_data][name]",item.name+" — "+item.color+" / "+item.size+(coupon?" ("+couponCode+")":""));});
      const shipIndex=normalized.length;params.set("line_items["+shipIndex+"][quantity]","1");params.set("line_items["+shipIndex+"][price_data][currency]","usd");params.set("line_items["+shipIndex+"][price_data][unit_amount]",String(Math.round(shipping*100)));params.set("line_items["+shipIndex+"][price_data][product_data][name]",shippingMethod==="priority"?"Priority shipping":"Standard shipping");
      const stripeRes=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{"Authorization":"Bearer "+process.env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded"},body:params.toString()});const session=await stripeRes.json();if(!stripeRes.ok)return res.status(502).json({error:session.error?.message||"Could not start secure checkout."});
      data.orders.unshift({id:orderId,store:storeKey,createdAt:new Date().toISOString(),status:"Pending payment",paymentStatus:"Unpaid",paymentMethod:"Stripe Checkout",stripeSessionId:session.id,items:normalized,subtotal:money(subtotal),discount:money(discount),couponCode:couponCode||"",shipping,shippingMethod,total:money(subtotal-discount+shipping),customer:{name:String(customer.name).slice(0,160),email:String(customer.email).slice(0,200),phone:String(customer.phone||"").slice(0,80),address:String(customer.address).slice(0,250),city:String(customer.city).slice(0,120),state:String(customer.state).slice(0,80),zip:String(customer.zip).slice(0,30)},tracking:""});await writeData(data,storeKey);
      if(!session.client_secret)return res.status(502).json({error:"Stripe did not return an embedded checkout secret."});
      return res.status(200).json({clientSecret:session.client_secret,publishableKey:process.env.STRIPE_PUBLISHABLE_KEY||"",orderId});
    }
    if(action==="verify-payment"&&req.method==="POST"){
      if(!process.env.STRIPE_SECRET_KEY)return res.status(503).json({error:"Online payments are not configured."});
      const sessionId=String(req.body?.sessionId||"");if(!sessionId.startsWith("cs_"))return res.status(400).json({error:"Invalid checkout session."});
      const stripeRes=await fetch("https://api.stripe.com/v1/checkout/sessions/"+encodeURIComponent(sessionId),{headers:{"Authorization":"Bearer "+process.env.STRIPE_SECRET_KEY}});const session=await stripeRes.json();if(!stripeRes.ok)return res.status(502).json({error:"Unable to verify payment with Stripe."});if(session.payment_status!=="paid")return res.status(402).json({error:"Payment is not marked paid yet."});
      const data=await readData(storeKey),order=data.orders.find(o=>o.stripeSessionId===session.id);if(!order)return res.status(404).json({error:"Order record not found."});order.stripePaymentIntentId=typeof session.payment_intent==="string"?session.payment_intent:(session.payment_intent?.id||order.stripePaymentIntentId||"");
      if(order.status!=="Paid"){for(const item of order.items){const p=data.products.find(x=>x.id===item.id);if(!p||p.inventory<item.quantity)return res.status(409).json({error:"Payment received but inventory needs manual review for order "+order.id+"."});const key=item.color+"|"+item.size;if(Object.prototype.hasOwnProperty.call(p.variantInventory||{},key)&&p.variantInventory[key]<item.quantity)return res.status(409).json({error:"Payment received but variant stock needs manual review for order "+order.id+"."});}for(const item of order.items){const p=data.products.find(x=>x.id===item.id);p.inventory-=item.quantity;const key=item.color+"|"+item.size;if(Object.prototype.hasOwnProperty.call(p.variantInventory||{},key))p.variantInventory[key]-=item.quantity;}order.status="Paid";order.paymentStatus="Paid";order.paidAt=new Date().toISOString();logActivity(data,"Payment confirmed",order.id+" via Stripe");await writeData(data,storeKey);await notifyOrder(order);await sendCustomerEmail(order,"Order confirmed — "+order.id,"<p>Thank you, "+String(order.customer?.name||"there")+"!</p><p>Your payment for order <strong>"+order.id+"</strong> is confirmed. Total: $"+Number(order.total||0).toFixed(2)+".</p>");}
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
