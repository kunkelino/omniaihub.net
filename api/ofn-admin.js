// One From Now moderator API.
// Authentication uses OFN_ADMIN_CODE in Vercel. Never put the admin code in HTML.
const BIN=process.env.JSONBIN_BIN_ID;
const KEY=process.env.JSONBIN_KEY;
const ADMIN=process.env.OFN_ADMIN_CODE;
const BIN_URL=BIN?`https://api.jsonbin.io/v3/b/${BIN}`:null;

const SEED={info:[],story:[],rooms:{},resources:[],videos:[],modQueue:[],suggestions:[]};
function hdr(){return {"Content-Type":"application/json","X-Master-Key":KEY,"X-Bin-Meta":"false"};}
function uniq(rows){const m=new Map();(rows||[]).forEach(x=>{if(x&&x.id!=null)m.set(String(x.id),x)});return [...m.values()];}
function norm(x){const s=x&&typeof x==="object"?x:{};return {...s,
 info:Array.isArray(s.info)?s.info:[],story:Array.isArray(s.story)?s.story:[],
 rooms:s.rooms&&typeof s.rooms==="object"&&!Array.isArray(s.rooms)?s.rooms:{},
 resources:Array.isArray(s.resources)?s.resources:[],videos:Array.isArray(s.videos)?s.videos:[],
 modQueue:Array.isArray(s.modQueue)?s.modQueue:[],suggestions:Array.isArray(s.suggestions)?s.suggestions:[]};}
async function read(){if(!BIN_URL||!KEY)throw new Error("JSONBin is not configured");const r=await fetch(BIN_URL+"/latest",{headers:hdr(),cache:"no-store"});if(!r.ok)throw new Error("Could not read shared OFN data");const d=await r.json();return norm(d.record||d);}
async function write(s){const r=await fetch(BIN_URL,{method:"PUT",headers:hdr(),body:JSON.stringify(s)});if(!r.ok)throw new Error("Could not save shared OFN data");return s;}
function send(res,c,o){res.statusCode=c;res.setHeader("Content-Type","application/json");res.end(JSON.stringify(o));}
function authorized(req){const b=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});return ADMIN&&String(b.code||"")===String(ADMIN);}
module.exports=async function(req,res){
 if(req.method==="OPTIONS")return send(res,204,{});
 try{
  const b=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
  if(b.action==="login"){return send(res,ADMIN?200:503,{ok:!!ADMIN,error:ADMIN?undefined:"OFN_ADMIN_CODE is not configured"});}
  if(!authorized(req))return send(res,401,{error:"Not authorized"});
  let s=await read();
  if(b.action==="get")return send(res,200,s);
  if(b.action==="queue"){
   const id=String(b.id), item=s.modQueue.find(x=>String(x.id)===id);
   s.modQueue=s.modQueue.filter(x=>String(x.id)!==id);
   if(b.decision==="keep"&&item&&item.room){
    const room=item.room;const rows=Array.isArray(s.rooms[room])?s.rooms[room]:[];
    if(!rows.some(x=>String(x.id)===id))rows.push({id:item.id,who:item.who,text:item.text,at:item.at});
    s.rooms[room]=rows;
   } await write(s);return send(res,200,s);
  }
  if(b.action==="deletePost"){
   const key=b.kind==="story"?"story":"info";s[key]=s[key].filter(x=>String(x.id)!==String(b.id));
   await write(s);return send(res,200,s);
  }
  if(b.action==="addResource"){
   const r={...(b.resource||{}),id:"admin-"+Date.now()+"-"+Math.random().toString(36).slice(2,7)};
   s.resources.unshift(r);await write(s);return send(res,200,s);
  }
  if(b.action==="deleteResource"){s.resources=s.resources.filter(x=>String(x.id)!==String(b.id));await write(s);return send(res,200,s);}
  if(b.action==="addVideo"){
   const v={...(b.video||{}),id:"admin-"+Date.now()+"-"+Math.random().toString(36).slice(2,7)};
   s.videos.unshift(v);await write(s);return send(res,200,s);
  }
  if(b.action==="deleteVideo"){s.videos=s.videos.filter(x=>String(x.id)!==String(b.id));await write(s);return send(res,200,s);}
  if(b.action==="deleteSuggestion"){s.suggestions=s.suggestions.filter(x=>String(x.id||x.at)!==String(b.id));await write(s);return send(res,200,s);}
  return send(res,400,{error:"Unknown action"});
 }catch(e){return send(res,500,{error:e.message||String(e)})}
};