const { get, put } = require("@vercel/blob");

const DATA_PATH = "sample-store/store-data.json";
const DEFAULT_DATA = {
  products: [
    { id:"noir-entree", name:"Noir Entree", price:195, inventory:15, image:"bottle-noir.jpg", notes:"Woody · Smoky · Magnetic" },
    { id:"velvet-vice", name:"Velvet Vice", price:195, inventory:15, image:"bottle-velvet.jpg", notes:"Spicy · Amber · Bold · Warm" },
    { id:"midnight-saint", name:"Midnight Saint", price:195, inventory:15, image:"bottle-saint.jpg", notes:"Aromatic · Leather · Smooth" }
  ],
  orders: [],
  shipping:{standard:5.99,priority:10.99,freeOver:250}
};

async function readData(){
  try{
    const result=await get(DATA_PATH,{access:"private",useCache:false});
    if(!result)return DEFAULT_DATA;
    const data=JSON.parse(await new Response(result.stream).text());
    data.shipping=data.shipping||{};
    data.shipping.standard=5.99;
    data.shipping.priority=10.99;
    if(data.shipping.freeOver===undefined)data.shipping.freeOver=250;
    return data;
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
function money(n){return Math.round(Number(n)*100)/100}

module.exports=async function handler(req,res){
  try{
    const action=String(req.query?.action||"");

    if(action==="login"&&req.method==="POST"){
      return res.status(200).json({ok:true});
    }

    if(action==="inventory"&&req.method==="GET"){
      const data=await readData();
      return res.status(200).json({products:data.products,shipping:data.shipping});
    }

    if(action==="inventory"&&req.method==="PATCH"){
      const data=await readData(),body=req.body||{};
      if(body.shipping){
        data.shipping.standard=5.99;
        data.shipping.priority=10.99;
        data.shipping.freeOver=Number(body.shipping.freeOver??data.shipping.freeOver??250);
      }
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
      const data=await readData();
      return res.status(200).json({orders:data.orders});
    }

    if(action==="orders"&&req.method==="PATCH"){
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
      const shipping=data.shipping[shippingMethod];
      for(const item of normalized)data.products.find(p=>p.id===item.id).inventory-=item.quantity;
      const order={
        id:"TEST-"+Date.now().toString(36).toUpperCase(),createdAt:new Date().toISOString(),status:"Test order",
        paymentStatus:"Practice — not a real payment",paymentMethod:String(body.paymentMethod||"card"),items:normalized,subtotal:money(subtotal),shipping:money(shipping),
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