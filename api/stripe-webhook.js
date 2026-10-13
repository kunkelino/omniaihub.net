const {get,put}=require("@vercel/blob");
const crypto=require("crypto");
const COLOGNE_PATH="cologne-store/store-data.json";
const DEFAULT_PATH="sample-store/store-data.json";
const CONFIG_PATH="cologne-store/store-data.json";
const DEFAULTS={
  products:[
    {id:"bikini",name:"Bikini",price:50,cost:0,inventory:42,image:"bikini-model-black-yellow.jpg",description:"",colors:[],sizes:[],variantInventory:{}},
    {id:"tracksuit",name:"Tracksuit",price:50,cost:0,inventory:28,image:"tracksuit-black-front (1).jpg",description:"",colors:[],sizes:[],variantInventory:{}}
  ],orders:[],shipping:{standard:5.99,priority:10.99,freeOver:250},coupons:[],activity:[],settings:{lowStockThreshold:3}
};
async function readData(store){
  const path=store==="cologne"?COLOGNE_PATH:DEFAULT_PATH;
  try{const blob=await get(path,{access:"private",useCache:false});if(!blob)return structuredClone(DEFAULTS);const d=JSON.parse(await new Response(blob.stream).text());d.products=Array.isArray(d.products)?d.products:[];d.orders=Array.isArray(d.orders)?d.orders:[];d.activity=Array.isArray(d.activity)?d.activity:[];d.settings={lowStockThreshold:3,...(d.settings||{})};return d}
  catch(e){if(e?.status===404||String(e?.message||"").toLowerCase().includes("not found"))return structuredClone(DEFAULTS);throw e}
}
async function writeData(data,store){await put(store==="cologne"?COLOGNE_PATH:DEFAULT_PATH,JSON.stringify(data,null,2),{access:"private",allowOverwrite:true,contentType:"application/json"})}
function log(data,action,details){data.activity=data.activity||[];data.activity.unshift({id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),at:new Date().toISOString(),action,details});data.activity=data.activity.slice(0,500)}
async function email(order,subject,html){
  if(!process.env.RESEND_API_KEY||!order?.customer?.email)return;
  try{const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.STORE_EMAIL_FROM||"THEY Cologne Store <orders@omniaihub.net>",to:[order.customer.email],subject,html})});if(!r.ok)console.error("Resend error",await r.text())}catch(e){console.error("Email error",e)}
}
function verify(raw,header,secret){
  const parts=String(header||"").split(",").map(x=>x.split("=")),timestamp=parts.find(x=>x[0]==="t")?.[1],signatures=parts.filter(x=>x[0]==="v1").map(x=>x[1]);
  if(!timestamp||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const expected=crypto.createHmac("sha256",secret).update(timestamp+".").update(raw).digest("hex");
  return signatures.some(sig=>{try{return crypto.timingSafeEqual(Buffer.from(sig,"hex"),Buffer.from(expected,"hex"))}catch{return false}});
}
async function getSecret(){
  try{const b=await get(CONFIG_PATH,{access:"private",useCache:false});if(!b)return "";const d=JSON.parse(await new Response(b.stream).text());return d.stripeWebhook?.signingSecret||""}catch{return ""}
}
module.exports=async function handler(req,res){
  if(req.method!=="POST")return res.status(405).send("Method not allowed");
  try{
    const secret=await getSecret();if(!secret)return res.status(503).send("Stripe webhook is not configured");
    const chunks=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));const raw=Buffer.concat(chunks);
    if(!verify(raw,req.headers["stripe-signature"],secret))return res.status(400).send("Invalid Stripe signature");
    const event=JSON.parse(raw.toString("utf8")),obj=event.data?.object||{};
    if(event.type==="checkout.session.completed"||event.type==="checkout.session.async_payment_succeeded"){
      if(obj.payment_status!=="paid")return res.status(200).json({received:true,ignored:"payment not yet paid"});
      const store=obj.metadata?.store==="cologne"?"cologne":"default",data=await readData(store);
      const order=data.orders.find(o=>o.stripeSessionId===obj.id||o.id===obj.metadata?.orderId);
      if(!order)return res.status(200).json({received:true,ignored:"order not found"});
      order.stripePaymentIntentId=typeof obj.payment_intent==="string"?obj.payment_intent:(obj.payment_intent?.id||order.stripePaymentIntentId||"");
      if(order.paymentStatus!=="Paid"){
        for(const item of order.items||[]){const p=data.products.find(x=>x.id===item.id);if(!p)continue;p.inventory=Math.max(0,Number(p.inventory||0)-Number(item.quantity||0));const key=String(item.color||"")+"|"+String(item.size||"");if(p.variantInventory&&Object.prototype.hasOwnProperty.call(p.variantInventory,key))p.variantInventory[key]=Math.max(0,Number(p.variantInventory[key]||0)-Number(item.quantity||0));}
        order.status="Paid";order.paymentStatus="Paid";order.paidAt=new Date().toISOString();
        log(data,"Payment confirmed",order.id+" through Stripe webhook");await writeData(data,store);
        await email(order,"Order confirmed — "+order.id,"<p>Thank you, "+String(order.customer?.name||"there")+".</p><p>Your payment for order <strong>"+order.id+"</strong> is confirmed.</p><p>Order total: $"+Number(order.total||0).toFixed(2)+".</p>");
      }else{await writeData(data,store)}
    }else if(event.type==="charge.refunded"||event.type==="refund.updated"){
      const charge=event.type==="charge.refunded"?obj:(obj.charge?obj:null),intent=charge?.payment_intent||obj.payment_intent;
      if(intent){
        for(const store of ["cologne","default"]){const data=await readData(store),order=data.orders.find(o=>o.stripePaymentIntentId===intent);if(!order)continue;
          const fully=event.type==="charge.refunded"&&Number(obj.amount_refunded)>=Number(obj.amount||0);
          order.paymentStatus=fully?"Refunded":"Partially refunded";if(fully)order.status="Refunded";
          log(data,"Stripe refund event",order.id+" — "+order.paymentStatus);await writeData(data,store);
          await email(order,"Refund update — "+order.id,"<p>Your order <strong>"+order.id+"</strong> has a Stripe refund update. Current payment status: "+order.paymentStatus+".</p>");break;
        }
      }
    }else if(event.type==="payment_intent.payment_failed"){
      const intent=obj.id;
      for(const store of ["cologne","default"]){const data=await readData(store),order=data.orders.find(o=>o.stripePaymentIntentId===intent);if(!order)continue;order.paymentStatus="Payment failed";order.status="Payment failed";log(data,"Payment failed",order.id);await writeData(data,store);break}
    }
    return res.status(200).json({received:true});
  }catch(error){console.error("Stripe webhook error:",error);return res.status(500).send("Webhook processing failed")}
};
module.exports.config={api:{bodyParser:false}};
